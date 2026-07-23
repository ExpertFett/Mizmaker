"""
DCS:OPT (Mizmaker) -> MCT Community Standard.

Input is exactly what `services/miz_parser.extract_full_mission_data()`
already returns:

    {overview, groups[], units[], threats[], airbases[], drawings,
     triggerZones, missionOptions}

so wiring this into the planner is a call, not a refactor. `/api/export/json`
already builds that dict.

Three structural things DCS has no concept of, which we synthesise:

  package   DCS groups flights only by coalition. We mint one package per
            document and hang every flight off it. A mission maker who
            wants real packages can override the name.
  route     DCS hangs an ordered waypoint array off the group. The standard
            wants a Route with explicit start/end legs, so we chain
            consecutive waypoints.
  ICAO bits flight_type / flight_rules / flight_oversight are REQUIRED by
            the schema and absent from DCS entirely. See build.asset() for
            why the defaults are what they are.

Everything DCS:OPT knows that the standard has no room for - native x/y,
TACAN/ICLS, threat rings, the DTC cartridge, SOP, DMPIs - goes under
`extensions.dcsopt`, which other tools are required to ignore.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .. import build, ids, vocab

# DCS keeps all user-facing strings (sortie name, briefing, task text) in
# `l10n/DEFAULT/dictionary` and stores only a key in the mission file. The
# parser hands those keys through untouched, so an unresolved key would be
# published as the package name - a consumer would render "DICTKEY_SORTIE_5".
_DICTKEY = re.compile(r"^(dictkey|dict_key)_", re.IGNORECASE)

# DCS unit categories that represent a flight. Ground and ship groups are
# real units but they are not air assets, so they never become an Asset.
FLYABLE_CATEGORIES = ("plane", "helicopter")

TOOL_SOURCE = "DCS:OPT"


def _text(value: Any, dictionary: Dict[str, str] = None) -> Optional[str]:
    """Resolve a possibly-DictKey string to real text.

    With a dictionary (the parsed `l10n/DEFAULT/dictionary`) the key is
    looked up. Without one, an unresolved key is dropped rather than
    published verbatim - no text is better than leaking DCS internals.
    """
    if not value or not isinstance(value, str):
        return None
    if _DICTKEY.match(value):
        resolved = (dictionary or {}).get(value)
        return resolved.strip() if resolved and resolved.strip() else None
    return value.strip() or None


def _wind_layers(wx: Dict[str, Any]) -> tuple:
    """DCS gives surface + two fixed upper layers (2000 m, 8000 m).
    Wind speed is m/s; `dir` is already a meteorological FROM bearing."""
    wind = (wx or {}).get("wind") or {}

    def layer(key, alt_m):
        w = wind.get(key) or {}
        speed = w.get("speed")
        if speed is None:
            return None
        return build.wind_layer(
            from_deg=w.get("dir", 0),
            speed_kts=vocab.mps_to_kts(speed),
            altitude_ft=None if alt_m is None else int(vocab.m_to_ft(alt_m)),
        )

    surface = layer("atGround", None)
    upper = [l for l in (layer("at2000", 2000), layer("at8000", 8000)) if l]
    return surface, (upper or None)


def _weather(wx: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not wx:
        return None
    surface, upper = _wind_layers(wx)
    cloud = None
    if wx.get("clouds_density"):
        cloud = build.clouds(
            density=wx.get("clouds_density", 0),
            base_ft=vocab.m_to_ft(wx.get("clouds_base_m")),
            thickness_ft=vocab.m_to_ft(wx.get("clouds_thickness")),
        )
    return build.weather(
        temperature_c=wx.get("temperature_c"),
        qnh_hpa=wx.get("qnh_hpa"),
        visibility_m=wx.get("visibility_m"),
        surface_wind=surface,
        upper_winds=upper,
        clouds=cloud,
    )


def _bullseye(overview: Dict[str, Any], side: str) -> Optional[Dict[str, Any]]:
    be = (overview.get("bullseye") or {}).get(side) or {}
    if be.get("lat") is None or be.get("lon") is None:
        return None
    return build.latlon(be["lat"], be["lon"])


def _group_waypoints(doc: str, group: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Convert a DCS group's waypoint array into standard Waypoints.

    Points with no projected lat/lon are skipped: latitude and longitude
    are required, and emitting a waypoint at (0, 0) would silently place
    it in the Gulf of Guinea rather than failing loudly.
    """
    out = []
    name = group.get("groupName", "")
    for wp in group.get("waypoints") or []:
        lat, lon = wp.get("lat"), wp.get("lon")
        if lat is None or lon is None:
            continue
        idx = wp.get("waypoint_number", len(out))
        alt_type = str(wp.get("altitude_type", "BARO")).upper()
        out.append(build.waypoint(
            wp_id=ids.waypoint_id(doc, name, idx),
            wp_type=vocab.waypoint_type(
                wp.get("waypoint_type"), wp.get("waypoint_action"), wp.get("waypoint_name")
            ),
            lat=lat, lon=lon,
            name=wp.get("waypoint_name") or f"WP{idx}",
            altitude_ft=vocab.m_to_ft(wp.get("altitude_m")),
            # DCS alt_type BARO is a barometric (MSL) altitude; RADIO is
            # a radar altitude above ground.
            altitude_ref="MSL" if alt_type == "BARO" else "AGL",
            speed=vocab.mps_to_kts(wp.get("speed_ms")),
            # DCS stores waypoint speed as true airspeed in m/s.
            speed_type="TAS",
            eta_seconds=int(wp["eta_seconds"]) if wp.get("eta_seconds") else None,
        ))
    return out


def _dcsopt_extensions(group: Dict[str, Any], waypoints_raw: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Per-asset DCS:OPT payload. Native x/y is the important one: the
    standard is WGS-84 only, but x/y is what actually round-trips into a
    .miz, so we must not lose it."""
    payload = {
        "group_id": group.get("groupId"),
        "group_name": group.get("groupName"),
        "dcs_task": group.get("task"),
        "category": group.get("category"),
        "country": group.get("country"),
    }
    if group.get("frequency"):
        payload["frequency_mhz"] = round(group["frequency"] / 1_000_000, 4) \
            if group["frequency"] > 10_000 else group["frequency"]
    if group.get("tacan"):
        payload["tacan"] = group["tacan"]
    if group.get("icls"):
        payload["icls"] = group["icls"]
    xy = [
        {"wp": wp.get("waypoint_number"), "x": wp.get("x"), "y": wp.get("y")}
        for wp in waypoints_raw or []
    ]
    if xy:
        payload["dcs_xy"] = xy
    return {k: v for k, v in payload.items() if v not in (None, "", [])}


def to_op_task_air(mission_data: Dict[str, Any], *, theater: str = None,
                   coalition: str = "blue", package_name: str = None,
                   include_airfields: bool = False,
                   tool_source: str = TOOL_SOURCE,
                   dictionary: Dict[str, str] = None,
                   filename: str = None) -> Dict[str, Any]:
    """Build a community-op-task-air document for ONE coalition.

    A document carries a single coalition, so a mission with both sides
    exports as two documents. Call once per side.

    `dictionary` is the parsed `l10n/DEFAULT/dictionary` mapping. Supply it
    to resolve the sortie name and briefing text; without it those fields
    are omitted rather than published as raw DictKey references.
    """
    overview = mission_data.get("overview") or {}
    theater = theater or overview.get("theater") or "Unknown"
    side = str(coalition).strip().lower()

    sortie = _text(overview.get("sortie"), dictionary)
    mission_name = sortie or filename or theater
    doc = ids.doc_id(tool_source, theater, f"{mission_name}:{side}")

    pkg_name = package_name or (sortie or mission_name or "PACKAGE").upper()
    pkg_id = ids.package_id(doc, pkg_name)

    assets: List[Dict[str, Any]] = []
    routes: List[Dict[str, Any]] = []
    all_waypoints: List[Dict[str, Any]] = []
    skipped: List[str] = []

    for group in mission_data.get("groups") or []:
        if str(group.get("coalition", "")).lower() != side:
            continue
        if str(group.get("category", "")).lower() not in FLYABLE_CATEGORIES:
            continue

        name = group.get("groupName") or ""
        units = group.get("units") or []
        wps = _group_waypoints(doc, group)

        # Route.legs requires at least one leg, which needs two waypoints.
        # Parked/static flights and single-point spawns can't form one, so
        # they are skipped rather than emitted as an invalid route.
        if not build.is_routable(wps):
            skipped.append(name)
            continue

        all_waypoints.extend(wps)
        a_id = ids.asset_id(doc, name)
        r_id = ids.route_id(doc, name)

        assets.append(build.asset(
            asset_id=a_id,
            package_id=pkg_id,
            callsign=name,
            airframe=vocab.airframe(units[0].get("type") if units else ""),
            route_id=r_id,
            flight_number=len(units) or 1,
            mission_type=vocab.mission_type(group.get("task")),
            control_type=vocab.control_type([u.get("skill") for u in units]),
            flight_members=[
                build.flight_member(
                    pilot_name=u.get("name"),
                    role=vocab.flight_position(i, len(units)),
                    # Per-member control_type supersedes the asset-level
                    # value, so a mixed client/AI flight stays accurate.
                    control_type=vocab.control_type([u.get("skill")]),
                )
                for i, u in enumerate(units)
            ] or None,
        ))
        routes.append(build.route(
            route_id=r_id,
            asset_id=a_id,
            legs=build.legs_from_waypoints(wps),
        ))

    if not assets:
        detail = (f" Skipped {len(skipped)} flight(s) with fewer than two "
                  f"waypoints: {', '.join(skipped[:5])}." if skipped else "")
        raise build.NotExportable(
            f"No exportable flights for coalition '{side}'.{detail}"
        )

    airfields = None
    if include_airfields:
        airfields = [
            build.airfield(
                airfield_id=ids.airfield_id(doc, ab["name"]),
                name=ab["name"], lat=ab["lat"], lon=ab["lon"],
                airfield_type="ICAO",
            )
            for ab in (mission_data.get("airbases") or [])
            if ab.get("lat") is not None and ab.get("lon") is not None
        ] or None

    # Document-level DCS:OPT payload. Threats are the interesting one:
    # the core schema has no red-force IADS concept at all, so MEZ rings
    # would be silently lost without this namespace.
    doc_ext: Dict[str, Any] = {
        "dcs_theater": theater,
        "source_filename": filename,
        "briefing": _text(overview.get("description"), dictionary),
    }
    threats = [
        {"name": t.get("name"), "type": t.get("type"), "lat": t.get("lat"),
         "lon": t.get("lon"), "range_nm": t.get("range"), "coalition": t.get("coalition")}
        for t in (mission_data.get("threats") or [])
        if t.get("lat") is not None
    ]
    if threats:
        doc_ext["threats"] = threats
    per_asset = {}
    for group in mission_data.get("groups") or []:
        if (str(group.get("coalition", "")).lower() == side
                and str(group.get("category", "")).lower() in FLYABLE_CATEGORIES):
            payload = _dcsopt_extensions(group, group.get("waypoints"))
            if payload:
                per_asset[group.get("groupName", "")] = payload
    if per_asset:
        doc_ext["assets"] = per_asset
    if skipped:
        # Surfaced rather than swallowed: a consumer can see which flights
        # were dropped and why the document is thinner than the mission.
        doc_ext["skipped_flights"] = skipped

    return build.op_task_air(
        doc_id=doc,
        coalition=vocab.coalition(side),
        mission_context=build.mission_context(
            theatre=vocab.theatre(theater),
            date=overview.get("date") or "2000-01-01",
            time_seconds=int(overview.get("start_time") or 0),
            bullseye_blue=_bullseye(overview, "blue"),
            bullseye_red=_bullseye(overview, "red"),
            weather_obj=_weather(overview.get("weather")),
        ),
        packages=[build.package(
            pkg_id, pkg_name,
            notes=_text(overview.get(f"description{side.capitalize()}Task"), dictionary),
        )],
        assets=assets,
        routes=routes,
        # The waypoints array is optional, but must hold >= 2 when present.
        waypoints=all_waypoints if len(all_waypoints) >= build.MIN_WAYPOINTS else None,
        airfields=airfields,
        extensions=build.ext(dcsopt={k: v for k, v in doc_ext.items() if v}),
        tool_source=tool_source,
    )


def to_flight_plan(mission_data: Dict[str, Any], **kwargs) -> Dict[str, Any]:
    """community-flightplan: the same spine without mission_context."""
    ota = to_op_task_air(mission_data, **kwargs)
    return build.flight_plan(
        doc_id=ota["id"],
        coalition=ota["coalition"],
        packages=ota["package"],
        assets=ota["assets"],
        routes=ota["routes"],
        waypoints=ota.get("waypoints"),
        extensions=ota.get("extensions"),
        tool_source=ota.get("tool_source"),
        created_at=ota.get("created_at"),
    )


def coalitions_present(mission_data: Dict[str, Any]) -> List[str]:
    """Which sides actually have flights - i.e. how many documents to emit."""
    seen = []
    for g in mission_data.get("groups") or []:
        side = str(g.get("coalition", "")).lower()
        if (str(g.get("category", "")).lower() in FLYABLE_CATEGORIES
                and side and side not in seen):
            seen.append(side)
    return seen
