"""
pydcs Mission -> MCT Community Standard.

MissionGen and CivTraffic both build a live `dcs.mission.Mission` object and
save a .miz; neither keeps an intermediate plan structure. So rather than
writing a bespoke emitter for each, this adapter reads the pydcs object
itself - which makes it work for ANY pydcs-based generator we write later.

The two conversions pydcs tools always need:

  coordinates  pydcs works in theatre-local metres (Point.x = northing,
               Point.y = easting). The standard is WGS-84 only, so every
               point is projected. A tool whose theatre has no published
               projection parameters cannot export - that is a hard error
               rather than a silent (0, 0).
  time         pydcs has `start_time` as a datetime; the standard wants an
               ISO date plus seconds-since-midnight.

A document carries one coalition, so a mission with both sides exports as
two documents - which is exactly MissionGen's blue-package / red-IADS split.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from .. import build, ids, projection, vocab

TOOL_SOURCE = "pydcs"


def _type_name(obj: Any) -> str:
    """pydcs stores unit type as a class, an id string, or an instance."""
    for attr in ("id", "Id"):
        val = getattr(obj, attr, None)
        if isinstance(val, str):
            return val
    if isinstance(obj, str):
        return obj
    return getattr(obj, "__name__", "") or str(obj or "")


def _terrain_name(mission: Any) -> str:
    terrain = getattr(mission, "terrain", None)
    return getattr(terrain, "name", None) or "Unknown"


def _mission_time(mission: Any) -> tuple:
    """-> (ISO date, seconds since midnight)."""
    start = getattr(mission, "start_time", None)
    if isinstance(start, datetime):
        return (start.date().isoformat(),
                start.hour * 3600 + start.minute * 60 + start.second)
    # Some pydcs versions expose start_time as raw seconds.
    if isinstance(start, (int, float)):
        return ("2000-01-01", int(start))
    return ("2000-01-01", 0)


def _flight_groups(mission: Any, side: str) -> List[Any]:
    coalition = getattr(mission, "coalition", {}).get(side)
    if coalition is None:
        return []
    groups = []
    for country in getattr(coalition, "countries", {}).values():
        groups.extend(getattr(country, "plane_group", []) or [])
        groups.extend(getattr(country, "helicopter_group", []) or [])
    return groups


def _waypoints(doc: str, group: Any, theater: str) -> List[Dict[str, Any]]:
    out = []
    gname = getattr(group, "name", "") or ""
    for i, pt in enumerate(getattr(group, "points", []) or []):
        pos = getattr(pt, "position", None)
        if pos is None:
            continue
        lat, lon = projection.try_latlon(pos.x, pos.y, theater)
        if lat is None:
            continue
        alt_type = str(getattr(pt, "alt_type", "BARO") or "BARO").upper()
        eta = getattr(pt, "ETA", None)
        out.append(build.waypoint(
            wp_id=ids.waypoint_id(doc, gname, i),
            wp_type=vocab.waypoint_type(
                str(getattr(pt, "type", "")),
                str(getattr(pt, "action", "")),
                str(getattr(pt, "name", "")),
            ),
            lat=lat, lon=lon,
            name=str(getattr(pt, "name", "") or f"WP{i}"),
            # pydcs altitudes are metres, like the .miz.
            altitude_ft=vocab.m_to_ft(getattr(pt, "alt", None)),
            altitude_ref="MSL" if alt_type.startswith("BARO") else "AGL",
            speed=vocab.mps_to_kts(getattr(pt, "speed", None)),
            speed_type="TAS",
            eta_seconds=int(eta) if isinstance(eta, (int, float)) and eta else None,
        ))
    return out


def to_op_task_air(mission: Any, *, coalition: str = "blue",
                   package_name: str = None,
                   mission_type: str = None,
                   tool_source: str = TOOL_SOURCE,
                   mission_name: str = None,
                   extensions: Dict[str, Any] = None) -> Dict[str, Any]:
    """Build a community-op-task-air document from a live pydcs Mission.

    `mission_type` overrides the per-group task mapping, which is useful
    for generators that know the tasking better than the DCS task string
    does (MissionGen knows its package is a STRIKE regardless of what
    pydcs recorded).

    `extensions` is merged into the `dcsopt` namespace, so a generator can
    attach its own authoring inputs - MissionGen's seed / era / threat
    level and its whole IADS table, none of which the core schema models.
    """
    theater = _terrain_name(mission)
    side = str(coalition).strip().lower()
    date, time_seconds = _mission_time(mission)

    name = mission_name or theater
    doc = ids.doc_id(tool_source, theater, f"{name}:{side}")
    pkg_name = (package_name or name or "PACKAGE").upper()
    pkg_id = ids.package_id(doc, pkg_name)

    assets: List[Dict[str, Any]] = []
    routes: List[Dict[str, Any]] = []
    all_waypoints: List[Dict[str, Any]] = []
    skipped: List[str] = []

    for group in _flight_groups(mission, side):
        gname = getattr(group, "name", "") or ""
        units = list(getattr(group, "units", []) or [])
        wps = _waypoints(doc, group, theater)

        # Needs two points to make the one leg Route.legs requires. A
        # generator that only stamped a spawn point produces no route.
        if not build.is_routable(wps):
            skipped.append(str(gname))
            continue

        all_waypoints.extend(wps)
        a_id = ids.asset_id(doc, gname)
        r_id = ids.route_id(doc, gname)

        # A pydcs unit is a client slot when set_client() flipped its skill.
        skills = [str(getattr(u, "skill", "") or "") for u in units]

        assets.append(build.asset(
            asset_id=a_id,
            package_id=pkg_id,
            callsign=str(gname),
            airframe=vocab.airframe(_type_name(getattr(units[0], "type", "")) if units else ""),
            route_id=r_id,
            flight_number=len(units) or 1,
            mission_type=mission_type or vocab.mission_type(
                str(getattr(group, "task", "") or "")),
            control_type=vocab.control_type(skills),
            flight_members=[
                build.flight_member(
                    pilot_name=str(getattr(u, "name", "") or "") or None,
                    role=vocab.flight_position(i, len(units)),
                    onboard_number=str(getattr(u, "onboard_num", "") or "") or None,
                )
                for i, u in enumerate(units)
            ] or None,
        ))
        routes.append(build.route(r_id, a_id, build.legs_from_waypoints(wps)))

    if not assets:
        detail = (f" Skipped {len(skipped)} group(s) with fewer than two "
                  f"waypoints: {', '.join(skipped[:5])}." if skipped else "")
        raise build.NotExportable(
            f"No exportable flights for coalition '{side}'.{detail}"
        )

    ns = {"dcs_theater": theater, "generator": tool_source}
    if skipped:
        ns["skipped_flights"] = skipped
    if extensions:
        ns.update(extensions)

    return build.op_task_air(
        doc_id=doc,
        coalition=vocab.coalition(side),
        mission_context=build.mission_context(
            theatre=vocab.theatre(theater),
            date=date,
            time_seconds=time_seconds,
            bullseye_blue=_bullseye(mission, "blue", theater),
            bullseye_red=_bullseye(mission, "red", theater),
        ),
        packages=[build.package(pkg_id, pkg_name)],
        assets=assets,
        routes=routes,
        waypoints=all_waypoints if len(all_waypoints) >= build.MIN_WAYPOINTS else None,
        extensions=build.ext(dcsopt=ns),
        tool_source=tool_source,
    )


def _bullseye(mission: Any, side: str, theater: str) -> Optional[Dict[str, Any]]:
    coalition = getattr(mission, "coalition", {}).get(side)
    be = getattr(coalition, "bullseye", None) if coalition else None
    if not be:
        return None
    x = be.get("x") if isinstance(be, dict) else getattr(be, "x", None)
    y = be.get("y") if isinstance(be, dict) else getattr(be, "y", None)
    if x is None or y is None:
        return None
    lat, lon = projection.try_latlon(x, y, theater)
    return build.latlon(lat, lon) if lat is not None else None


def coalitions_present(mission: Any) -> List[str]:
    return [s for s in ("blue", "red") if _flight_groups(mission, s)]
