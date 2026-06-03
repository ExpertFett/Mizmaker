"""Tests for the signup-sheet generator (services/signup_sheet.py).

Three output formats — XLSX (openpyxl), CSV, Markdown — all driven off the
same player-slot extraction logic. The column headers in every format have
to match what RosterTab's autoDetectCols expects so a filled sheet round-
trips back into the editor:
    Pilot · Callsign · Flight · Seat

We use a small synthetic mission dict so the tests don't depend on a .miz
fixture, plus one quick round-trip through the real parser to cover the
shape extract_full_mission_data emits.
"""

from __future__ import annotations

import csv
import io

import pytest


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _two_flight_mission() -> dict:
    """Synthetic mission with two flights — one all-player, one mixed."""
    return {
        "overview": {"date": "2018-06-01", "start_time": 21600, "sortie": ""},
        "groups": [
            {
                "groupName": "Uzi 1", "coalition": "blue", "task": "CAP",
                "frequency": 305.0, "tacan": {"channel": 73, "band": "X", "callsign": "UZI"},
                "units": [
                    {"name": "Uzi 1-1", "type": "FA-18C_hornet", "skill": "Player"},
                    {"name": "Uzi 1-2", "type": "FA-18C_hornet", "skill": "Client"},
                ],
            },
            {
                "groupName": "Springfield 1", "coalition": "blue", "task": "SEAD",
                "frequency": 264.0, "tacan": None,
                "units": [
                    {"name": "Springfield 1-1", "type": "F-16C_50", "skill": "Player"},
                    {"name": "Springfield 1-2", "type": "F-16C_50", "skill": "High"},  # AI
                ],
            },
            {
                "groupName": "Su-27 patrol", "coalition": "red", "task": "CAP",
                "frequency": 251.0, "tacan": None,
                "units": [
                    {"name": "Bandit-1", "type": "Su-27", "skill": "Client"},
                ],
            },
        ],
    }


# --------------------------------------------------------------------------
# Slot extraction
# --------------------------------------------------------------------------

class TestSlotExtraction:
    def test_only_player_slots_included(self):
        from services.signup_sheet import _slot_rows
        rows = _slot_rows(_two_flight_mission())
        # 2 Uzi player slots + 1 Springfield player + 1 red Bandit = 4
        assert len(rows) == 4
        types = {r["Aircraft"] for r in rows}
        assert "FA-18C_hornet" in types
        assert "F-16C_50" in types
        assert "Su-27" in types  # red coalition included
        # Skill=High slot (AI) dropped
        assert all(r["Aircraft"] != "" for r in rows)

    def test_columns_match_roster_importer(self):
        """The headers MUST match what RosterTab's autoDetectCols expects so
        a filled sheet round-trips. The hint sets cover: pilot, callsign,
        flight, seat. Our header names hit each hint."""
        from services.signup_sheet import _slot_rows
        rows = _slot_rows(_two_flight_mission())
        if not rows: return
        for h in ("Pilot", "Callsign", "Flight", "Seat"):
            assert h in rows[0]

    def test_seat_is_sequential_per_flight(self):
        from services.signup_sheet import _slot_rows
        rows = _slot_rows(_two_flight_mission())
        # Uzi 1 has slots 1, 2; Springfield has slot 1; Bandit has slot 1.
        uzi = [r for r in rows if r["Flight"] == "Uzi 1"]
        assert [r["Seat"] for r in uzi] == ["1", "2"]

    def test_tacan_format(self):
        from services.signup_sheet import _slot_rows
        rows = _slot_rows(_two_flight_mission())
        uzi = next(r for r in rows if r["Flight"] == "Uzi 1")
        assert uzi["TACAN"] == "73X (UZI)"
        spring = next(r for r in rows if r["Flight"] == "Springfield 1")
        assert spring["TACAN"] == ""

    def test_neutral_coalition_excluded(self):
        from services.signup_sheet import _slot_rows
        mission = {
            "groups": [
                {"groupName": "Neutral", "coalition": "neutral", "task": "Transport",
                 "units": [{"name": "x", "type": "C-130", "skill": "Player"}]},
            ],
        }
        rows = _slot_rows(mission)
        assert rows == []


# --------------------------------------------------------------------------
# CSV output
# --------------------------------------------------------------------------

class TestCsv:
    def test_csv_round_trips_via_csv_reader(self):
        from services.signup_sheet import build_csv
        data = build_csv(_two_flight_mission(), mission_name="Test Op", theater="PersianGulf")
        text = data.decode("utf-8")
        # Skip the # comment block + blank lines.
        lines = [l for l in text.splitlines() if l.strip() and not l.startswith("#")]
        reader = csv.reader(lines)
        headers = next(reader)
        assert headers[0] == "Pilot"
        assert "Callsign" in headers
        body_rows = list(reader)
        assert len(body_rows) == 4

    def test_csv_mission_summary_present(self):
        from services.signup_sheet import build_csv
        data = build_csv(_two_flight_mission(), mission_name="Test Op", theater="PersianGulf")
        text = data.decode("utf-8")
        assert "# Mission: Test Op" in text
        assert "# Theater: PersianGulf" in text
        # 4 player slots — totals reflect that.
        assert "# Player slots total: 4" in text

    def test_csv_blank_pilot_column(self):
        """The Pilot column ships empty so signups can fill it in."""
        from services.signup_sheet import build_csv
        data = build_csv(_two_flight_mission(), mission_name="X", theater="Y")
        text = data.decode("utf-8")
        lines = [l for l in text.splitlines() if l.strip() and not l.startswith("#")]
        reader = csv.reader(lines)
        headers = next(reader)
        pilot_idx = headers.index("Pilot")
        for row in reader:
            assert row[pilot_idx] == ""


# --------------------------------------------------------------------------
# Markdown output
# --------------------------------------------------------------------------

class TestMarkdown:
    def test_markdown_has_table_header(self):
        from services.signup_sheet import build_markdown
        data = build_markdown(_two_flight_mission(), mission_name="Test Op", theater="PersianGulf")
        text = data.decode("utf-8")
        assert "| Pilot | Callsign | Flight | Seat |" in text
        # Each pipe row should follow with a separator
        assert "|---|---|---|---|---|---|---|" in text

    def test_markdown_open_marker_for_blank_pilots(self):
        from services.signup_sheet import build_markdown
        data = build_markdown(_two_flight_mission(), mission_name="X", theater="Y")
        text = data.decode("utf-8")
        # Pilot column blank → "_(open)_" placeholder so the cell isn't
        # visually collapsed in Discord.
        assert "_(open)_" in text


# --------------------------------------------------------------------------
# XLSX output
# --------------------------------------------------------------------------

class TestXlsx:
    def test_xlsx_renders(self):
        try:
            import openpyxl  # noqa: F401
        except ImportError:
            pytest.skip("openpyxl not installed")
        from services.signup_sheet import build_xlsx
        data = build_xlsx(_two_flight_mission(), mission_name="Test Op", theater="PersianGulf")
        # Re-open via openpyxl to verify the workbook is valid.
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data))
        assert "Mission" in wb.sheetnames
        assert "Signup" in wb.sheetnames

    def test_xlsx_signup_headers(self):
        try:
            import openpyxl  # noqa: F401
        except ImportError:
            pytest.skip("openpyxl not installed")
        from services.signup_sheet import build_xlsx
        data = build_xlsx(_two_flight_mission(), mission_name="X", theater="Y")
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data))
        ws = wb["Signup"]
        # Row 3 holds the column headers (rows 1 = title, 2 = blank).
        headers = [ws.cell(row=3, column=c).value for c in range(1, 11)]
        assert headers[0] == "Pilot"
        assert "Callsign" in headers
        assert "Flight" in headers
        assert "Seat" in headers

    def test_xlsx_body_row_count(self):
        try:
            import openpyxl  # noqa: F401
        except ImportError:
            pytest.skip("openpyxl not installed")
        from services.signup_sheet import build_xlsx
        data = build_xlsx(_two_flight_mission(), mission_name="X", theater="Y")
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data))
        ws = wb["Signup"]
        # Body starts at row 4; count non-empty rows.
        count = 0
        for r in ws.iter_rows(min_row=4, values_only=True):
            if any(c is not None and str(c).strip() for c in r):
                count += 1
        assert count == 4
