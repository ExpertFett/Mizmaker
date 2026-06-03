"""Signup-sheet generator for mission events.

Turns a parsed mission into a downloadable signup sheet so the event runner
can post it (Discord / squadron Slack / printed kneeboard) and pilots fill
in their names against the player slots. Filled-in sheets round-trip back
into the Editor via the existing Roster tab importer — the column headers
here MATCH what RosterTab auto-detects (Pilot / Callsign / Flight / Seat).

Three output formats:
  - xlsx  — workbook with a Mission summary sheet + Signup table sheet
            (most useful: opens in Excel/Sheets, editable, pretty-formatted)
  - csv   — flat spreadsheet, no formatting (universal fallback)
  - md    — Markdown table, drops cleanly into Discord / forum posts

Pulls ONLY player flights (skill in {Player, Client}). AI flights are
included on the Mission sheet for context but not in the Signup table.
"""

from __future__ import annotations

import csv
import io
from typing import Any


def _is_player_slot(unit: dict) -> bool:
    skill = (unit.get("skill") or "").strip().lower()
    return skill in ("player", "client")


def _is_player_group(group: dict) -> bool:
    return any(_is_player_slot(u) for u in (group.get("units") or []))


def _slot_rows(mission_data: dict) -> list[dict]:
    """One row per player/client slot. Each row carries the keys the
    Roster importer auto-detects so a filled sheet round-trips."""
    groups = mission_data.get("groups") or []
    rows: list[dict] = []
    for g in groups:
        if g.get("coalition") not in ("blue", "red"):
            # Skip neutral — almost never has signup-able player slots.
            continue
        units = g.get("units") or []
        # Player slots within a group, in their declared order so "1-1, 1-2,
        # 1-3, 1-4" stay sequenced.
        for idx, u in enumerate(units, start=1):
            if not _is_player_slot(u):
                continue
            rows.append({
                "Pilot": "",                                          # sign-in goes here
                "Callsign": (u.get("name") or "").strip(),            # default callsign (pilots can override)
                "Flight": (g.get("groupName") or "").strip(),
                "Seat": str(idx),
                "Aircraft": (u.get("type") or "").strip(),
                "Coalition": (g.get("coalition") or "").strip(),
                "Role": (g.get("task") or "").strip().upper() or "—",
                "Frequency (MHz)": f"{g.get('frequency')}" if g.get("frequency") else "—",
                "TACAN": _format_tacan(g.get("tacan")),
                "Notes": "",
            })
    return rows


def _format_tacan(tacan: Any) -> str:
    if not tacan or not isinstance(tacan, dict):
        return ""
    ch = tacan.get("channel")
    band = tacan.get("band") or ""
    cs = tacan.get("callsign") or ""
    if not ch:
        return ""
    return f"{ch}{band}{f' ({cs})' if cs else ''}"


def _mission_summary(mission_data: dict, *, mission_name: str, theater: str) -> list[tuple[str, str]]:
    """Key/value pairs for the Mission sheet header."""
    overview = mission_data.get("overview") or {}
    groups = mission_data.get("groups") or []
    blue_player_groups = sum(1 for g in groups if _is_player_group(g) and g.get("coalition") == "blue")
    red_player_groups = sum(1 for g in groups if _is_player_group(g) and g.get("coalition") == "red")
    player_slots = sum(
        sum(1 for u in (g.get("units") or []) if _is_player_slot(u))
        for g in groups if g.get("coalition") in ("blue", "red")
    )
    rows: list[tuple[str, str]] = [
        ("Mission", mission_name or "—"),
        ("Theater", theater or "—"),
        ("Date", str(overview.get("date") or "—")),
        ("Start (Zulu sec)", str(overview.get("start_time") or "—")),
        ("Player flights — Blue", str(blue_player_groups)),
        ("Player flights — Red", str(red_player_groups)),
        ("Player slots total", str(player_slots)),
    ]
    return rows


# ---------------------------------------------------------------------------
# XLSX output (openpyxl)
# ---------------------------------------------------------------------------

def build_xlsx(mission_data: dict, *, mission_name: str = "", theater: str = "") -> bytes:
    """Generate an XLSX signup sheet. Raises ImportError if openpyxl is
    missing — caller should surface that to the user.

    The workbook has two sheets:
      - "Mission"  — key/value table (mission name, theater, date, etc.)
      - "Signup"   — the signup table the event runner shares around
    """
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    # ── Mission sheet ────────────────────────────────────────────────────
    ws_m = wb.active
    ws_m.title = "Mission"
    ws_m["A1"] = "MISSION DETAILS"
    ws_m["A1"].font = Font(bold=True, size=14, color="FFA500")
    ws_m.merge_cells("A1:B1")
    for i, (k, v) in enumerate(_mission_summary(mission_data, mission_name=mission_name, theater=theater), start=3):
        ws_m.cell(row=i, column=1, value=k).font = Font(bold=True)
        ws_m.cell(row=i, column=2, value=v)
    ws_m.column_dimensions["A"].width = 24
    ws_m.column_dimensions["B"].width = 38

    # ── Signup sheet ─────────────────────────────────────────────────────
    ws_s = wb.create_sheet("Signup")
    headers = ["Pilot", "Callsign", "Flight", "Seat", "Aircraft",
               "Coalition", "Role", "Frequency (MHz)", "TACAN", "Notes"]
    # Title row
    ws_s["A1"] = f"SIGNUP — {mission_name or 'Mission'}"
    ws_s["A1"].font = Font(bold=True, size=14, color="FFA500")
    ws_s.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(headers))
    # Header row
    header_fill = PatternFill(start_color="222222", end_color="222222", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    header_align = Alignment(horizontal="center", vertical="center")
    thin = Side(border_style="thin", color="666666")
    border = Border(top=thin, bottom=thin, left=thin, right=thin)
    for col, h in enumerate(headers, start=1):
        c = ws_s.cell(row=3, column=col, value=h)
        c.font = header_font
        c.fill = header_fill
        c.alignment = header_align
        c.border = border
    # Body rows
    rows = _slot_rows(mission_data)
    for r_idx, row in enumerate(rows, start=4):
        for c_idx, h in enumerate(headers, start=1):
            c = ws_s.cell(row=r_idx, column=c_idx, value=row.get(h, ""))
            c.border = border
            if h == "Pilot":
                # Pilot column gets a subtle highlight so signups are obvious.
                c.fill = PatternFill(start_color="2A2A1A", end_color="2A2A1A", fill_type="solid")
    # Column widths sized to the typical content.
    widths = {"A": 24, "B": 16, "C": 18, "D": 6, "E": 14, "F": 10, "G": 12, "H": 14, "I": 12, "J": 28}
    for col, w in widths.items():
        ws_s.column_dimensions[col].width = w
    # Freeze the title + header so scrolling keeps them visible.
    ws_s.freeze_panes = "A4"
    # Save → bytes
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# CSV output
# ---------------------------------------------------------------------------

def build_csv(mission_data: dict, *, mission_name: str = "", theater: str = "") -> bytes:
    """Plain CSV; one header row + one row per player slot. Mission summary
    is emitted as a comment block at the top so the data is still parseable."""
    headers = ["Pilot", "Callsign", "Flight", "Seat", "Aircraft",
               "Coalition", "Role", "Frequency (MHz)", "TACAN", "Notes"]
    buf = io.StringIO()
    # Mission summary as # comments — survives Excel import and shows context
    # when the file is opened raw.
    for k, v in _mission_summary(mission_data, mission_name=mission_name, theater=theater):
        buf.write(f"# {k}: {v}\n")
    buf.write("\n")
    w = csv.writer(buf)
    w.writerow(headers)
    for row in _slot_rows(mission_data):
        w.writerow([row.get(h, "") for h in headers])
    return buf.getvalue().encode("utf-8")


# ---------------------------------------------------------------------------
# Markdown output (Discord-friendly)
# ---------------------------------------------------------------------------

def build_markdown(mission_data: dict, *, mission_name: str = "", theater: str = "") -> bytes:
    """Markdown table — pastes cleanly into Discord (`/preview`), forums,
    GitHub issues, etc."""
    parts: list[str] = []
    parts.append(f"# {mission_name or 'Mission Signup'}")
    parts.append("")
    parts.append("**Details**")
    for k, v in _mission_summary(mission_data, mission_name=mission_name, theater=theater):
        parts.append(f"- **{k}**: {v}")
    parts.append("")
    parts.append("## Signup")
    parts.append("")
    headers = ["Pilot", "Callsign", "Flight", "Seat", "Aircraft", "Role", "Freq"]
    parts.append("| " + " | ".join(headers) + " |")
    parts.append("|" + "|".join("---" for _ in headers) + "|")
    for row in _slot_rows(mission_data):
        # Use a non-breaking-space-ish blank so Discord renders the empty
        # cell as visibly empty rather than collapsing the column.
        pilot = (row["Pilot"] or "_(open)_")
        cells = [pilot, row["Callsign"], row["Flight"], row["Seat"],
                 row["Aircraft"], row["Role"], row["Frequency (MHz)"]]
        parts.append("| " + " | ".join(str(c) for c in cells) + " |")
    return ("\n".join(parts) + "\n").encode("utf-8")
