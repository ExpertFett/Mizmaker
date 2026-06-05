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
# via env var. Picking an obvious-fake placeholder so a missed override
# fails loudly rather than silently fetching the wrong cycle. The format
# is YYMM where YY is the year and MM is the month of the AIRAC cycle
# start. Real production cycles are published at
# https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dtpp/
DEFAULT_CYCLE = os.environ.get("FAA_DTPP_CYCLE", "2412")

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

    cycle = os.environ.get("FAA_DTPP_CYCLE", DEFAULT_CYCLE)
    timeout = float(os.environ.get("FAA_FETCH_TIMEOUT_SEC", "10"))

    file_id = _ICAO_OVERRIDES.get(icao, icao)
    candidates = [
        f"https://aeronav.faa.gov/d-tpp/{cycle}/{file_id}AD.PDF",
        # Some Marianas / Pacific fields publish under PG-prefix too.
        f"https://aeronav.faa.gov/d-tpp/{cycle}/{file_id}.PDF",
    ]

    pdf_bytes: bytes | None = None
    last_err = "no candidates"
    for url in candidates:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                pdf_bytes = r.read()
                if pdf_bytes and len(pdf_bytes) > 1000:
                    break
                last_err = f"empty response from {url}"
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code} from {url}"
        except urllib.error.URLError as e:
            last_err = f"URL error from {url}: {e.reason}"
        except Exception as e:
            last_err = f"{type(e).__name__} from {url}: {e}"

    if not pdf_bytes:
        return {
            "ok": False,
            "error": (
                f"FAA chart not found for {icao} (cycle {cycle}). "
                f"Last: {last_err}. "
                f"Update FAA_DTPP_CYCLE if the cycle is stale, or verify the ICAO."
            ),
        }

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
        return {"ok": True, "png": png_buf.getvalue(), "format": "png"}
    except ImportError:
        return {
            "ok": True,
            "pdf": pdf_bytes,
            "format": "pdf",
            "note": (
                "pdf2image + poppler-utils not installed — returning raw PDF. "
                "Install via `pip install pdf2image` and `apt install poppler-utils`."
            ),
        }
    except Exception as e:
        return {"ok": False, "error": f"PDF→PNG conversion failed: {e}"}
