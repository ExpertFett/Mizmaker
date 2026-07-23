"""
Builders for MCT Community Standard v2.0.0 documents.

These exist so an adapter cannot produce an invalid document by omission.
Every required field in the schema is either a mandatory argument here or
carries an explicit, documented default.

Two rules the schema enforces that shape this module:

  1. The document root is `additionalProperties: false`. You cannot invent
     top-level fields - anything tool-specific goes in `extensions`.
  2. `extensions` IS open: each key is a tool namespace, and the schema
     tells parsers to silently ignore namespaces they don't recognise.
     That is the whole interop contract, so `ext()` is how DCS:OPT keeps
     its DTC cartridges, SOP, DMPIs and DCS x/y without breaking anyone.

Optional fields set to None are omitted rather than emitted as null.
Omission is always schema-valid; a null is only valid where the schema
explicitly unions "null", so omitting is the safer default.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from . import vocab

SCHEMA_VERSION = "2.0.0"

OP_TASK_AIR = "community-op-task-air"
COMMUNITY_FLIGHTPLAN = "community-flightplan"

SCHEMA_URLS = {
    OP_TASK_AIR: "https://mctoolbox.uk/schema/v2.0.0/op-task-air.schema.json",
    COMMUNITY_FLIGHTPLAN: "https://mctoolbox.uk/schema/v2.0.0/community-flightplan.schema.json",
}

# Minimum sizes the schema enforces. A document that breaks any of these is
# invalid no matter how well-formed the rest of it is.
MIN_PACKAGES = 1
MIN_ASSETS = 1
MIN_ROUTES = 1
MIN_WAYPOINTS = 2      # only when the waypoints array is present at all
MIN_LEGS = 1           # per route
MIN_ROUTABLE_WAYPOINTS = 2   # you need two points to make one leg


class NotExportable(ValueError):
    """The source has nothing that can become a valid document.

    Raised instead of emitting a document that would fail validation
    downstream, so the caller gets a clear reason at the point of export.
    """


def is_routable(waypoints: List[Dict[str, Any]]) -> bool:
    """A flight needs at least two waypoints to form the one leg that
    `Route.legs` requires."""
    return len(waypoints or []) >= MIN_ROUTABLE_WAYPOINTS


def _clean(d: Dict[str, Any]) -> Dict[str, Any]:
    """Drop None-valued keys. Required fields are set by the callers below,
    so anything left as None here is optional and safe to omit."""
    return {k: v for k, v in d.items() if v is not None}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# --------------------------------------------------------------------------
# Extensions
# --------------------------------------------------------------------------

def ext(**namespaces: Any) -> Optional[Dict[str, Any]]:
    """Build an `extensions` object.

        ext(dcsopt={"dcs_xy": ...}, lotatc={...})

    Empty namespaces are dropped so we never emit `{"dcsopt": {}}`.
    """
    out = {k: v for k, v in namespaces.items() if v}
    return out or None


# --------------------------------------------------------------------------
# Leaf objects
# --------------------------------------------------------------------------

def latlon(lat: float, lon: float) -> Dict[str, Any]:
    return {"latitude": float(lat), "longitude": float(lon)}


def comms(frequency_mhz: float, modulation: Any = 0, *, role: str = None,
          label: str = None, callsign: str = None) -> Dict[str, Any]:
    """CommsEntry. Required: frequency_mhz, modulation."""
    return _clean({
        "frequency_mhz": round(float(frequency_mhz), 4),
        "modulation": vocab.modulation(modulation),
        "role": role if role in vocab.COMMS_ROLE else None,
        "label": label,
        "callsign": callsign,
    })


def wind_layer(from_deg: float, speed_kts: float, altitude_ft: int = None) -> Dict[str, Any]:
    """WindLayer. Required: from_deg, speed_kts.

    `from_deg` is the meteorological FROM direction. DCS's .miz
    `weather.wind.*.dir` is already a FROM bearing - this matches how
    DCS:OPT's own BriefingTab and WeatherTab crosswind maths read it.
    """
    return _clean({
        "from_deg": round(float(from_deg) % 360, 1),
        "speed_kts": round(float(speed_kts), 1),
        "altitude_ft": int(altitude_ft) if altitude_ft is not None else None,
    })


def waypoint(wp_id: str, wp_type: str, lat: float, lon: float, *,
             name: str = None, altitude_ft: float = None,
             altitude_ref: str = None, speed: float = None,
             speed_type: str = None, eta_seconds: int = None,
             activity: str = None, notes: str = None,
             tacan_ref: str = None, airfield_ref: str = None,
             track_id: str = None) -> Dict[str, Any]:
    """Waypoint. Required: id, type, latitude, longitude."""
    if wp_type not in vocab.WAYPOINT_TYPE:
        wp_type = "CUSTOM"
    return _clean({
        "id": wp_id,
        "type": wp_type,
        "name": name,
        "latitude": float(lat),
        "longitude": float(lon),
        "altitude_ft": altitude_ft,
        "altitude_ref": altitude_ref if altitude_ref in vocab.ALTITUDE_REF else None,
        "speed": speed,
        "speed_type": speed_type if speed_type in vocab.SPEED_TYPE else None,
        "eta_seconds": int(eta_seconds) if eta_seconds is not None else None,
        "activity": activity,
        "notes": notes,
        "tacan_ref": tacan_ref,
        "airfield_ref": airfield_ref,
        "track_id": track_id,
    })


def leg(leg_name: str, start_waypoint: str, end_waypoint: str, *,
        flight_rules: str = None) -> Dict[str, Any]:
    """RouteLeg. Required: leg_name, start_waypoint, end_waypoint."""
    return _clean({
        "leg_name": leg_name,
        "start_waypoint": start_waypoint,
        "end_waypoint": end_waypoint,
        "flightRules": flight_rules if flight_rules in vocab.FLIGHT_RULES else None,
    })


def legs_from_waypoints(waypoints: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Synthesise the leg chain DCS doesn't have.

    DCS hangs an ordered waypoint array off the group and has no concept of
    a leg; the standard wants explicit start/end pairs. Consecutive pairs
    reproduce the same route exactly.
    """
    out = []
    for a, b in zip(waypoints, waypoints[1:]):
        name = f"{a.get('name') or a['type']} -> {b.get('name') or b['type']}"
        out.append(leg(name, a["id"], b["id"]))
    return out


def route(route_id: str, asset_id: str, legs: List[Dict[str, Any]], *,
          tot_offset_seconds: int = None,
          fuel_plan: Dict[str, Any] = None) -> Dict[str, Any]:
    """Route. Required: id, asset_id, legs."""
    return _clean({
        "id": route_id,
        "asset_id": asset_id,
        "tot_offset_seconds": tot_offset_seconds,
        "fuel_plan": fuel_plan,
        "legs": legs or [],
    })


def asset(asset_id: str, package_id: str, callsign: str, airframe: str,
          route_id: str, *, flight_number: int = 1,
          mission_type: str = "OTHER", control_type: str = "Unknown",
          flight_type: str = "M", flight_rules: str = "I",
          flight_oversight: str = "Public",
          tactical_callsign: str = None, primary_target: str = None,
          flight_members: List[Dict[str, Any]] = None,
          dmpi_refs: List[Dict[str, Any]] = None,
          notes: str = None) -> Dict[str, Any]:
    """Asset. Required by the schema (all eleven):
        id, package_id, callsign, flight_number, flight_type, flight_rules,
        flight_oversight, control_type, airframe, mission_type, route_id

    Note the four ICAO-ish fields DCS has no equivalent for. Defaults are
    deliberate, not filler:
        flight_type      "M" - military. Every DCS combat flight is.
        flight_rules     "I" - IFR. Milsim packages brief and fly IFR.
        flight_oversight "Public" - least restrictive; the document says
                         nothing about classification.
        control_type     "Unknown" unless the caller inspects unit skills.
    """
    return _clean({
        "id": asset_id,
        "package_id": package_id,
        "callsign": callsign,
        "tactical_callsign": tactical_callsign,
        "flight_number": int(flight_number),
        "flight_type": flight_type if flight_type in vocab.FLIGHT_TYPE else "M",
        "flight_rules": flight_rules if flight_rules in vocab.FLIGHT_RULES else "I",
        "flight_oversight": (flight_oversight
                             if flight_oversight in vocab.FLIGHT_OVERSIGHT else "Public"),
        "control_type": control_type if control_type in vocab.CONTROL_TYPE else "Unknown",
        "flight_members": flight_members,
        "airframe": airframe or "UNKNOWN",
        "mission_type": mission_type if mission_type in vocab.MISSION_TYPE else "OTHER",
        "primary_target": primary_target,
        "dmpi_refs": dmpi_refs,
        "route_id": route_id,
        "notes": notes,
    })


def flight_member(pilot_name: str = None, role: str = None, *,
                  tail_number: str = None, onboard_number: str = None,
                  control_type: str = None,
                  transponder: Dict[str, Any] = None,
                  codes: Dict[str, Any] = None) -> Dict[str, Any]:
    """Flight_Member. Nothing is required, but the object is
    `additionalProperties: false` so only these seven keys are legal.

    The pilot's name is `pilot_name`, NOT `name` (the C# README is wrong).
    `onboard_number` is the DCS modex - the exact field ReadyRoom's
    identity bridge already carries.
    """
    return _clean({
        "role": role if role in vocab.FLIGHT_MEMBER_ROLE else None,
        "tail_number": tail_number,
        "onboard_number": onboard_number,
        "pilot_name": pilot_name,
        "control_type": control_type if control_type in vocab.CONTROL_TYPE else None,
        "transponder": transponder,
        "codes": codes,
    })


def package(package_id: str, name: str, *, package_commander: str = None,
            comms_plan: List[Dict[str, Any]] = None,
            notes: str = None) -> Dict[str, Any]:
    """Package. Required: id, name."""
    return _clean({
        "id": package_id,
        "name": name,
        "package_commander": package_commander,
        "comms_plan": comms_plan,
        "notes": notes,
    })


def airfield(airfield_id: str, name: str, lat: float, lon: float, *,
             airfield_type: str = "ICAO", icao_code: str = None,
             elevation_ft: float = None, comms: List[Dict[str, Any]] = None,
             carrier: Dict[str, Any] = None, farp: Dict[str, Any] = None,
             notes: str = None) -> Dict[str, Any]:
    """AirfieldDefinition. Required: id, type, name, latitude, longitude."""
    return _clean({
        "id": airfield_id,
        "type": airfield_type if airfield_type in vocab.AIRFIELD_TYPE else "CUSTOM",
        "name": name,
        "icao_code": icao_code,
        "latitude": float(lat),
        "longitude": float(lon),
        "elevation_ft": elevation_ft,
        "comms": comms,
        "carrier": carrier,
        "farp": farp,
        "notes": notes,
    })


def weather(*, temperature_c: float = None, qnh_hpa: float = None,
            visibility_m: int = None, surface_wind: Dict[str, Any] = None,
            upper_winds: List[Dict[str, Any]] = None,
            clouds: Dict[str, Any] = None) -> Optional[Dict[str, Any]]:
    winds = _clean({"surface": surface_wind, "altitude": upper_winds or None})
    out = _clean({
        "temperature_c": temperature_c,
        "qnh_hpa": qnh_hpa,
        "visibility_m": int(visibility_m) if visibility_m is not None else None,
        "winds": winds or None,
        "clouds": clouds,
    })
    return out or None


def clouds(density: int, base_ft: float = None, thickness_ft: float = None) -> Dict[str, Any]:
    return _clean({
        "density": int(density),
        "base_ft": int(base_ft) if base_ft is not None else None,
        "thickness_ft": int(thickness_ft) if thickness_ft is not None else None,
    })


def mission_context(theatre: str, date: str, time_seconds: int, *,
                    bullseye_blue: Dict[str, Any] = None,
                    bullseye_red: Dict[str, Any] = None,
                    weather_obj: Dict[str, Any] = None) -> Dict[str, Any]:
    """MissionContext. Required: theatre, date, time_seconds."""
    be = _clean({"blue": bullseye_blue, "red": bullseye_red})
    return _clean({
        "theatre": theatre,
        "date": date,
        "time_seconds": int(time_seconds),
        "bullseye": be or None,
        "weather": weather_obj,
    })


# --------------------------------------------------------------------------
# Documents
# --------------------------------------------------------------------------

def op_task_air(doc_id: str, coalition: str, mission_context: Dict[str, Any],
                packages: List[Dict[str, Any]], assets: List[Dict[str, Any]],
                routes: List[Dict[str, Any]], *,
                waypoints: List[Dict[str, Any]] = None,
                tracks: List[Dict[str, Any]] = None,
                airfields: List[Dict[str, Any]] = None,
                extensions: Dict[str, Any] = None,
                tool_source: str = None,
                created_at: str = None) -> Dict[str, Any]:
    """A community-op-task-air document.

    Required root: schema, schema_version, id, created_at, coalition,
    mission_context, package, assets, routes.
    """
    return _clean({
        "schema": OP_TASK_AIR,
        "schema_version": SCHEMA_VERSION,
        "id": doc_id,
        "created_at": created_at or utc_now(),
        "tool_source": tool_source,
        "coalition": coalition if coalition in vocab.COALITION else "OTHER",
        "mission_context": mission_context,
        "package": packages,
        "assets": assets,
        "routes": routes,
        "waypoints": waypoints,
        "tracks": tracks,
        "airfields": airfields,
        "extensions": extensions,
    })


def flight_plan(doc_id: str, coalition: str, packages: List[Dict[str, Any]],
                assets: List[Dict[str, Any]], routes: List[Dict[str, Any]], *,
                waypoints: List[Dict[str, Any]] = None,
                extensions: Dict[str, Any] = None,
                tool_source: str = None,
                created_at: str = None) -> Dict[str, Any]:
    """A community-flightplan document (no mission_context/tracks/airfields)."""
    return _clean({
        "schema": COMMUNITY_FLIGHTPLAN,
        "schema_version": SCHEMA_VERSION,
        "id": doc_id,
        "created_at": created_at or utc_now(),
        "tool_source": tool_source,
        "coalition": coalition if coalition in vocab.COALITION else "OTHER",
        "package": packages,
        "assets": assets,
        "routes": routes,
        "waypoints": waypoints,
        "extensions": extensions,
    })
