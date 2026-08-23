"""Global elevation lookup.

The planner was SRTM-only, which covers 60S-60N — so the entire Kola theatre
returned null. These cover the tile maths and the batch grouping without
touching the network; the live-fetch checks are marked and skipped by default.
"""
import os

import pytest

from services import elevation as ev


class FakeSrtm:
    """Stands in for srtm.py. Returns a fixed value inside its coverage."""

    def __init__(self, value=100.0, raises=False):
        self.value = value
        self.raises = raises
        self.calls = []

    def get_elevation(self, lat, lon):
        self.calls.append((lat, lon))
        if self.raises:
            raise RuntimeError("tile download failed")
        return self.value


class FakeTile:
    """A Terrarium tile where every pixel encodes the same height."""

    def __init__(self, metres):
        raw = metres + 32768
        self.r = int(raw // 256)
        rem = raw - self.r * 256
        self.g = int(rem)
        self.b = int(round((rem - self.g) * 256)) % 256

    def getpixel(self, xy):
        return (self.r, self.g, self.b)


@pytest.fixture(autouse=True)
def _clean():
    ev.clear_cache()
    yield
    ev.clear_cache()


class TestTileMaths:
    def test_lon_zero_lat_zero_is_the_middle_of_the_world(self):
        n = 2 ** ev.TERRARIUM_ZOOM
        x, y, _, _ = ev._deg_to_tile(0.0, 0.0, ev.TERRARIUM_ZOOM)
        assert x == n // 2
        assert y == n // 2

    def test_x_increases_eastward_and_y_increases_southward(self):
        west = ev._deg_to_tile(0, -100, ev.TERRARIUM_ZOOM)
        east = ev._deg_to_tile(0, 100, ev.TERRARIUM_ZOOM)
        north = ev._deg_to_tile(60, 0, ev.TERRARIUM_ZOOM)
        south = ev._deg_to_tile(-60, 0, ev.TERRARIUM_ZOOM)
        assert west[0] < east[0]
        assert north[1] < south[1]

    def test_pixel_offsets_stay_in_the_tile(self):
        for lat, lon in [(69.7, 29.9), (-33.9, 151.2), (0.0, 0.0), (85.0, 179.9)]:
            _, _, px, py = ev._deg_to_tile(lat, lon, ev.TERRARIUM_ZOOM)
            assert 0 <= px < 256
            assert 0 <= py < 256

    def test_poles_are_clamped_rather_than_producing_infinity(self):
        x, y, px, py = ev._deg_to_tile(90.0, 0.0, ev.TERRARIUM_ZOOM)
        assert all(map(lambda v: v == v, (x, y, px, py)))  # not NaN
        assert y >= 0


class TestDecode:
    def test_sea_level(self):
        assert ev._decode(128, 0, 0) == 0

    def test_known_encoding_round_trip(self):
        for metres in (0, 1, 88, 420, 8848, -86):
            t = FakeTile(metres)
            assert abs(ev._decode(t.r, t.g, t.b) - metres) < 1

    def test_below_sea_level_decodes_negative(self):
        t = FakeTile(-420)
        assert ev._decode(t.r, t.g, t.b) < 0


class TestSrtmFirst:
    def test_srtm_is_used_inside_its_coverage(self, monkeypatch):
        monkeypatch.setattr(ev, "terrarium_elevation", lambda *a: pytest.fail("should not fetch"))
        srtm = FakeSrtm(250.0)
        assert ev.get_elevation(40.0, -3.0, srtm) == 250.0

    def test_above_sixty_north_skips_srtm_entirely(self, monkeypatch):
        """The Kola case: SRTM has no data there, so do not even ask."""
        monkeypatch.setattr(ev, "terrarium_elevation", lambda lat, lon: 88.0)
        srtm = FakeSrtm(250.0)
        assert ev.get_elevation(69.72, 29.89, srtm) == 88.0
        assert srtm.calls == []

    def test_falls_through_when_srtm_returns_nothing(self, monkeypatch):
        monkeypatch.setattr(ev, "terrarium_elevation", lambda lat, lon: 42.0)
        assert ev.get_elevation(40.0, -3.0, FakeSrtm(None)) == 42.0

    def test_falls_through_when_srtm_raises(self, monkeypatch):
        monkeypatch.setattr(ev, "terrarium_elevation", lambda lat, lon: 42.0)
        assert ev.get_elevation(40.0, -3.0, FakeSrtm(raises=True)) == 42.0

    def test_works_with_no_srtm_handle_at_all(self, monkeypatch):
        monkeypatch.setattr(ev, "terrarium_elevation", lambda lat, lon: 7.0)
        assert ev.get_elevation(40.0, -3.0, None) == 7.0


class TestBatch:
    def test_result_matches_input_length_and_order(self, monkeypatch):
        monkeypatch.setattr(ev, "_load_tile", lambda z, x, y: FakeTile(300))
        pts = [(69.0, 29.0), (69.1, 29.1), (69.2, 29.2)]
        out = ev.get_elevations(pts, None)
        assert len(out) == 3
        assert all(abs(v - 300) < 1 for v in out)

    def test_one_tile_is_fetched_once_for_many_points(self, monkeypatch):
        """The reason batch exists: a route profile's points cluster into a
        few tiles, and fetching per point would be hundreds of requests."""
        calls = []

        def fake_load(z, x, y):
            calls.append((z, x, y))
            return FakeTile(100)

        monkeypatch.setattr(ev, "_load_tile", fake_load)
        # 200 samples inside a very small area — one or two tiles at most.
        pts = [(69.70 + i * 0.00005, 29.89 + i * 0.00005) for i in range(200)]
        ev.get_elevations(pts, None)
        assert len(calls) <= 2
        assert len(set(calls)) == len(calls)

    def test_a_missing_tile_blanks_only_its_own_points(self, monkeypatch):
        def fake_load(z, x, y):
            # Fail exactly one tile.
            return None if x % 2 == 0 else FakeTile(500)

        monkeypatch.setattr(ev, "_load_tile", fake_load)
        pts = [(10.0, -170.0), (10.0, 170.0)]
        out = ev.get_elevations(pts, None)
        assert any(v is None for v in out)
        assert any(v is not None for v in out)

    def test_srtm_points_do_not_hit_the_network(self, monkeypatch):
        monkeypatch.setattr(ev, "_load_tile", lambda *a: pytest.fail("should not fetch"))
        srtm = FakeSrtm(150.0)
        out = ev.get_elevations([(40.0, -3.0), (41.0, -4.0)], srtm)
        assert out == [150.0, 150.0]

    def test_mixed_coverage_splits_between_sources(self, monkeypatch):
        monkeypatch.setattr(ev, "_load_tile", lambda z, x, y: FakeTile(900))
        srtm = FakeSrtm(150.0)
        out = ev.get_elevations([(40.0, -3.0), (69.7, 29.9)], srtm)
        assert out[0] == 150.0
        assert abs(out[1] - 900) < 1

    def test_malformed_points_become_none_instead_of_raising(self, monkeypatch):
        monkeypatch.setattr(ev, "_load_tile", lambda *a: FakeTile(10))
        out = ev.get_elevations([None, "nope", (1,), (10.0, 10.0)], None)
        assert out[:3] == [None, None, None]
        assert out[3] is not None

    def test_empty_input(self):
        assert ev.get_elevations([], None) == []


class TestFailureCaching:
    def test_a_failed_tile_is_not_retried(self, monkeypatch):
        attempts = []

        def boom(req, timeout=None):
            attempts.append(1)
            raise OSError("network down")

        monkeypatch.setattr(ev.urllib.request, "urlopen", boom)
        for _ in range(5):
            assert ev.terrarium_elevation(69.7, 29.9) is None
        assert len(attempts) == 1


@pytest.mark.skipif(
    not os.environ.get("DCSOPT_LIVE_ELEVATION"),
    reason="hits the network; set DCSOPT_LIVE_ELEVATION=1 to run",
)
class TestLive:
    def test_kola_returns_a_real_height(self):
        """The bug this module exists for: 69N used to be null."""
        assert ev.terrarium_elevation(69.7258, 29.8913) is not None

    def test_known_landmarks(self):
        assert abs(ev.terrarium_elevation(31.5, 35.5) - -420) < 60      # Dead Sea
        assert abs(ev.terrarium_elevation(36.25, -116.82) - -86) < 40   # Death Valley
        assert ev.terrarium_elevation(27.9881, 86.9250) > 8000          # Everest
