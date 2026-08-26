"""Generate a self-contained DTC test bundle: one .miz + its matching .dtc.

The mission is purpose-built to exercise every DTC feature in ONE flight, so
the whole pipeline can be validated by loading a single mission instead of
hunting through many:

  * BENGAL — F/A-18C player flight from Batumi with a multi-leg route + a CAP
    orbit leg (-> WYPT nav points, SA CAP point, SA ingress corridor).
  * Red SAM sites of several tiers placed as real platoons:
      S-300 (SA-10), Kub (SA-6), Strela-10 (SA-13), ZSU-23 guns
    each as a multi-unit site so the MEZ clustering is exercised
    (site collapse -> one ring; clean SA-10/SA-6/... labels).
  * A friendly Hawk battery (blue) — must NOT appear on BENGAL's MEZ page.
  * A Texaco S-3B tanker with a TACAN — control-measures / tanker track.

Then the saved .miz is run back through DCS:OPT's own parser + DTC builder to
emit BENGAL.dtc. Both land in the output folder (default: the Desktop).

Usage:  python tools/make_dtc_test_bundle.py [out_dir]
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import dcs
from dcs.terrain import caucasus
from dcs.countries import USA, Russia
from dcs.mapping import Point
from dcs.mission import StartType
from dcs.planes import FA_18C_hornet, S_3B
from dcs.vehicles import AirDefence
from dcs.task import OrbitAction
from dcs.unit import Skill

FT = 0.3048
NM = 1852.0


def _offset(origin, brg_deg, dist_nm, terrain):
    import math
    r = math.radians(brg_deg)
    return Point(origin.x + math.cos(r) * dist_nm * NM,
                 origin.y + math.sin(r) * dist_nm * NM, terrain)


def build_mission(out_miz: str) -> str:
    m = dcs.mission.Mission(terrain=caucasus.Caucasus())
    if USA.name not in m.coalition["blue"].countries:
        m.coalition["blue"].add_country(USA())
    if Russia.name not in m.coalition["red"].countries:
        m.coalition["red"].add_country(Russia())
    blue, red = m.country(USA.name), m.country(Russia.name)

    m.start_time = m.start_time.replace(hour=9, minute=0, second=0)
    m.weather.clouds_preset = None
    m.weather.clouds_density = 3
    m.weather.clouds_base = int(7000 * FT)
    m.weather.season_temperature = 18

    launch = m.terrain.airports["Batumi"]
    # Target reference point ~55 nm NE of Batumi — the SAM belt sits here.
    origin = _offset(launch.position, 45, 55, m.terrain)

    # --- Red SAM belt: one platoon per system, spread so they're distinct
    #     sites but each internally clustered. ---
    sam_sites = [
        ("SA-10", [AirDefence.S_300PS_40B6M_tr, AirDefence.S_300PS_64H6E_sr,
                   AirDefence.S_300PS_5P85D_ln, AirDefence.S_300PS_5P85D_ln], 0, 0),
        ("SA-6", [AirDefence.Kub_1S91_str, AirDefence.Kub_2P25_ln,
                  AirDefence.Kub_2P25_ln], 60, 18),
        ("SA-13", [AirDefence.Strela_10M3, AirDefence.Strela_10M3], 120, 26),
        ("ZSU-23", [AirDefence.ZSU_23_4_Shilka, AirDefence.ZSU_23_4_Shilka,
                    AirDefence.ZSU_23_4_Shilka], 200, 30),
    ]
    for label, types, brg, dist in sam_sites:
        centre = _offset(origin, brg, dist, m.terrain)
        g = m.vehicle_group_platoon(red, f"RED {label}", list(types),
                                    centre, heading=180)
        # spread the platoon's units a little so clustering has something to do
        for i, u in enumerate(g.units):
            u.position = Point(centre.x + i * 800, centre.y + i * 600, m.terrain)
            u.skill = Skill.High

    # --- Friendly Hawk (blue) — must be filtered off BENGAL's MEZ. ---
    hawk_pos = _offset(launch.position, 20, 12, m.terrain)
    hg = m.vehicle_group_platoon(
        blue, "BLUE HAWK",
        [AirDefence.Hawk_pcp, AirDefence.Hawk_sr, AirDefence.Hawk_tr,
         AirDefence.Hawk_ln],
        hawk_pos, heading=0)
    for u in hg.units:
        u.skill = Skill.High

    # --- Texaco tanker (S-3B) with a TACAN, orbiting off the coast. ---
    tk_pos = _offset(launch.position, 320, 30, m.terrain)
    tk = m.flight_group_inflight(blue, "TEXACO", S_3B, tk_pos,
                                 altitude=int(20000 * FT), speed=430)
    tk.units[0].out_of_the_box = True
    orbit_wp = tk.add_waypoint(_offset(tk_pos, 20, 20, m.terrain),
                               altitude=int(20000 * FT), speed=430)
    orbit_wp.tasks.append(OrbitAction(altitude=int(20000 * FT), speed=430,
                                      pattern=OrbitAction.OrbitPattern.RaceTrack))

    # --- BENGAL player flight: route Batumi -> IP -> CAP orbit -> target -> RTB.
    bengal = m.flight_group_from_airport(
        blue, "BENGAL", FA_18C_hornet, launch,
        start_type=StartType.Warm, group_size=2)
    for u in bengal.units:
        u.set_client()
    ip = _offset(origin, 225, 22, m.terrain)          # inbound IP
    cap = _offset(launch.position, 45, 30, m.terrain)  # CAP anchor mid-route
    wp_ip = bengal.add_waypoint(ip, altitude=int(24000 * FT), speed=800)
    wp_cap = bengal.add_waypoint(cap, altitude=int(25000 * FT), speed=780)
    wp_cap.tasks.append(OrbitAction(altitude=int(25000 * FT), speed=780,
                                    pattern=OrbitAction.OrbitPattern.RaceTrack))
    bengal.add_waypoint(origin, altitude=int(22000 * FT), speed=800)
    bengal.land_at(launch)

    m.save(out_miz)
    return out_miz


def build_dtc(miz_path: str, out_dtc: str) -> str:
    import zipfile
    from services.miz_parser import parse_mission_text, extract_full_mission_data
    from services.dtc_builder import (extract_flight_for_dtc, build_dtc_from_flight,
                                      serialize_dtc)
    mtext = zipfile.ZipFile(miz_path).read("mission").decode("utf-8", "ignore")
    mdict = parse_mission_text(mtext)
    fe = extract_flight_for_dtc(mdict, "BENGAL")
    fe["theatre"] = "Caucasus"
    fe["threats"] = extract_full_mission_data(mdict, "Caucasus").get("threats", [])
    dtc = build_dtc_from_flight(fe, "BENGAL")
    with open(out_dtc, "wb") as f:
        f.write(serialize_dtc(dtc))
    return dtc


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.expanduser("~"), "Desktop")
    if not os.path.isdir(out_dir):
        out_dir = os.getcwd()
    miz = os.path.join(out_dir, "DCSOPT_DTC_TEST.miz")
    dtc = os.path.join(out_dir, "BENGAL.dtc")

    build_mission(miz)
    print(f"miz  -> {miz}  ({os.path.getsize(miz):,} B)")
    data = build_dtc(miz, dtc)
    sa = data["data"]["SA"]
    print(f"dtc  -> {dtc}  ({os.path.getsize(dtc):,} B)")
    print(f"  MEZ sites : {len(sa['MEZ_THRTS'])} "
          f"({', '.join(m['text'] for m in sa['MEZ_THRTS'])})")
    print(f"  CAP points: {len(sa['CAP_PTS'])}")
    print(f"  corridors : {len(sa['CORRIDORS'])} "
          f"({sa['CORRIDORS'][0]['points'] and len(sa['CORRIDORS'][0]['points'])} pts)"
          if sa["CORRIDORS"] else "  corridors : 0")
    print(f"  nav pts   : {len(data['data']['WYPT']['NAV_PTS'])}")


if __name__ == "__main__":
    main()
