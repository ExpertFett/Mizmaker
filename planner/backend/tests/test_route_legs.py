"""Per-leg distance and cumulative time on a route.

Four kneeboard cards read `leg_distance_nm` and `cumulative_eta` — the lineup
card's distance and ETE columns, the route detail card, the fuel ladder, and
the strip map doghouses. Nothing produced either field: the parser emitted the
mission's own ETA under the name `eta_seconds` and never computed distance at
all, so all four rendered dashes and a zero fuel burn on every mission.
"""
import pytest

from services.miz_parser import _fill_route_legs, _great_circle_nm


def wp(lat=None, lon=None, speed_ms=200.0, eta=0.0):
    return {"lat": lat, "lon": lon, "speed_ms": speed_ms, "eta_seconds": eta}


class TestGreatCircle:
    def test_one_degree_of_latitude_is_sixty_nm(self):
        assert _great_circle_nm(0, 0, 1, 0) == pytest.approx(60, abs=0.5)

    def test_longitude_shrinks_toward_the_pole(self):
        at_equator = _great_circle_nm(0, 0, 0, 1)
        at_sixty_north = _great_circle_nm(60, 0, 60, 1)
        assert at_sixty_north == pytest.approx(at_equator / 2, rel=0.02)

    def test_zero_for_the_same_point(self):
        assert _great_circle_nm(69.7, 29.9, 69.7, 29.9) == 0

    def test_is_symmetric(self):
        assert _great_circle_nm(69, 30, 70, 31) == _great_circle_nm(70, 31, 69, 30)


class TestDistances:
    def test_first_waypoint_has_no_leg(self):
        wps = [wp(69.0, 30.0), wp(69.5, 30.0)]
        _fill_route_legs(wps)
        assert wps[0]["leg_distance_nm"] == 0.0

    def test_each_leg_measures_from_the_previous_waypoint(self):
        wps = [wp(69.0, 30.0), wp(69.5, 30.0), wp(70.0, 30.0)]
        _fill_route_legs(wps)
        assert wps[1]["leg_distance_nm"] == pytest.approx(30, abs=0.5)
        assert wps[2]["leg_distance_nm"] == pytest.approx(30, abs=0.5)

    def test_a_waypoint_without_coordinates_gets_no_distance(self):
        wps = [wp(69.0, 30.0), wp(None, None), wp(70.0, 30.0)]
        _fill_route_legs(wps)
        assert wps[1]["leg_distance_nm"] == 0.0

    def test_every_waypoint_gets_the_field_even_with_no_coordinates(self):
        wps = [wp(), wp()]
        _fill_route_legs(wps)
        assert all("leg_distance_nm" in w and "cumulative_eta" in w for w in wps)


class TestTiming:
    def test_uses_the_missions_own_etas_when_it_has_them(self):
        """A route with locked timing flies to its ETAs; those win."""
        wps = [wp(69.0, 30.0, eta=0), wp(69.5, 30.0, eta=480), wp(70.0, 30.0, eta=1064)]
        _fill_route_legs(wps)
        assert [w["cumulative_eta"] for w in wps] == [0, 480, 1064]

    def test_derives_from_distance_and_speed_when_the_mission_sets_none(self):
        # 30 NM at 200 m/s (~389 kt) is a little under five minutes.
        wps = [wp(69.0, 30.0, eta=0), wp(69.5, 30.0, eta=0)]
        _fill_route_legs(wps)
        assert wps[1]["cumulative_eta"] == pytest.approx(278, abs=5)

    def test_derived_time_accumulates_along_the_route(self):
        wps = [wp(69.0, 30.0, eta=0), wp(69.5, 30.0, eta=0), wp(70.0, 30.0, eta=0)]
        _fill_route_legs(wps)
        assert wps[2]["cumulative_eta"] > wps[1]["cumulative_eta"] > 0

    def test_falls_back_when_the_etas_run_backwards(self):
        """Garbage timing is worse than derived timing — a schedule that goes
        backwards would give a leg negative duration and negative fuel burn."""
        wps = [wp(69.0, 30.0, eta=500), wp(69.5, 30.0, eta=100)]
        _fill_route_legs(wps)
        assert wps[1]["cumulative_eta"] > wps[0]["cumulative_eta"]

    def test_time_never_goes_backwards(self):
        wps = [wp(69.0 + i * 0.2, 30.0, speed_ms=150 + i * 20) for i in range(6)]
        _fill_route_legs(wps)
        times = [w["cumulative_eta"] for w in wps]
        assert times == sorted(times)

    def test_a_stationary_waypoint_does_not_add_time(self):
        wps = [wp(69.0, 30.0), wp(69.0, 30.0)]
        _fill_route_legs(wps)
        assert wps[1]["cumulative_eta"] == wps[0]["cumulative_eta"]

    def test_zero_speed_does_not_divide_by_zero(self):
        wps = [wp(69.0, 30.0, speed_ms=0), wp(69.5, 30.0, speed_ms=0)]
        _fill_route_legs(wps)
        assert all(w["cumulative_eta"] == 0 for w in wps)


class TestEdges:
    def test_empty_route(self):
        assert _fill_route_legs([]) is None

    def test_single_waypoint(self):
        wps = [wp(69.0, 30.0)]
        _fill_route_legs(wps)
        assert wps[0]["leg_distance_nm"] == 0.0
        assert wps[0]["cumulative_eta"] == 0.0
