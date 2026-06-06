"""Cycle-fallback helpers in services/chart_fetcher.

The actual FAA fetch hits the network and is exercised only manually;
these tests cover the cheap pure functions that decide which cycles to
try when the configured one is stale.
"""

from __future__ import annotations

from services import chart_fetcher


def test_previous_cycle_decrements_month():
    assert chart_fetcher._previous_cycle("2606") == "2605"
    assert chart_fetcher._previous_cycle("2602") == "2601"


def test_previous_cycle_wraps_year_at_january():
    """Going back from YYMM "2601" rolls to "2512"."""
    assert chart_fetcher._previous_cycle("2601") == "2512"
    assert chart_fetcher._previous_cycle("2401") == "2312"


def test_previous_cycle_handles_malformed_input():
    """Defensive: a malformed cycle should be returned unchanged so callers
    don't crash on an env var typo."""
    assert chart_fetcher._previous_cycle("garbage") == "garbage"
    assert chart_fetcher._previous_cycle("") == ""
    assert chart_fetcher._previous_cycle("260") == "260"  # wrong length
    assert chart_fetcher._previous_cycle("26AB") == "26AB"  # non-digits


def test_cycle_candidates_returns_primary_plus_n_older():
    """The candidate list starts with the primary cycle and walks back
    CYCLE_FALLBACK_DEPTH months."""
    cands = chart_fetcher._cycle_candidates("2606")
    assert cands[0] == "2606"
    # Default depth is 3 → 4 total entries.
    assert len(cands) == chart_fetcher.CYCLE_FALLBACK_DEPTH + 1
    assert cands == ["2606", "2605", "2604", "2603"]


def test_cycle_candidates_wraps_year_when_needed():
    """Walking back past Jan correctly rolls into December of prior year."""
    cands = chart_fetcher._cycle_candidates("2602")
    assert cands == ["2602", "2601", "2512", "2511"]


def test_cycle_candidates_floor_on_malformed_primary():
    """If primary is malformed, _previous_cycle returns it unchanged and
    the candidate-builder must stop instead of looping forever."""
    cands = chart_fetcher._cycle_candidates("garbage")
    # We at least get the input back; we MUST NOT infinite-loop.
    assert cands[0] == "garbage"
    assert len(cands) == 1
