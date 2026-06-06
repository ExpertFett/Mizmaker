"""FAA chart fetcher — best-effort public-domain US airport-diagram
downloader for the Live chart-overlay panel.

FAA aeronautical charts are public domain under 17 USC §105 (works of
the US federal government). This service hits aeronav.faa.gov for the
current AIRAC cycle's airport-diagram PDF, optionally converts it to
PNG, and returns the bytes to the frontend.

Coverage: any US-managed airfield with a published FAA airport
diagram — covers the NTTR (KLSV / KINS / KLAS / KBVU / KTPH / KBTY /
KMLF / KVGT), Marianas (PGUA Andersen / PGUM Guam), Normandy era
(varies), and any other US ICAO code FAA has on file.

Known limitations (documented for the next iteration):
- FAA URLs are cycle-stamped (e.g. '2412' for the Dec 2024 AIRAC).
  This service uses a hardcoded default updated at release time; set
  the FAA_DTPP_CYCLE env var to override without redeploying.
- PDF→PNG conversion needs Poppler (`apt install poppler-utils`) +
  the pdf2image pip package. When missing the route returns raw PDF
  bytes with a hint so the frontend can fall back to PDF.js.
- Some FAA airport-diagram filenames use the FAA airport ID (5-digit
  numeric) rather than ICAO; entries with known overrides live in
  _ICAO_OVERRIDES below.

Configurable via env:
  FAA_DTPP_CYCLE   — AIRAC cycle code, e.g. '2412'.
  FAA_FETCH_TIMEOUT_SEC — per-request timeout (default 10).
"""

from __future__ import annotations

import io
import os
import urllib.error
import urllib.request


# Default cycle is "best guess at build time" — operators should override
# via env var. The format is YYMM where YY is the year and MM is the
# month of the AIRAC cycle start (FAA d-tpp publishes 13 cycles/year
# approximately one a month). Real production cycles are published at
# https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dtpp/
#
# Refreshed 2026-06-06 → "2606" (Jun 2026). Operators on Railway should
# bump FAA_DTPP_CYCLE env var every ~28 days; if the env var IS stale we
# now also try the previous N cycles (see CYCLE_FALLBACK_DEPTH) before
# giving up — so a forgotten bump degrades to a slightly-older diagram
# rather than a 404.
DEFAULT_CYCLE = "2606"

# When the primary cycle (env or DEFAULT_CYCLE) misses, walk back this many
# months trying older cycles. Tradeoff: deeper = more resilient but burns
# more requests on a cold miss. 3 covers ~90 days, which is more than enough
# slack for the "Fett forgot to bump the env var" failure mode.
CYCLE_FALLBACK_DEPTH = 3


def _previous_cycle(cycle: str) -> str:
    """Step a YYMM cycle string back one month, wrapping the year.

    `_previous_cycle("2601") == "2512"`. Defensive: malformed input
    returns the input unchanged so callers never crash.
    """
    if not (len(cycle) == 4 and cycle.isdigit()):
        return cycle
    yy = int(cycle[:2])
    mm = int(cycle[2:])
    if mm <= 1:
        yy -= 1
        mm = 12
    else:
        mm -= 1
    return f"{yy:02d}{mm:02d}"


def _cycle_candidates(primary: str) -> list[str]:
    """The cycle list to try for a single chart fetch — primary first,
    then up to CYCLE_FALLBACK_DEPTH older ones."""
    out = [primary]
    cur = primary
    for _ in range(CYCLE_FALLBACK_DEPTH):
        cur = _previous_cycle(cur)
        if cur == out[-1]:  # malformed primary or already at floor
            break
        out.append(cur)
    return out

# Polite identification — the FAA host returns 403 to anonymous fetchers
# in some cycles. Marking this as a public-domain-charts-only fetcher
# keeps us on the right side of any rate limit conversation.
USER_AGENT = "DCS-OPT/1.0 (FAA public-domain chart fetcher; +https://dcsopt.up.railway.app)"

# Some US airfields use a 5-digit FAA airport ID in their chart
# filenames rather than the 4-letter ICAO. Populated as we discover
# them — empty by default so behaviour matches the simple
# `<ICAO>AD.PDF` pattern.
_ICAO_OVERRIDES: dict[str, str] = {
    # "KLSV": "00375",  # example, verify before relying
}


def fetch_faa_airport_diagram(icao: str) -> dict:
    """Returns one of:

        {ok: True, png: bytes, format: 'png'}              — full success
        {ok: True, pdf: bytes, format: 'pdf', note: str}   — PDF only
        {ok: False, error: str}                            — failure

    The route handler picks the right mimetype based on `format`.
    """
    icao = (icao or "").upper().strip()
    if not icao:
        return {"ok": False, "error": "ICAO required"}

    primary_cycle = os.environ.get("FAA_DTPP_CYCLE", DEFAULT_CYCLE)
    timeout = float(os.environ.get("FAA_FETCH_TIMEOUT_SEC", "10"))
    file_id = _ICAO_OVERRIDES.get(icao, icao)

    # Walk: primary cycle → previous N cycles. For each cycle, try the
    # standard `<file_id>AD.PDF` filename plus the bare `<file_id>.PDF`
    # fallback used by some Marianas / Pacific fields. First non-empty
    # response wins.
    pdf_bytes: bytes | None = None
    served_cycle: str | None = None
    last_err = "no candidates"
    cycles = _cycle_candidates(primary_cycle)
    for cycle in cycles:
        urls = [
            f"https://aeronav.faa.gov/d-tpp/{cycle}/{file_id}AD.PDF",
            f"https://aeronav.faa.gov/d-tpp/{cycle}/{file_id}.PDF",
        ]
        for url in urls:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    pdf_bytes = r.read()
                    if pdf_bytes and len(pdf_bytes) > 1000:
                        served_cycle = cycle
                        break
                    last_err = f"empty response from {url}"
            except urllib.error.HTTPError as e:
                last_err = f"HTTP {e.code} from {url}"
            except urllib.error.URLError as e:
                last_err = f"URL error from {url}: {e.reason}"
            except Exception as e:
                last_err = f"{type(e).__name__} from {url}: {e}"
        if pdf_bytes:
            break

    if not pdf_bytes:
        return {
            "ok": False,
            "error": (
                f"FAA chart not found for {icao} "
                f"(tried cycles {', '.join(cycles)}). "
                f"Last: {last_err}. "
                f"Update FAA_DTPP_CYCLE if the cycle is stale, or verify the ICAO."
            ),
        }

    # Annotate the served cycle so the route handler / frontend can surface
    # "served from an older cycle than configured" — useful feedback when the
    # FAA_DTPP_CYCLE env var is stale and the fallback kicked in.
    stale_note = ""
    if served_cycle and served_cycle != primary_cycle:
        stale_note = (
            f"Served from older cycle {served_cycle} (configured: {primary_cycle}). "
            f"Bump FAA_DTPP_CYCLE on Railway to refresh."
        )

    # Best-effort PDF→PNG conversion. Without Poppler we still return
    # the PDF so the frontend can fall back to a PDF.js render or just
    # download it for the user.
    try:
        from pdf2image import convert_from_bytes  # type: ignore
        pages = convert_from_bytes(pdf_bytes, dpi=200, first_page=1, last_page=1)
        if not pages:
            return {"ok": False, "error": "FAA PDF had no pages"}
        png_buf = io.BytesIO()
        pages[0].save(png_buf, format="PNG", optimize=True)
        result = {"ok": True, "png": png_buf.getvalue(), "format": "png", "cycle": served_cycle}
        if stale_note:
            result["note"] = stale_note
        return result
    except ImportError:
        return {
            "ok": True,
            "pdf": pdf_bytes,
            "format": "pdf",
            "cycle": served_cycle,
            "note": (stale_note + " " if stale_note else "")
            + (
                "pdf2image + poppler-utils not installed — returning raw PDF. "
                "Install via `pip install pdf2image` and `apt install poppler-utils`."
            ),
        }
    except Exception as e:
        return {"ok": False, "error": f"PDF→PNG conversion failed: {e}"}
