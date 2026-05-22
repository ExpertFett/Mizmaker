"""Tests for the PowerPoint brief renderer.

Generates a minimal .pptx in-memory per test rather than committing a binary
fixture — keeps the test self-contained and avoids drift between the fixture
file on disk and the assertions here.
"""
import io
import re

import pytest
from pptx import Presentation
from pptx.util import Inches

from services.brief_renderer import scan_template, render_template


def _make_template(*paragraphs: str) -> bytes:
    """Build a 1-slide .pptx where each arg is one body paragraph."""
    prs = Presentation()
    blank_layout = prs.slide_layouts[6]  # blank
    slide = prs.slides.add_slide(blank_layout)
    txBox = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(5))
    tf = txBox.text_frame
    tf.text = paragraphs[0] if paragraphs else ""
    for p in paragraphs[1:]:
        tf.add_paragraph().text = p
    out = io.BytesIO()
    prs.save(out)
    return out.getvalue()


def _slide_text(pptx_bytes: bytes) -> str:
    """Concatenate all paragraph text from slide 1 of a .pptx."""
    prs = Presentation(io.BytesIO(pptx_bytes))
    slide = prs.slides[0]
    parts = []
    for shape in slide.shapes:
        if shape.has_text_frame:
            for p in shape.text_frame.paragraphs:
                parts.append("".join(r.text for r in p.runs))
    return "\n".join(parts)


# --- scan_template -----------------------------------------------------------

class TestScanTemplate:
    def test_finds_single_token(self):
        tokens = scan_template(_make_template("Theater: {{mission.theater}}"))
        assert tokens == ["mission.theater"]

    def test_finds_multiple_tokens_dedupes(self):
        tokens = scan_template(_make_template(
            "Mission: {{mission.name}} on {{mission.date}}",
            "Theater: {{mission.theater}}",
            "Repeat: {{mission.theater}}",
        ))
        assert tokens == sorted(["mission.name", "mission.date", "mission.theater"])

    def test_finds_array_indexed_tokens(self):
        tokens = scan_template(_make_template(
            "{{flight[0].callsign}} and {{flight[1].callsign}}"
        ))
        assert "flight[0].callsign" in tokens
        assert "flight[1].callsign" in tokens

    def test_no_tokens_in_plain_template(self):
        assert scan_template(_make_template("Just plain text, no tokens")) == []

    def test_rejects_malformed_pptx(self):
        with pytest.raises(ValueError):
            scan_template(b"not a pptx file")

    def test_ignores_invalid_token_syntax(self):
        # Only patterns matching {{name.with.dots}} are tokens. Stuff like
        # `{{ }}` or `{{1bad}}` (starts with digit) is left alone.
        tokens = scan_template(_make_template("{{ }} {{1bad}} {{good.token}}"))
        assert tokens == ["good.token"]


# --- render_template ---------------------------------------------------------

class TestRenderTemplate:
    def test_substitutes_known_token(self):
        tmpl = _make_template("Theater: {{mission.theater}}")
        rendered = render_template(tmpl, {"mission.theater": "Kola"})
        assert "Theater: Kola" in _slide_text(rendered)
        assert "{{mission.theater}}" not in _slide_text(rendered)

    def test_leaves_missing_token_as_literal(self):
        # The whole point of the soft-fail behaviour: user can spot what
        # didn't get filled in the rendered output.
        tmpl = _make_template("Set: {{mission.theater}}", "Unset: {{mission.callsign}}")
        rendered = render_template(tmpl, {"mission.theater": "Kola"})
        text = _slide_text(rendered)
        assert "Set: Kola" in text
        assert "{{mission.callsign}}" in text

    def test_substitutes_multiple_tokens_one_paragraph(self):
        tmpl = _make_template("{{a}} and {{b}} and {{c}}")
        rendered = render_template(tmpl, {"a": "X", "b": "Y", "c": "Z"})
        assert "X and Y and Z" in _slide_text(rendered)

    def test_handles_array_index_tokens(self):
        tmpl = _make_template("Lead: {{flight[0].callsign}}, Wing: {{flight[1].callsign}}")
        rendered = render_template(tmpl, {
            "flight[0].callsign": "BENGAL11",
            "flight[1].callsign": "BENGAL12",
        })
        assert "Lead: BENGAL11, Wing: BENGAL12" in _slide_text(rendered)

    def test_empty_values_dict_leaves_template_untouched(self):
        tmpl = _make_template("All: {{a}} {{b}} {{c}}")
        rendered = render_template(tmpl, {})
        assert "All: {{a}} {{b}} {{c}}" in _slide_text(rendered)

    def test_value_with_special_chars(self):
        # Substitution shouldn't mangle special chars like \n, %, &
        tmpl = _make_template("Notes: {{notes}}")
        rendered = render_template(tmpl, {"notes": "Line1 & Line2 — 100%"})
        assert "Line1 & Line2 — 100%" in _slide_text(rendered)

    def test_table_cell_substitution(self):
        # Tables are common in briefings (waypoint list, comm card).
        prs = Presentation()
        slide = prs.slides.add_slide(prs.slide_layouts[6])
        table_shape = slide.shapes.add_table(
            rows=2, cols=2, left=Inches(1), top=Inches(1),
            width=Inches(6), height=Inches(2),
        )
        table = table_shape.table
        table.cell(0, 0).text = "Theater"
        table.cell(0, 1).text = "{{mission.theater}}"
        table.cell(1, 0).text = "Date"
        table.cell(1, 1).text = "{{mission.date}}"
        out = io.BytesIO(); prs.save(out)

        rendered = render_template(out.getvalue(), {
            "mission.theater": "Kola",
            "mission.date": "2026-04-25",
        })
        # Read back the table from the rendered file
        prs2 = Presentation(io.BytesIO(rendered))
        cells = [c.text for c in prs2.slides[0].shapes[0].table.iter_cells()]
        assert "Kola" in cells
        assert "2026-04-25" in cells

    def test_rejects_malformed_pptx(self):
        with pytest.raises(ValueError):
            render_template(b"definitely not a pptx", {"a": "b"})

    def test_render_round_trip_through_scan(self):
        """The output of render should still be a valid .pptx that scan
        can reopen — and any unfilled tokens should still be detectable."""
        tmpl = _make_template("Filled: {{a}}, Unfilled: {{b}}")
        rendered = render_template(tmpl, {"a": "DONE"})
        rescanned = scan_template(rendered)
        assert rescanned == ["b"]


# --- convert_pptx (PDF / PNG / JPG) ----------------------------------------
# Skipped automatically if LibreOffice isn't on PATH — these tests run on
# the CI image which installs libreoffice-impress, and on dev boxes that
# have it. They don't run on a stock Python install with no LibreOffice.

from services.brief_renderer import (
    convert_pptx, is_conversion_available, LibreOfficeNotFoundError,
)

skip_no_libreoffice = pytest.mark.skipif(
    not is_conversion_available(),
    reason="LibreOffice not installed — PDF/PNG/JPG conversion tests skipped",
)


class TestConvertPptx:
    def test_pptx_passthrough_no_libreoffice_required(self):
        """target='pptx' is a no-op pass-through and must work without soffice."""
        tmpl = _make_template("Hello")
        out, mime = convert_pptx(tmpl, "pptx")
        assert out == tmpl
        assert "presentation" in mime

    def test_unsupported_format_raises(self):
        with pytest.raises(ValueError):
            convert_pptx(_make_template("x"), "doc")  # type: ignore[arg-type]

    @skip_no_libreoffice
    def test_pdf_conversion(self):
        out, mime = convert_pptx(_make_template("PDF test"), "pdf")
        assert mime == "application/pdf"
        assert out.startswith(b"%PDF-")  # valid PDF magic

    @skip_no_libreoffice
    def test_png_conversion_returns_zip_of_slides(self):
        # 2-slide template so we can verify multiple images come through
        prs = Presentation()
        for i in range(2):
            slide = prs.slides.add_slide(prs.slide_layouts[6])
            tx = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(5))
            tx.text_frame.text = f"Slide {i + 1}"
        buf = io.BytesIO(); prs.save(buf)

        out, mime = convert_pptx(buf.getvalue(), "png")
        assert mime == "application/zip"

        import zipfile
        with zipfile.ZipFile(io.BytesIO(out)) as zf:
            names = zf.namelist()
            assert len(names) == 2
            assert all(n.endswith(".png") for n in names)
            # Each entry should be a real PNG (magic bytes)
            for n in names:
                data = zf.read(n)
                assert data[:8] == b"\x89PNG\r\n\x1a\n"

    @skip_no_libreoffice
    def test_jpg_conversion_returns_zip_of_slides(self):
        out, mime = convert_pptx(_make_template("JPG test"), "jpg")
        assert mime == "application/zip"
        import zipfile
        with zipfile.ZipFile(io.BytesIO(out)) as zf:
            names = zf.namelist()
            assert len(names) >= 1
            assert all(n.endswith(".jpg") for n in names)
            data = zf.read(names[0])
            assert data[:3] == b"\xff\xd8\xff"  # JPEG magic

    def test_libreoffice_not_found_raises_specific_error(self, monkeypatch):
        """Force the not-found path even on a machine with soffice installed,
        so we can verify the error message points users to the install steps."""
        from services import brief_renderer
        monkeypatch.setattr(brief_renderer, "_find_soffice", lambda: None)
        with pytest.raises(LibreOfficeNotFoundError) as exc:
            convert_pptx(_make_template("x"), "pdf")
        assert "LibreOffice" in str(exc.value)
        assert "PowerPoint download (.pptx) still works" in str(exc.value)


# --- render_wing_brief: base-template support (v0.9.79) ----------------------

def _minimal_wing_brief() -> dict:
    """Smallest WingBrief dict render_wing_brief will accept."""
    return {
        "mission_name": "TEST OP", "theater": "Caucasus",
        "date": "2026-05-21", "time_zulu": "0830Z", "coalition": "blue",
        "logo_base64": "", "cover_image_base64": "",
        "theatre_overview": "Overview.", "scenario": "Scenario.",
        "commanders_intent": "Purpose: x\nMethod: y\nEnd State: z",
        "mission_flow": "1. Push", "notes": "",
        "timeline": [{"phase": "PUSH", "time_zulu": "0815Z", "note": "go"}],
        "threats": [{"name": "SA-11", "type": "SAM", "coalition": "red",
                     "range_km": 35, "location": "Kobuleti"}],
        "flights": [{"callsign": "ENFIELD", "aircraft": "FA-18C", "count": 4,
                     "role": "cas", "frequency": "305.000", "tacan": "",
                     "home_plate": "Senaki"}],
        "comms": [{"label": "STRIKE", "value": "270.800"}],
    }


def _make_base_template(n_slides: int = 2) -> str:
    """A small styled 16:9 .pptx (n blank slides), returned base64 — stands
    in for a squadron template upload."""
    import base64
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    for i in range(n_slides):
        s = prs.slides.add_slide(blank)
        s.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(1)).text_frame.text = f"COVER {i+1}"
    out = io.BytesIO(); prs.save(out)
    return base64.b64encode(out.getvalue()).decode("ascii")


class TestRenderWingBriefBaseTemplate:
    def test_default_render_has_ten_slides(self):
        from services.brief_renderer import render_wing_brief
        prs = Presentation(io.BytesIO(render_wing_brief(_minimal_wing_brief())))
        assert len(prs.slides._sldIdLst) == 10  # built-in cover + 9 content

    def test_base_template_keeps_its_cover_and_drops_builtin(self):
        from services.brief_renderer import render_wing_brief
        tpl = _make_base_template(2)
        prs = Presentation(io.BytesIO(
            render_wing_brief(_minimal_wing_brief(), base_template_b64=tpl)
        ))
        # 2 template slides + 9 content (built-in cover dropped) = 11.
        assert len(prs.slides._sldIdLst) == 11
        # The deck still opens and the first slide is the template's cover.
        first = prs.slides[0]
        text = " ".join(
            r.text for sh in first.shapes if sh.has_text_frame
            for p in sh.text_frame.paragraphs for r in p.runs
        )
        assert "COVER 1" in text

    def test_bad_template_falls_back_to_default(self):
        from services.brief_renderer import render_wing_brief
        prs = Presentation(io.BytesIO(
            render_wing_brief(_minimal_wing_brief(), base_template_b64="not-valid-base64!!")
        ))
        # Garbage template must not break the brief — falls back to default.
        assert len(prs.slides._sldIdLst) == 10

    def test_data_uri_prefixed_template_is_accepted(self):
        from services.brief_renderer import render_wing_brief
        tpl = "data:application/vnd.ms-powerpoint;base64," + _make_base_template(1)
        prs = Presentation(io.BytesIO(
            render_wing_brief(_minimal_wing_brief(), base_template_b64=tpl)
        ))
        # 1 template slide + 9 content = 10.
        assert len(prs.slides._sldIdLst) == 10


def _set_master_bg(prs, inner_fill_xml: str):
    """Inject a <p:bg> with the given fill into the presentation's master."""
    from pptx.oxml import parse_xml
    from pptx.oxml.ns import nsdecls, qn
    m = prs.slide_masters[0].element
    csld = m.find(qn("p:cSld"))
    bg = parse_xml(
        f'<p:bg {nsdecls("p", "a")}><p:bgPr>{inner_fill_xml}<a:effectLst/></p:bgPr></p:bg>'
    )
    csld.insert(0, bg)


def _template_with_bg(inner_fill_xml: str) -> str:
    import base64
    prs = Presentation()
    prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
    _set_master_bg(prs, inner_fill_xml)
    prs.slides.add_slide(prs.slide_layouts[6])
    out = io.BytesIO(); prs.save(out)
    return base64.b64encode(out.getvalue()).decode("ascii")


class TestPaletteDetection:
    def test_hex_is_dark(self):
        from services.brief_renderer import _hex_is_dark
        assert _hex_is_dark("000000") is True
        assert _hex_is_dark("1A1A1A") is True
        assert _hex_is_dark("FFFFFF") is False
        assert _hex_is_dark("F3F3F3") is False
        assert _hex_is_dark("#101010") is True

    def test_no_explicit_bg_assumes_light(self):
        from services.brief_renderer import _master_bg_is_dark
        prs = Presentation()  # default master has no explicit <p:bg>
        assert _master_bg_is_dark(prs) is False

    def test_dark_srgb_master_detected_dark(self):
        from services.brief_renderer import _master_bg_is_dark
        prs = Presentation()
        _set_master_bg(prs, '<a:solidFill><a:srgbClr val="101010"/></a:solidFill>')
        assert _master_bg_is_dark(prs) is True

    def test_light_srgb_master_detected_light(self):
        from services.brief_renderer import _master_bg_is_dark
        prs = Presentation()
        _set_master_bg(prs, '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>')
        assert _master_bg_is_dark(prs) is False

    def test_scheme_lt1_is_light_dk1_is_dark(self):
        from services.brief_renderer import _master_bg_is_dark
        light = Presentation()
        _set_master_bg(light, '<a:solidFill><a:schemeClr val="lt1"/></a:solidFill>')
        assert _master_bg_is_dark(light) is False
        dk = Presentation()
        _set_master_bg(dk, '<a:solidFill><a:schemeClr val="dk1"/></a:solidFill>')
        assert _master_bg_is_dark(dk) is True

    def test_render_on_light_template_skips_black_rect(self):
        """On a light template the brief must NOT paint its dark rectangle —
        otherwise the master branding is hidden. Verify no full-slide dark
        rectangle is present on a content slide."""
        from services.brief_renderer import render_wing_brief
        from pptx.util import Emu
        tpl = _template_with_bg('<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>')
        prs = Presentation(io.BytesIO(
            render_wing_brief(_minimal_wing_brief(), base_template_b64=tpl)
        ))
        # A content slide (last one = Notes). No autoshape should fill the
        # whole slide (that would be our dark bg rect, which we skip).
        notes_slide = prs.slides[len(prs.slides._sldIdLst) - 1]
        full = [sh for sh in notes_slide.shapes
                if sh.width and sh.height
                and sh.width >= prs.slide_width and sh.height >= prs.slide_height]
        assert full == []
