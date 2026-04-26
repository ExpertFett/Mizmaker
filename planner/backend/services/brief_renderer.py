"""
PowerPoint brief generator — squadron template token substitution.

A template is a normal .pptx file containing `{{token.path}}` placeholders
anywhere a text run can live: slide titles, body text, tables, grouped
shapes. The frontend resolves each token to a value from the mission store
and posts back the value map; this service does the actual substitution
and returns rendered bytes.

Design choices:
  - Stateless. No session lookup. The /api/brief/render endpoint takes
    the template + a flat {token: value} dict and returns the filled .pptx.
    This keeps the brief generator independent of mission-data shape
    changes — the frontend is the only place that knows how to resolve
    a token to a value.
  - Tokens are pure string substitution. We don't try to type-check or
    eval expressions. `{{flight[0].callsign}}` is just a string the
    frontend resolved to `'BENGAL11'` before sending it.
  - Tokens missing from the values map are LEFT AS-IS (`{{token}}` in the
    output) so the user can spot what didn't get filled.
  - Run-level formatting is preserved when a token sits inside a single
    run. PowerPoint sometimes splits `{{ flight.callsign }}` across multiple
    runs (especially after manual editing); when that happens we fall back
    to a paragraph-level substitution that loses intra-paragraph formatting
    on that one paragraph but keeps the substitution working.
"""
import io
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE


# Token paths must start with a letter and may contain dots, brackets,
# digits, underscores. e.g. {{mission.theater}}, {{flight[0].callsign}},
# {{weather.wind.surface_kt}}.
TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z][a-zA-Z0-9_.\[\]]*)\s*\}\}")


def scan_template(template_bytes: bytes) -> List[str]:
    """Return a sorted list of unique token paths found in the template.

    Raises ValueError on malformed .pptx (corrupted ZIP, bad XML, etc.).
    """
    try:
        prs = Presentation(io.BytesIO(template_bytes))
    except Exception as e:
        raise ValueError(f"Could not open .pptx: {e}") from e

    tokens: set = set()
    for slide in prs.slides:
        _collect_tokens_from_shapes(slide.shapes, tokens)
        # Speaker notes can also contain tokens — useful for handouts.
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
            for paragraph in slide.notes_slide.notes_text_frame.paragraphs:
                for run in paragraph.runs:
                    for m in TOKEN_RE.finditer(run.text):
                        tokens.add(m.group(1))
    return sorted(tokens)


def render_template(template_bytes: bytes, values: Dict[str, str]) -> bytes:
    """Substitute every recognised token in the template with values[token].

    Tokens missing from `values` are left as literal `{{token}}` so the
    user can spot them in the rendered output and decide whether to
    add them to the value map.

    Returns the filled .pptx as raw bytes.
    """
    try:
        prs = Presentation(io.BytesIO(template_bytes))
    except Exception as e:
        raise ValueError(f"Could not open .pptx: {e}") from e

    for slide in prs.slides:
        _substitute_in_shapes(slide.shapes, values)
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
            _substitute_in_text_frame(slide.notes_slide.notes_text_frame, values)

    out = io.BytesIO()
    prs.save(out)
    return out.getvalue()


# --- internals ---------------------------------------------------------------

def _collect_tokens_from_shapes(shapes, tokens: set) -> None:
    for shape in shapes:
        if shape.has_text_frame:
            _collect_from_text_frame(shape.text_frame, tokens)
        if shape.has_table:
            for row in shape.table.rows:
                for cell in row.cells:
                    _collect_from_text_frame(cell.text_frame, tokens)
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            _collect_tokens_from_shapes(shape.shapes, tokens)


def _collect_from_text_frame(text_frame, tokens: set) -> None:
    # Use the joined-paragraph approach so split-run tokens are still found.
    for paragraph in text_frame.paragraphs:
        full = "".join(run.text for run in paragraph.runs)
        for m in TOKEN_RE.finditer(full):
            tokens.add(m.group(1))


def _substitute_in_shapes(shapes, values: Dict[str, str]) -> None:
    for shape in shapes:
        if shape.has_text_frame:
            _substitute_in_text_frame(shape.text_frame, values)
        if shape.has_table:
            for row in shape.table.rows:
                for cell in row.cells:
                    _substitute_in_text_frame(cell.text_frame, values)
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            _substitute_in_shapes(shape.shapes, values)


def _substitute_in_text_frame(text_frame, values: Dict[str, str]) -> None:
    for paragraph in text_frame.paragraphs:
        runs = paragraph.runs
        if not runs:
            continue

        # Fast path: token contained entirely within a single run.
        # Preserves font / size / bold across the rest of the paragraph.
        all_in_run = True
        modified = False
        for run in runs:
            if TOKEN_RE.search(run.text):
                modified = True
                # If the token spans into the next run, this regex won't match
                # the whole thing — flag for slow-path fallback.
                # We only treat it as fast-path-clean if every {{ has a }} on
                # the same run.
                if run.text.count("{{") != run.text.count("}}"):
                    all_in_run = False
                    break

        if modified and all_in_run:
            for run in runs:
                if TOKEN_RE.search(run.text):
                    run.text = TOKEN_RE.sub(
                        lambda m: str(values.get(m.group(1), m.group(0))),
                        run.text,
                    )
            continue

        # Slow path: token spans runs OR no token at all. Either way, do
        # paragraph-level substitution and write back into run 0.
        full = "".join(run.text for run in runs)
        if not TOKEN_RE.search(full):
            continue
        substituted = TOKEN_RE.sub(
            lambda m: str(values.get(m.group(1), m.group(0))),
            full,
        )
        runs[0].text = substituted
        for run in runs[1:]:
            run.text = ""


# --- Format conversion (PPTX → PDF / PNG / JPG) ----------------------------
#
# Uses LibreOffice headless (`soffice --convert-to`) which is free, runs
# server-side, and produces high-fidelity output. The Dockerfile installs
# `libreoffice-impress + libreoffice-core` for production.
#
# For local dev: install LibreOffice (https://www.libreoffice.org/download/)
# and ensure `soffice` is on PATH. Without it, `convert_pptx` raises
# `LibreOfficeNotFoundError` which the API surfaces as a 503 with a
# helpful message — the rest of the brief workflow still works (.pptx
# download path is unaffected).

ConvertFormat = Literal["pdf", "png", "jpg", "pptx"]


class LibreOfficeNotFoundError(RuntimeError):
    """Raised when soffice/libreoffice can't be located on the system."""


def _find_soffice() -> Optional[str]:
    """Locate the LibreOffice CLI binary across Linux/macOS/Windows."""
    # Prefer explicit env override if set (handy for non-standard installs).
    override = os.environ.get("LIBREOFFICE_PATH")
    if override and os.path.isfile(override):
        return override

    # PATH lookup — covers Linux/macOS standard installs and Docker.
    for name in ("soffice", "libreoffice"):
        found = shutil.which(name)
        if found:
            return found

    # Windows default install paths — `where soffice` doesn't find it
    # because the installer doesn't add it to PATH by default.
    candidates = [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


def is_conversion_available() -> bool:
    """Cheap check the API can use to decide whether to advertise the option."""
    return _find_soffice() is not None


def convert_pptx(pptx_bytes: bytes, target: ConvertFormat) -> Tuple[bytes, str]:
    """Convert a rendered .pptx to PDF, PNG (zip of slides), or JPG (zip).

    Returns (output_bytes, mime_type). `target='pptx'` is a no-op pass-through
    so callers can route any format through one function.

    PNG/JPG outputs are bundled into a ZIP because LibreOffice emits one
    image file per slide and the API needs a single response body.

    Raises:
      LibreOfficeNotFoundError — soffice not installed
      RuntimeError — conversion subprocess failed (with stderr in message)
      TimeoutError — conversion exceeded 60s
    """
    if target == "pptx":
        return pptx_bytes, "application/vnd.openxmlformats-officedocument.presentationml.presentation"

    # Validate target up-front so a bad value gives a clean ValueError
    # regardless of whether LibreOffice is installed.
    if target not in ("pdf", "png", "jpg"):
        raise ValueError(f"Unsupported target format: {target}")

    soffice = _find_soffice()
    if soffice is None:
        raise LibreOfficeNotFoundError(
            "LibreOffice is not installed on this server. "
            "Install it (https://www.libreoffice.org/download/) and ensure "
            "`soffice` is on PATH, or set LIBREOFFICE_PATH to its location. "
            "PowerPoint download (.pptx) still works without LibreOffice."
        )

    # All non-pptx targets go through a single pptx→pdf soffice call.
    # PDF is returned directly; PNG/JPG are rasterized per-page from the PDF.
    # Running soffice once (instead of twice) avoids Windows file-lock contention.
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        src = tmpdir / "brief.pptx"
        src.write_bytes(pptx_bytes)

        # Per-call user profile so we don't contend with any other soffice
        # process on the host. Path.as_uri() is cross-platform — produces
        # `file:///C:/...` on Windows, `file:///home/...` on Linux.
        user_profile = tmpdir / "soffice_profile"
        cmd = [
            soffice,
            "--headless",
            "--norestore",
            "--nologo",
            "--nofirststartwizard",
            f"-env:UserInstallation={user_profile.as_uri()}",
            "--convert-to", "pdf",
            "--outdir", str(tmpdir),
            str(src),
        ]
        try:
            result = subprocess.run(
                cmd, capture_output=True, timeout=60, check=False,
            )
        except subprocess.TimeoutExpired as e:
            raise TimeoutError("LibreOffice conversion timed out (60s)") from e

        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"LibreOffice conversion failed: {stderr}")

        pdf_path = tmpdir / "brief.pdf"
        if not pdf_path.exists():
            raise RuntimeError("Expected brief.pdf not produced by LibreOffice")
        pdf_bytes = pdf_path.read_bytes()

        if target == "pdf":
            return pdf_bytes, "application/pdf"

        # PNG/JPG — rasterize each PDF page and zip the images.
        return _pdf_to_image_zip(pdf_bytes, target)


def _pdf_to_image_zip(
    pdf_bytes: bytes, target: Literal["png", "jpg"],
) -> Tuple[bytes, str]:
    """Rasterize a PDF to per-page images and bundle them as a ZIP."""
    images: List[bytes] = _rasterize_pdf(pdf_bytes, target, dpi=150)
    if not images:
        raise RuntimeError("No images produced from PDF rasterization")

    buf = io.BytesIO()
    ext = "png" if target == "png" else "jpg"
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, img_bytes in enumerate(images, start=1):
            zf.writestr(f"slide_{i:02d}.{ext}", img_bytes)
    return buf.getvalue(), "application/zip"


def _rasterize_pdf(pdf_bytes: bytes, target: Literal["png", "jpg"], dpi: int = 150) -> List[bytes]:
    """Rasterize a PDF to per-page images. Tries pypdfium2 first."""
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return _rasterize_pdf_via_ghostscript(pdf_bytes, target, dpi)

    pdf = pdfium.PdfDocument(pdf_bytes)
    out: List[bytes] = []
    scale = dpi / 72  # PDF default is 72dpi
    for page in pdf:
        pil_img = page.render(scale=scale).to_pil()
        buf = io.BytesIO()
        if target == "png":
            pil_img.save(buf, format="PNG", optimize=True)
        else:
            pil_img.convert("RGB").save(buf, format="JPEG", quality=88)
        out.append(buf.getvalue())
    return out


# --- Default starter template ----------------------------------------------
#
# Generated programmatically rather than committed as a binary so it stays
# in sync with the documented token list — when we add a new supported
# token to the resolver registry, we add a line here too. Squadrons can
# download this, open it in PowerPoint, drop their logo + restyle, and
# re-upload as their custom template.

def generate_default_template() -> bytes:
    """Return a multi-slide .pptx populated with every supported token.

    Slide layout:
      1. Cover (mission name, theater, date/time)
      2. Flight & comms (per-flight callsign, aircraft, freq, TACAN)
      3. Weather
      4. Notes / free text
    """
    from pptx import Presentation as Prs
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor

    prs = Prs()
    prs.slide_width = Inches(13.333)  # 16:9
    prs.slide_height = Inches(7.5)

    blank = prs.slide_layouts[6]
    DARK_BG = RGBColor(0x1A, 0x1A, 0x1A)
    LIGHT = RGBColor(0xE0, 0xE0, 0xE0)
    ACCENT = RGBColor(0xFF, 0xA5, 0x00)
    DIM = RGBColor(0xAA, 0xAA, 0xAA)

    def add_bg(slide):
        # Fill background by adding a full-slide rectangle behind everything.
        from pptx.enum.shapes import MSO_SHAPE
        rect = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
        rect.fill.solid(); rect.fill.fore_color.rgb = DARK_BG
        rect.line.fill.background()
        # Move to back so other shapes layer on top.
        spTree = rect._element.getparent()
        spTree.remove(rect._element)
        spTree.insert(2, rect._element)

    def add_text(slide, x, y, w, h, text, size=18, bold=False, color=LIGHT, align_center=False):
        tx = slide.shapes.add_textbox(x, y, w, h)
        tf = tx.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        if align_center:
            from pptx.enum.text import PP_ALIGN
            p.alignment = PP_ALIGN.CENTER
        run = p.add_run()
        run.text = text
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = color
        run.font.name = "Arial"
        return tf

    # ---------------- Slide 1: Cover ---------------------------------------
    s1 = prs.slides.add_slide(blank)
    add_bg(s1)
    add_text(s1, Inches(0.6), Inches(0.4), Inches(12), Inches(0.5),
             "MISSION BRIEF", size=14, bold=True, color=ACCENT)
    add_text(s1, Inches(0.6), Inches(1.0), Inches(12), Inches(1.4),
             "{{mission.sortie}}", size=44, bold=True, color=LIGHT)
    add_text(s1, Inches(0.6), Inches(2.6), Inches(12), Inches(0.6),
             "{{mission.theater}}  ·  {{mission.date}}  ·  {{mission.time_zulu}}",
             size=20, color=DIM)
    add_text(s1, Inches(0.6), Inches(6.6), Inches(12), Inches(0.5),
             "Lead: {{flight[0].callsign}}  ({{flight[0].aircraft}})",
             size=14, color=DIM)

    # ---------------- Slide 2: Flight & comms ------------------------------
    s2 = prs.slides.add_slide(blank)
    add_bg(s2)
    add_text(s2, Inches(0.6), Inches(0.4), Inches(12), Inches(0.6),
             "FLIGHTS & COMMS", size=24, bold=True, color=ACCENT)

    # Two-flight table — squadrons typically brief 2–4 flights
    rows = [
        ["Callsign", "Aircraft", "Freq (MHz)", "TACAN", "ICLS"],
        ["{{flight[0].callsign}}", "{{flight[0].aircraft}}",
         "{{flight[0].frequency}}", "{{flight[0].tacan}}", "{{flight[0].icls}}"],
        ["{{flight[1].callsign}}", "{{flight[1].aircraft}}",
         "{{flight[1].frequency}}", "{{flight[1].tacan}}", "{{flight[1].icls}}"],
        ["{{flight[2].callsign}}", "{{flight[2].aircraft}}",
         "{{flight[2].frequency}}", "{{flight[2].tacan}}", "{{flight[2].icls}}"],
    ]
    table_shape = s2.shapes.add_table(
        rows=len(rows), cols=len(rows[0]),
        left=Inches(0.6), top=Inches(1.4), width=Inches(12), height=Inches(2.5),
    )
    table = table_shape.table
    for r_idx, row in enumerate(rows):
        for c_idx, cell_text in enumerate(row):
            cell = table.cell(r_idx, c_idx)
            cell.text = cell_text
            for p in cell.text_frame.paragraphs:
                for run in p.runs:
                    run.font.size = Pt(14)
                    run.font.name = "Arial"
                    run.font.color.rgb = ACCENT if r_idx == 0 else LIGHT
                    if r_idx == 0:
                        run.font.bold = True

    # ---------------- Slide 3: Weather -------------------------------------
    s3 = prs.slides.add_slide(blank)
    add_bg(s3)
    add_text(s3, Inches(0.6), Inches(0.4), Inches(12), Inches(0.6),
             "WEATHER", size=24, bold=True, color=ACCENT)
    wx_lines = [
        ("Cloud preset",   "{{weather.cloud_preset}}"),
        ("Visibility (m)", "{{weather.visibility_m}}"),
        ("QNH (inHg)",     "{{weather.qnh_inhg}}"),
        ("QNH (hPa)",      "{{weather.qnh_hpa}}"),
        ("Temperature",    "{{weather.temp_c}} °C"),
        ("Wind — surface", "{{weather.wind_surface}}"),
        ("Wind — 2000 ft", "{{weather.wind_2000}}"),
        ("Wind — 8000 ft", "{{weather.wind_8000}}"),
    ]
    for i, (label, value) in enumerate(wx_lines):
        y = Inches(1.4 + i * 0.55)
        add_text(s3, Inches(0.6), y, Inches(3), Inches(0.5), label, size=14, color=DIM)
        add_text(s3, Inches(3.8), y, Inches(8), Inches(0.5), value, size=16, color=LIGHT)

    # ---------------- Slide 4: Notes / free text ---------------------------
    s4 = prs.slides.add_slide(blank)
    add_bg(s4)
    add_text(s4, Inches(0.6), Inches(0.4), Inches(12), Inches(0.6),
             "MISSION DESCRIPTION", size=24, bold=True, color=ACCENT)
    add_text(s4, Inches(0.6), Inches(1.4), Inches(12), Inches(5),
             "{{mission.description}}", size=14, color=LIGHT)

    out = io.BytesIO()
    prs.save(out)
    return out.getvalue()


# --- Wing brief renderer (no template, direct .pptx generation) ----------
#
# Builds a presentation-ready .pptx from a WingBrief dict. Each section
# becomes one slide. Layout is consistent — dark-grey background,
# orange section headers, Arial body — matching the squadron-brief
# aesthetic of the kneeboard cards. Mission makers can re-style after
# download.

def render_wing_brief(brief: Dict[str, Any]) -> bytes:
    """Render a WingBrief dict to .pptx bytes.

    Slide order (Phase 1 — wing brief only):
      1. Cover
      2. Theatre overview
      3. Scenario
      4. Commander's intent
      5. Threats (table)
      6. Force composition (flights table)
      7. Comms (kv list)
      8. Mission flow
      9. Timeline (table)
     10. Notes / special instructions
    """
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.enum.text import PP_ALIGN
    from pptx.util import Inches, Pt

    prs = Presentation()
    prs.slide_width = Inches(13.333)   # 16:9
    prs.slide_height = Inches(7.5)
    BLANK = prs.slide_layouts[6]

    BG = RGBColor(0x1A, 0x1A, 0x1A)
    LIGHT = RGBColor(0xE0, 0xE0, 0xE0)
    BRIGHT = RGBColor(0xFF, 0xFF, 0xFF)
    ACCENT = RGBColor(0xFF, 0xA5, 0x00)
    DIM = RGBColor(0xAA, 0xAA, 0xAA)
    BORDER = RGBColor(0x55, 0x55, 0x55)
    TABLE_HEADER_BG = RGBColor(0x33, 0x33, 0x33)

    # ---------- helpers ---------------------------------------------------

    def _apply_bg(slide):
        rect = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
        rect.fill.solid(); rect.fill.fore_color.rgb = BG
        rect.line.fill.background()
        spTree = rect._element.getparent()
        spTree.remove(rect._element)
        spTree.insert(2, rect._element)

    def _txt(slide, x, y, w, h, text, *, size=18, bold=False, color=LIGHT,
             align_center=False, italic=False):
        tx = slide.shapes.add_textbox(x, y, w, h)
        tf = tx.text_frame
        tf.word_wrap = True
        # Multi-paragraph support — split body text on \n into separate paragraphs.
        lines = text.split("\n") if text else [""]
        for i, line in enumerate(lines):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            if align_center:
                p.alignment = PP_ALIGN.CENTER
            r = p.add_run()
            r.text = line
            r.font.size = Pt(size)
            r.font.bold = bold
            r.font.italic = italic
            r.font.color.rgb = color
            r.font.name = "Arial"
        return tf

    def _slide_header(slide, label):
        """Top-of-slide section title in accent color."""
        _txt(slide, Inches(0.6), Inches(0.4), Inches(12), Inches(0.6),
             label, size=24, bold=True, color=ACCENT)
        # Thin underline
        line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.6), Inches(1.05),
                                      Inches(12.1), Inches(0.04))
        line.fill.solid(); line.fill.fore_color.rgb = ACCENT
        line.line.fill.background()

    def _table(slide, x, y, w, h, headers, rows, col_widths=None):
        ncols = len(headers)
        nrows = len(rows) + 1  # +1 for header row
        shape = slide.shapes.add_table(nrows, ncols, x, y, w, h)
        table = shape.table
        # Column widths
        if col_widths:
            for i, cw in enumerate(col_widths):
                table.columns[i].width = cw

        # Header row
        for ci, header in enumerate(headers):
            cell = table.cell(0, ci)
            cell.fill.solid(); cell.fill.fore_color.rgb = TABLE_HEADER_BG
            cell.text = header
            for p in cell.text_frame.paragraphs:
                for r in p.runs:
                    r.font.bold = True
                    r.font.color.rgb = ACCENT
                    r.font.size = Pt(13)
                    r.font.name = "Arial"

        # Body rows
        for ri, row in enumerate(rows, start=1):
            for ci, val in enumerate(row):
                cell = table.cell(ri, ci)
                cell.fill.solid(); cell.fill.fore_color.rgb = BG
                cell.text = str(val) if val is not None else ""
                for p in cell.text_frame.paragraphs:
                    for r in p.runs:
                        r.font.color.rgb = LIGHT
                        r.font.size = Pt(12)
                        r.font.name = "Arial"
        return table

    # ---------- Slide 1: Cover -------------------------------------------
    s = prs.slides.add_slide(BLANK); _apply_bg(s)

    # Optional squadron logo — rendered top-right when uploaded by the
    # editor. We size to 1.4" tall, preserve aspect ratio (height-only,
    # python-pptx auto-fits width), and anchor 0.3" from the top-right
    # corner. Skip silently on any decode failure so a malformed logo
    # never blocks the brief from rendering.
    logo_b64 = (brief.get("logo_base64") or "").strip()
    if logo_b64:
        try:
            import base64
            # Tolerate data URIs and bare base64 alike
            if "," in logo_b64 and logo_b64.lstrip().startswith("data:"):
                logo_b64 = logo_b64.split(",", 1)[1]
            logo_bytes = base64.b64decode(logo_b64, validate=False)
            logo_stream = io.BytesIO(logo_bytes)
            logo_height = Inches(1.4)
            # 13.333" wide slide; logo right edge anchored ~12.9" leaves a
            # narrow margin. Width is auto-derived from aspect ratio.
            s.shapes.add_picture(logo_stream, Inches(11.5), Inches(0.3),
                                 height=logo_height)
        except Exception:
            # Logo failures are non-fatal — log nothing, just continue
            pass

    _txt(s, Inches(0.6), Inches(0.5), Inches(12), Inches(0.6),
         "WING BRIEF", size=14, bold=True, color=ACCENT, align_center=True)
    _txt(s, Inches(0.6), Inches(2.0), Inches(12), Inches(1.6),
         brief["mission_name"], size=44, bold=True, color=BRIGHT, align_center=True)
    _txt(s, Inches(0.6), Inches(4.0), Inches(12), Inches(0.6),
         f"{brief['theater']}  ·  {brief['date']}  ·  {brief['time_zulu']}",
         size=20, color=DIM, align_center=True)
    flight_summary = " · ".join(
        f"{f.get('callsign','?')} ({f.get('count', '?')}× {f.get('aircraft', '?')})"
        for f in brief["flights"][:4]
    )
    if flight_summary:
        _txt(s, Inches(0.6), Inches(6.4), Inches(12), Inches(0.5),
             flight_summary, size=14, color=DIM, align_center=True)

    # ---------- Slide 2: Theatre overview -------------------------------
    s = prs.slides.add_slide(BLANK); _apply_bg(s)
    _slide_header(s, "THEATRE OVERVIEW")
    _txt(s, Inches(0.6), Inches(1.4), Inches(12.1), Inches(5.8),
         brief["theatre_overview"], size=16, color=LIGHT)

    # ---------- Slide 3: Scenario ----------------------------------------
    s = prs.slides.add_slide(BLANK); _apply_bg(s)
    _slide_header(s, "SCENARIO")
    _txt(s, Inches(0.6), Inches(1.4), Inches(12.1), Inches(5.8),
         brief["scenario"], size=16, color=LIGHT)

    # ---------- Slide 4: Commander's intent ------------------------------
    s = prs.slides.add_slide(BLANK); _apply_bg(s)
    _slide_header(s, "COMMANDER'S INTENT")
    _txt(s, Inches(0.6), Inches(1.4), Inches(12.1), Inches(5.8),
         brief["commanders_intent"], size=16, color=LIGHT)

    # ---------- Slide 5: Threats ----------------------------------------
    s = prs.slides.add_slide(BLANK); _apply_bg(s)
    _slide_header(s, "THREATS")
    if brief["threats"]:
        _table(
            s, Inches(0.6), Inches(1.4), Inches(12.1), Inches(5.0),
            ["Name", "Type", "Coalition", "Range (km)"],
            [[t.get("name", ""), t.get("type", ""), t.get("coalition", ""),
              f"{t.get('range_km', 0):.1f}"] for t in brief["threats"]],
            col_widths=[Inches(4.0), Inches(2.5), Inches(2.0), Inches(2.0)],
        )
    else:
        _txt(s, Inches(0.6), Inches(1.6), Inches(12), Inches(1),
             "No surface threats detected in this mission.",
             size=18, color=DIM, italic=True)

    # ---------- Slide 6: Force composition -------------------------------
    s = prs.slides.add_slide(BLANK); _apply_bg(s)
    _slide_header(s, "FRIENDLY FORCES")
    if brief["flights"]:
        _table(
            s, Inches(0.6), Inches(1.4), Inches(12.1), Inches(5.0),
            ["Callsign", "Aircraft", "#", "Role", "Freq (MHz)", "TACAN", "Home Plate"],
            [[f.get("callsign", ""), f.get("aircraft", ""), str(f.get("count", "")),
              f.get("role", ""), f.get("frequency", ""), f.get("tacan", ""),
              f.get("home_plate", "")] for f in brief["flights"]],
            col_widths=[Inches(2.0), Inches(2.5), Inches(0.5), Inches(1.5),
                        Inches(1.5), Inches(1.2), Inches(2.5)],
        )
    else:
        _txt(s, Inches(0.6), Inches(1.6), Inches(12), Inches(1),
             "No player flights detected.", size=18, color=DIM, italic=True)

    # ---------- Slide 7: Comms ------------------------------------------
    s = prs.slides.add_slide(BLANK); _apply_bg(s)
    _slide_header(s, "COMMS")
    for i, c in enumerate(brief["comms"]):
        y = Inches(1.4 + i * 0.5)
        _txt(s, Inches(0.6), y, Inches(3.5), Inches(0.5), c.get("label", ""),
             size=15, color=DIM)
        _txt(s, Inches(4.5), y, Inches(8), Inches(0.5), c.get("value", ""),
             size=17, color=LIGHT, bold=True)

    # ---------- Slide 8: Mission flow -----------------------------------
    s = prs.slides.add_slide(BLANK); _apply_bg(s)
    _slide_header(s, "MISSION FLOW")
    _txt(s, Inches(0.6), Inches(1.4), Inches(12.1), Inches(5.8),
         brief["mission_flow"], size=15, color=LIGHT)

    # ---------- Slide 9: Timeline ---------------------------------------
    s = prs.slides.add_slide(BLANK); _apply_bg(s)
    _slide_header(s, "TIMELINE")
    if brief["timeline"]:
        _table(
            s, Inches(0.6), Inches(1.4), Inches(12.1), Inches(5.0),
            ["Phase", "Time (Z)", "Note"],
            [[r.get("phase", ""), r.get("time_zulu", ""), r.get("note", "")]
             for r in brief["timeline"]],
            col_widths=[Inches(3.0), Inches(2.0), Inches(7.1)],
        )

    # ---------- Slide 10: Notes -----------------------------------------
    s = prs.slides.add_slide(BLANK); _apply_bg(s)
    _slide_header(s, "SPECIAL INSTRUCTIONS / NOTES")
    notes_text = brief.get("notes") or (
        "Edit this section to add ROE, special procedures, contingency "
        "plans, fragments of code-words, divert decisions, etc."
    )
    is_placeholder = not brief.get("notes")
    _txt(s, Inches(0.6), Inches(1.4), Inches(12.1), Inches(5.8),
         notes_text, size=15, color=DIM if is_placeholder else LIGHT,
         italic=is_placeholder)

    out = io.BytesIO()
    prs.save(out)
    return out.getvalue()


def _rasterize_pdf_via_ghostscript(
    pdf_bytes: bytes, target: Literal["png", "jpg"], dpi: int,
) -> List[bytes]:
    """Ghostscript fallback for environments without pypdfium2."""
    gs = shutil.which("gs") or shutil.which("gswin64c") or shutil.which("gswin32c")
    if not gs:
        raise RuntimeError(
            "Neither pypdfium2 nor Ghostscript found. "
            "Install pypdfium2 (`pip install pypdfium2`) for image export."
        )
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        pdf_path = tmpdir / "in.pdf"
        pdf_path.write_bytes(pdf_bytes)
        out_pattern = tmpdir / f"page_%03d.{target}"
        device = "png16m" if target == "png" else "jpeg"
        cmd = [
            gs, "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER",
            f"-sDEVICE={device}", f"-r{dpi}",
            f"-sOutputFile={out_pattern}",
            str(pdf_path),
        ]
        subprocess.run(cmd, check=True, capture_output=True, timeout=60)
        images = sorted(tmpdir.glob(f"page_*.{target}"))
        return [p.read_bytes() for p in images]
