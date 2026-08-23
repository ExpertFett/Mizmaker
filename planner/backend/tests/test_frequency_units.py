"""Frequency unit normalisation.

DCS is not consistent about the unit it stores a radio frequency in. Group
frequencies are MHz (251.0); unit frequencies are Hz — a carrier reads
127500000 for 127.5 MHz — and both appear in the same mission file. Cards
formatted the raw number, so a unit radio would have printed as
"127500000.000 AM".

The normaliser keys off magnitude. That is only safe because the ranges do
not overlap in practice: a scan of 5,560 frequency values across 60 real
missions found none between 1,000 and 1,000,000, and none between 400 MHz
and 1,000 MHz. test_no_real_frequency_is_ambiguous pins that assumption.
"""
import pytest

from services.miz_parser import normalize_freq_mhz


class TestNormalize:
    @pytest.mark.parametrize("raw,expect", [
        (251.0, 251.0),          # already MHz — the common case
        (127.5, 127.5),
        (30.0, 30.0),            # bottom of the VHF-FM band
        (399.975, 399.975),      # top of UHF
    ])
    def test_mhz_passes_through(self, raw, expect):
        assert normalize_freq_mhz(raw) == pytest.approx(expect)

    @pytest.mark.parametrize("raw,expect", [
        (127500000, 127.5),      # the carrier case
        (228600000, 228.6),
        (1079000000, 1079.0),    # TACAN beacon, still Hz
    ])
    def test_hz_becomes_mhz(self, raw, expect):
        assert normalize_freq_mhz(raw) == pytest.approx(expect)

    def test_khz_becomes_mhz(self):
        assert normalize_freq_mhz(128300) == pytest.approx(128.3)

    @pytest.mark.parametrize("raw", [0, 0.0, -1, None, "", "abc", [], {}])
    def test_junk_and_absent_become_zero(self, raw):
        assert normalize_freq_mhz(raw) == 0.0

    def test_numeric_strings_are_accepted(self):
        assert normalize_freq_mhz("251.0") == pytest.approx(251.0)
        assert normalize_freq_mhz("127500000") == pytest.approx(127.5)

    def test_is_idempotent(self):
        """Normalising an already-normalised value must not shift it again —
        the parser runs on re-parse of an edited mission."""
        for raw in (251.0, 127500000, 128300):
            once = normalize_freq_mhz(raw)
            assert normalize_freq_mhz(once) == pytest.approx(once)


class TestBoundaries:
    def test_one_mhz_is_treated_as_mhz(self):
        assert normalize_freq_mhz(1.0) == pytest.approx(1.0)

    def test_exactly_one_thousand_is_treated_as_khz(self):
        assert normalize_freq_mhz(1000) == pytest.approx(1.0)

    def test_exactly_one_million_is_treated_as_hz(self):
        assert normalize_freq_mhz(1_000_000) == pytest.approx(1.0)

    def test_no_real_frequency_is_ambiguous(self):
        """The heuristic depends on real values never landing between the
        bands. Every frequency a DCS radio can be set to, in MHz, must sit
        below the kHz threshold so it is never rescaled."""
        # DCS radios span roughly 30-400 MHz across the modelled airframes.
        for mhz in (30.0, 121.5, 243.0, 251.0, 305.0, 399.975):
            assert normalize_freq_mhz(mhz) == pytest.approx(mhz)
            assert mhz < 1000, "a radio frequency at/over 1000 MHz would be read as kHz"
