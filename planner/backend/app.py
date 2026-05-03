"""
DCS Mission Map Planner — Flask backend.

Routes:
  POST /api/upload              — Upload .miz, parse, return full mission JSON
  POST /api/download            — Apply edits, repack .miz, stream file
  POST /api/export/json         — Export planning data as JSON
  GET  /api/sam-ranges          — SAM/AAA threat range data
  GET  /api/projections         — Theater projection parameters
  GET  /api/elevation/{lat}/{lon} — SRTM terrain elevation
  GET  /api/launcher-settings/{clsid} — Weapon settings schema
  GET  /api/weather/presets     — Weather presets
  POST /api/dtc/generate        — Generate F/A-18C DTC file
  POST /api/dtc/preview         — Preview DTC data
  GET  /api/dtc/blank           — Blank DTC template
  POST /api/dtc/export-raw      — Export DTC from raw data
  POST /api/close               — Close session
  GET  /api/triggers             — Get parsed triggers from loaded mission
  POST /api/triggers             — Update triggers in mission
  GET  /api/audio/list           — List audio files in .miz
  POST /api/audio/upload         — Upload audio file to .miz
  DELETE /api/audio/<path>       — Remove audio file from .miz
  GET  /api/audio/stream/<path>  — Stream audio file for preview
  POST /api/sessions/{id}/invite — Generate invite link for a flight lead
  GET  /api/sessions/{id}/join   — Join session via invite token
  GET  /api/sessions/{id}/stream — SSE event stream for real-time updates
  GET  /api/sessions/{id}/state  — Get current session state (for reconnection)
"""

import json
import os
import time
import uuid
from flask import Flask, request, jsonify, send_file, send_from_directory, Response
from flask_cors import CORS
import io
import hmac
import hashlib
from gevent.queue import Queue
from gevent import sleep as gsleep

from services.miz_parser import (
    extract_mission_from_miz,
    parse_mission_text,
    extract_full_mission_data,
    SAM_THREAT_RANGES,
)
from services.miz_editor import (
    replace_group_waypoints, repack_miz,
    extract_dictionary_from_miz, apply_briefing_edits_to_dictionary,
    extract_options_from_miz, apply_forced_options_to_options_file,
)
from services.unit_editor import apply_unit_edits
from services.trigger_editor import (
    extract_triggers,
    list_audio_files,
    get_audio_bytes,
    add_audio_to_miz,
    remove_audio_from_miz,
    update_triggers_in_mission,
)
from services.unit_extractor import (
    find_client_units,
    find_laser_capable_units,
    get_all_units_for_donor_selection,
    extract_all_groups,
    extract_livery_data,
    extract_statistics,
    extract_countries,
    generate_datalink_suggestions,
    get_pylon_options,
    get_launcher_settings,
    LASER_CLSIDS,
    WEATHER_PRESETS,
    AIR_TASKS, GROUND_TASKS, SHIP_TASKS,
)
from services.dtc_builder import (
    extract_flight_for_dtc,
    build_dtc_from_flight,
    build_dtc_from_edits,
    serialize_dtc,
    FA18_DEFAULTS,
)
from services.projection import THEATERS
from services.waypoint_service import recompute_route
from services.session_store import default_store as _store
import srtm

# Initialize SRTM elevation data (downloads HGT tiles on first use, caches locally)
_srtm_data = srtm.get_data()

# Serve built frontend from /static in production, or run with Vite proxy in dev
static_dir = os.path.join(os.path.dirname(__file__), "static")
# Disable Flask's built-in static serving — our catch-all handles everything.
# static_url_path="" conflicts with the SPA catch-all (both match /<path:path>).
app = Flask(__name__, static_folder=None)

CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200 MB — kneeboard mod packs can be 50-100+ MB

# Session storage. The dict + lock + helpers that lived here moved to
# services.session_store as part of Phase 2 (Supabase migration). Step 1
# of that plan is keeping the in-memory backend; Step 2 will swap in a
# Supabase-backed implementation behind the same interface so sessions
# survive Railway restarts. Keep these aliases so existing call sites
# read the same way.
sessions = _store._sessions          # exposed for SSE diagnostics; do NOT mutate directly
_lock = _store.lock                   # short alias; legacy callers still use `with _lock:`
SESSION_TTL = _store.ttl_seconds      # imported elsewhere?  preserve as a public name
MAX_SESSIONS = _store.max_sessions
_create_session = _store.create
_get_session = _store.get
_cleanup_sessions = _store.cleanup


# --------------------------------------------------------------------------
# Health — liveness probe for smoke tests, dev scripts, and future uptime
# monitoring. Cheap and side-effect-free. Also reports session count so
# `curl /api/health` is useful for eyeballing server state.
# --------------------------------------------------------------------------

@app.route("/api/health", methods=["GET"])
def health():
    with _lock:
        n_sessions = len(sessions)
    return jsonify({
        "status": "ok",
        "sessions": n_sessions,
        "sessions_max": MAX_SESSIONS,
    })


# --------------------------------------------------------------------------
# Upload — returns full mission data including 856-equivalent extraction
# --------------------------------------------------------------------------

@app.route("/api/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    f = request.files["file"]
    if not f.filename or not f.filename.lower().endswith(".miz"):
        return jsonify({"error": "File must be a .miz file"}), 400

    miz_bytes = f.read()

    try:
        mission_text = extract_mission_from_miz(miz_bytes)
        mission_dict = parse_mission_text(mission_text)
    except Exception as e:
        return jsonify({"error": f"Failed to parse mission: {str(e)}"}), 400

    theater = mission_dict.get("theatre", "Unknown")

    try:
        # Planner map data (groups with waypoints, units, threats, airbases, drawings)
        # Pass options text so missionOptions can fall back to options/difficulty
        # when the mission/forcedOptions block is missing keys (some hand-edited
        # missions only carry the difficulty block).
        try:
            options_text_for_parse = extract_options_from_miz(miz_bytes)
        except Exception:
            options_text_for_parse = None
        data = extract_full_mission_data(mission_dict, theater, options_text_for_parse)

        # Resolve DictKey references in briefing fields. DCS missions
        # store sortie/description/blue/red task as references like
        # `DictKey_descriptionText_5` and the actual user-visible text
        # lives in `l10n/DEFAULT/dictionary`. Without this resolution
        # the BriefingTab and brief generator both showed raw keys
        # instead of the briefing the mission designer actually wrote.
        try:
            from services.brief_builder import parse_dictionary, resolve_dict_key
            from services.miz_editor import extract_dictionary_from_miz
            dict_text = extract_dictionary_from_miz(miz_bytes)
            lookup = parse_dictionary(dict_text)
            ov = data.get("overview") or {}
            for fld in ("sortie", "description", "descriptionBlueTask", "descriptionRedTask"):
                v = ov.get(fld)
                if isinstance(v, str) and v.startswith("DictKey_"):
                    ov[fld] = resolve_dict_key(v, lookup)
        except Exception as e:
            # Resolution failure is non-fatal — the brief shows raw keys
            # rather than blocking the whole upload. Log so we know.
            import logging
            logging.warning(f"Briefing dict resolution failed: {e}")

        for group in data["groups"]:
            if group["waypoints"]:
                group["waypoints"] = recompute_route(group["waypoints"])

        # 856-equivalent extraction (client units, loadouts, datalink, liveries, etc.)
        client_units = find_client_units(mission_dict)
        laser_units = find_laser_capable_units(mission_dict)
        all_units_donor = get_all_units_for_donor_selection(mission_dict)
        all_groups_renamer = extract_all_groups(mission_dict)
        livery_data = extract_livery_data(mission_dict)
        statistics = extract_statistics(mission_dict)
        countries = extract_countries(mission_dict)
        suggestions = generate_datalink_suggestions(client_units)

        # Pylon options for all aircraft types found in client units
        aircraft_types = list(set(u["type"] for u in client_units))
        pylon_options = {}
        for at in aircraft_types:
            opts = get_pylon_options(at)
            if opts:
                pylon_options[at] = opts

        # DTC-capable flight groups (unique group names with client units)
        dtc_flights = list(set(u["groupName"] for u in client_units))

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to extract mission data: {str(e)}", "trace": traceback.format_exc()}), 400

    # Build server-authoritative waypoint state from parsed groups
    group_waypoints = {}
    for group in data["groups"]:
        group_waypoints[group["groupName"]] = group["waypoints"]

    try:
        sid, host_token = _create_session(miz_bytes, mission_text, theater, f.filename, group_waypoints)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to create session: {str(e)}"}), 500

    try:
        return jsonify({
            "sessionId": sid,
            "hostToken": host_token,
            "filename": f.filename,
            "theater": theater,
            # Planner map data
            **data,
            # 856-equivalent data
            "clientUnits": client_units,
            "laserCapableUnits": laser_units,
            "allUnitsDonor": all_units_donor,
            "pylonOptions": pylon_options,
            "suggestions": suggestions,
            "allGroupsRenamer": all_groups_renamer,
            "liveryData": livery_data,
            "laserClsids": sorted(LASER_CLSIDS, key=str),
            "dtcFlights": dtc_flights,
            "statistics": statistics,
            "countries": countries,
            "taskLists": {
                "air": AIR_TASKS,
                "ground": GROUND_TASKS,
                "ship": SHIP_TASKS,
            },
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to serialize response: {str(e)}"}), 500


# --------------------------------------------------------------------------
# Waypoint editing — server is the source of truth
# --------------------------------------------------------------------------

@app.route("/api/sessions/<sid>/edit", methods=["POST"])
def session_edit(sid):
    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400

    group_name = body.get("groupName")
    action = body.get("action")  # move, add, delete, reorder, update
    wp_index = body.get("wpIndex")
    data = body.get("data", {})

    if not group_name or group_name not in session["group_waypoints"]:
        return jsonify({"error": f"Group '{group_name}' not found"}), 404

    # Reject edits if session is frozen
    if session.get("status") == "frozen":
        return jsonify({"error": "Session is frozen — editing disabled"}), 423

    # Validate token owns this group (or is the host)
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if token and token != session.get("host_token"):
        participant = session["participants"].get(token)
        if not participant or participant["group"] != group_name:
            return jsonify({"error": "Not authorized to edit this group"}), 403

    wps = session["group_waypoints"][group_name]

    try:
        if action == "move" and wp_index is not None:
            if 0 <= wp_index < len(wps):
                wps[wp_index] = {**wps[wp_index], **data}

        elif action == "add":
            new_wp = data.get("waypoint", data)
            wps.append(new_wp)

        elif action == "delete" and wp_index is not None:
            if 0 < wp_index < len(wps):  # can't delete WP0
                wps.pop(wp_index)
                # Renumber
                for i, wp in enumerate(wps):
                    wp["waypoint_number"] = i

        elif action == "reorder":
            from_idx = body.get("fromIndex")
            to_idx = body.get("toIndex")
            if from_idx is not None and to_idx is not None and from_idx > 0 and to_idx > 0:
                wp = wps.pop(from_idx)
                wps.insert(to_idx, wp)
                for i, w in enumerate(wps):
                    w["waypoint_number"] = i

        elif action == "update" and wp_index is not None:
            field = data.get("field")
            value = data.get("value")
            if field and 0 <= wp_index < len(wps):
                if field == "name": wps[wp_index]["waypoint_name"] = value
                elif field == "alt": wps[wp_index]["altitude_m"] = value
                elif field == "speed": wps[wp_index]["speed_ms"] = value
                elif field == "alt_type": wps[wp_index]["altitude_type"] = value
                elif field == "speed_ref": wps[wp_index]["speed_ref"] = value
                elif field == "speed_input": wps[wp_index]["speed_input"] = value

        # Recompute route leg data
        wps = recompute_route(wps)
        session["group_waypoints"][group_name] = wps
        session["dirty_groups"].add(group_name)
        session["last_activity"] = time.time()

        # Broadcast route update to all connected clients
        _broadcast(session, "route_update", {"groupName": group_name, "waypoints": wps}, exclude_token=token)

        return jsonify({"ok": True, "groupName": group_name, "waypoints": wps})

    except Exception as e:
        return jsonify({"error": f"Edit failed: {str(e)}"}), 400


# --------------------------------------------------------------------------
# Unit edits — loadouts, datalink, laser, livery, etc. (server-authoritative)
# --------------------------------------------------------------------------

@app.route("/api/sessions/<sid>/unit-edit", methods=["POST"])
def session_unit_edit(sid):
    """Store a unit edit on the server. Applied at download time."""
    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400

    edit = body.get("edit")
    if not edit:
        return jsonify({"error": "No edit data"}), 400

    # Validate token owns this unit's group (or is the host)
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if token and token != session.get("host_token"):
        participant = session["participants"].get(token)
        if participant:
            # Check if the edit targets a unit in their assigned group
            unit_id = edit.get("unitId")
            group_name = edit.get("groupName")
            if group_name and participant["group"] != group_name:
                return jsonify({"error": "Not authorized to edit this group"}), 403

    with _lock:
        session["unit_edits"].append(edit)
        session["last_activity"] = time.time()

    # Broadcast to other clients so they see the change
    _broadcast(session, "unit_edit", edit, exclude_token=token)

    return jsonify({"ok": True, "editCount": len(session["unit_edits"])})


# --------------------------------------------------------------------------
# SSE broadcast — push events to all connected clients
# --------------------------------------------------------------------------

def _broadcast(session, event_type, data, exclude_token=None):
    """Push event to all SSE clients in a session."""
    event = {"type": event_type, "data": data}
    dead = []
    for client in list(session.get("sse_clients", [])):
        if exclude_token and client.get("token") == exclude_token:
            continue
        try:
            client["queue"].put_nowait(event)
        except Exception:
            dead.append(client)
    for d in dead:
        try:
            session["sse_clients"].remove(d)
        except ValueError:
            pass


# --------------------------------------------------------------------------
# Collaborative session management
# --------------------------------------------------------------------------

def _make_invite_token(session_id, group_name):
    """Generate an HMAC token for a session+group invite."""
    secret = session_id  # session ID is the secret — not guessable, not persistent
    msg = f"{session_id}:{group_name}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()[:16]


@app.route("/api/sessions/<sid>/invite", methods=["POST"])
def session_invite(sid):
    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400

    # Verify host token
    host_token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if host_token != session.get("host_token"):
        return jsonify({"error": "Not authorized — host only"}), 403

    group_name = body.get("groupName")
    participant_name = body.get("participantName", "Flight Lead")

    if not group_name or group_name not in session["group_waypoints"]:
        return jsonify({"error": f"Group '{group_name}' not found"}), 404

    invite_token = _make_invite_token(sid, group_name)

    # Register participant
    with _lock:
        session["participants"][invite_token] = {
            "name": participant_name,
            "group": group_name,
            "connected": False,
            "ready": False,
        }

    return jsonify({
        "inviteToken": invite_token,
        "joinUrl": f"/join/{sid}?token={invite_token}",
        "groupName": group_name,
    })


@app.route("/api/sessions/<sid>/join", methods=["GET"])
def session_join(sid):
    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    token = request.args.get("token")
    if not token:
        return jsonify({"error": "No token provided"}), 400

    # Check if it's the host
    is_host = token == session.get("host_token")

    # Check if it's an invited participant
    participant = session["participants"].get(token)

    if not is_host and not participant:
        return jsonify({"error": "Invalid invite token"}), 403

    with _lock:
        if participant:
            participant["connected"] = True
        session["last_activity"] = time.time()

    # Build response — filtered by role
    assigned_group = participant["group"] if participant else None
    role = "flight_lead" if participant else "mission_maker"

    # Return mission data + role info (same shape as upload response)
    theater = session["theater"]
    try:
        mission_dict = parse_mission_text(session["original_mission_text"])
        data = extract_full_mission_data(mission_dict, theater)

        # Apply current server waypoint state to groups
        for group in data["groups"]:
            if group["groupName"] in session["group_waypoints"]:
                group["waypoints"] = session["group_waypoints"][group["groupName"]]
                group["waypoints"] = recompute_route(group["waypoints"])

        # 856-equivalent extraction (same as upload)
        client_units = find_client_units(mission_dict)
        all_units_donor = get_all_units_for_donor_selection(mission_dict)
        all_groups_renamer = extract_all_groups(mission_dict)
        livery_data = extract_livery_data(mission_dict)
        statistics = extract_statistics(mission_dict)
        countries = extract_countries(mission_dict)
        suggestions = generate_datalink_suggestions(client_units)

        aircraft_types = list(set(u["type"] for u in client_units))
        pylon_options = {}
        for at in aircraft_types:
            opts = get_pylon_options(at)
            if opts:
                pylon_options[at] = opts

        dtc_flights = list(set(u["groupName"] for u in client_units))

        return jsonify({
            "sessionId": sid,
            "token": token,
            "role": role,
            "assignedGroup": assigned_group,
            "filename": session["filename"],
            "theater": theater,
            "participants": {
                t: {"name": p["name"], "group": p["group"], "connected": p["connected"]}
                for t, p in session["participants"].items()
            },
            **data,
            "clientUnits": client_units,
            "allUnitsDonor": all_units_donor,
            "pylonOptions": pylon_options,
            "suggestions": suggestions,
            "allGroupsRenamer": all_groups_renamer,
            "liveryData": livery_data,
            "laserClsids": sorted(LASER_CLSIDS, key=str),
            "dtcFlights": dtc_flights,
            "statistics": statistics,
            "countries": countries,
            "taskLists": {
                "air": AIR_TASKS,
                "ground": GROUND_TASKS,
                "ship": SHIP_TASKS,
            },
        })
    except Exception as e:
        return jsonify({"error": f"Failed to load session: {str(e)}"}), 500


@app.route("/api/sessions/<sid>/state", methods=["GET"])
def session_state(sid):
    """Get current session state — for reconnection."""
    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    # Return just the current waypoint state for all groups
    return jsonify({
        "group_waypoints": session["group_waypoints"],
        "participants": {
            t: {"name": p["name"], "group": p["group"], "connected": p["connected"]}
            for t, p in session["participants"].items()
        },
        "status": session["status"],
    })


HEARTBEAT_INTERVAL = 30  # seconds — Cloudflare kills idle connections at 100s


@app.route("/api/sessions/<sid>/stream")
def session_stream(sid):
    """SSE event stream with heartbeat keepalives for Cloudflare compatibility."""
    import sys
    print(f"SSE connect: sid={sid}, sessions={list(sessions.keys())}", flush=True)
    session = _get_session(sid)
    if not session:
        print(f"SSE 404: session {sid} not found", flush=True)
        return jsonify({"error": "Session not found"}), 404

    token = request.args.get("token", "")
    q = Queue()
    client = {"queue": q, "token": token}
    session["sse_clients"].append(client)
    print(f"SSE connected: token={token[:8]}..., clients={len(session['sse_clients'])}", flush=True)

    def generate():
        # Send immediately so Cloudflare/Traefik see a response right away
        yield ": connected\n\n"
        try:
            while True:
                try:
                    event = q.get(timeout=HEARTBEAT_INTERVAL)
                    yield f"event: {event['type']}\ndata: {json.dumps(event['data'])}\n\n"
                except Exception:
                    # Timeout — send heartbeat to keep Cloudflare alive
                    yield ": heartbeat\n\n"
        except GeneratorExit:
            pass
        finally:
            try:
                session["sse_clients"].remove(client)
            except (ValueError, KeyError):
                pass

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# --------------------------------------------------------------------------
# Ready check + session lifecycle
# --------------------------------------------------------------------------

@app.route("/api/sessions/<sid>/ready-check", methods=["POST"])
def session_ready_check(sid):
    """Mission maker requests all flight leads to confirm their routes are final."""
    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    host_token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if host_token != session.get("host_token"):
        return jsonify({"error": "Host only"}), 403

    with _lock:
        session["status"] = "ready_check"
        for p in session["participants"].values():
            p["ready"] = False

    _broadcast(session, "ready_check", {"requestedBy": "host"})
    return jsonify({"ok": True, "status": "ready_check"})


@app.route("/api/sessions/<sid>/ready", methods=["POST"])
def session_ready(sid):
    """Flight lead confirms their route is final."""
    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    participant = session["participants"].get(token)
    if not participant:
        return jsonify({"error": "Not a participant"}), 403

    with _lock:
        participant["ready"] = True

    _broadcast(session, "ready_response", {
        "name": participant["name"],
        "group": participant["group"],
        "ready": True,
    })

    # Check if all participants are ready
    all_ready = all(p["ready"] for p in session["participants"].values() if p["connected"])
    if all_ready:
        _broadcast(session, "all_ready", {})

    return jsonify({"ok": True, "allReady": all_ready})


@app.route("/api/sessions/<sid>/freeze", methods=["POST"])
def session_freeze(sid):
    """Mission maker freezes the session — no more edits allowed."""
    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    host_token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if host_token != session.get("host_token"):
        return jsonify({"error": "Host only"}), 403

    with _lock:
        session["status"] = "frozen"

    _broadcast(session, "session_frozen", {})
    return jsonify({"ok": True, "status": "frozen"})


@app.route("/api/sessions/<sid>/unfreeze", methods=["POST"])
def session_unfreeze(sid):
    """Mission maker unfreezes the session."""
    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    host_token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if host_token != session.get("host_token"):
        return jsonify({"error": "Host only"}), 403

    with _lock:
        session["status"] = "planning"

    _broadcast(session, "session_unfrozen", {})
    return jsonify({"ok": True, "status": "planning"})


# --------------------------------------------------------------------------
# Download — apply waypoint + unit edits, repack .miz
# --------------------------------------------------------------------------

@app.route("/api/download", methods=["POST"])
def download():
    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400

    sid = body.get("sessionId")
    unit_edits = body.get("unitEdits", [])
    kneeboard_data = body.get("kneeboards", [])

    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found or expired"}), 404

    try:
        # Start with trigger-updated text if available, otherwise original
        mission_text = session.get("mission_text", session["original_mission_text"])

        # 1. Replace waypoints only for groups that were actually edited
        dirty = session.get("dirty_groups", set())
        for group_name in dirty:
            waypoints = session["group_waypoints"].get(group_name)
            if not waypoints:
                continue
            mission_text = replace_group_waypoints(mission_text, group_name, waypoints)

        # 2. Apply unit-level surgical edits (856's edit engine)
        if unit_edits:
            import os as _os
            _dbg = _os.path.join(_os.path.dirname(__file__), "download_debug.log")
            _wdbg = _os.path.join(_os.path.dirname(__file__), "weather_debug.log")
            try:
                with open(_wdbg, "w", encoding="utf-8") as _f:
                    _f.write("")
                with open(_dbg, "w", encoding="utf-8") as _f:
                    _f.write(f"edits: {len(unit_edits)}\n")
                    for e in unit_edits:
                        val = e.get('value')
                        if e.get('field') == 'weather':
                            _f.write(f"  WEATHER: {val}\n")
                        else:
                            _f.write(f"  field={e.get('field')} unitId={e.get('unitId')} value={str(val)[:200]}\n")
            except Exception:
                pass
            original_len = len(mission_text)
            mission_text, edit_results = apply_unit_edits(mission_text, unit_edits)
            try:
                with open(_dbg, "a", encoding="utf-8") as _f:
                    _f.write(f"text changed: {original_len} -> {len(mission_text)} ({len(mission_text)-original_len:+d})\n")
                    for r in edit_results:
                        _f.write(f"  {r.get('status', '?').upper()}: {r}\n")
            except Exception:
                pass
        else:
            edit_results = []

        # Decode kneeboard base64 data to raw bytes
        kneeboards = None
        if kneeboard_data:
            import base64
            kneeboards = []
            for kb in kneeboard_data:
                kneeboards.append({
                    "aircraft_type": kb["aircraft_type"],
                    "filename": kb["filename"],
                    "data": base64.b64decode(kb["data"]),
                })

        # 3. Briefing text lives in l10n/DEFAULT/dictionary (DCS localization
        # mechanism). The DictKey references we need to resolve only exist in
        # the ORIGINAL mission text — apply_unit_edits' briefing handler has
        # already rewritten them in the working copy. Use original text for
        # DictKey lookup so the dictionary update finds the right entries.
        new_dictionary_text = None
        if any(e.get("field") == "briefing" for e in unit_edits):
            current_dict = extract_dictionary_from_miz(session["miz_bytes"])
            if current_dict is not None:
                new_dictionary_text = apply_briefing_edits_to_dictionary(
                    session["original_mission_text"], current_dict, unit_edits,
                )

        # 4. forcedOptions is mirrored in the top-level `options` file's
        # ["difficulty"] block — that's what DCS ME displays. Keep the two
        # in sync so the user's option toggles are visible in the ME.
        new_options_text = None
        forced_options_edits = [e for e in unit_edits if e.get("field") == "forcedOptions"]
        if forced_options_edits:
            current_options = extract_options_from_miz(session["miz_bytes"])
            if current_options is not None:
                # Later forcedOptions edits win
                merged: dict = {}
                for e in forced_options_edits:
                    merged.update(e.get("value") or {})
                new_options_text = apply_forced_options_to_options_file(current_options, merged)

        miz_bytes = repack_miz(
            session["miz_bytes"], mission_text,
            kneeboards=kneeboards,
            new_dictionary_text=new_dictionary_text,
            new_options_text=new_options_text,
        )

        resp = send_file(
            io.BytesIO(miz_bytes),
            mimetype="application/zip",
            as_attachment=True,
            download_name=session["filename"],
        )

        # Surface edit results to the client so they can see when an edit
        # they queued was silently dropped. Base64-encoded JSON in a custom
        # header to avoid messing with the binary body. If results somehow
        # exceed the header size limit (~8KB typical), truncate gracefully.
        try:
            import base64, json
            payload = json.dumps({"results": edit_results}, separators=(",", ":"))
            encoded = base64.b64encode(payload.encode("utf-8")).decode("ascii")
            if len(encoded) <= 7000:
                resp.headers["X-Edit-Results"] = encoded
            else:
                summary = {
                    "results": [
                        {"field": r.get("field"), "status": r.get("status")}
                        for r in edit_results
                    ],
                    "truncated": True,
                }
                resp.headers["X-Edit-Results"] = base64.b64encode(
                    json.dumps(summary, separators=(",", ":")).encode("utf-8"),
                ).decode("ascii")
            # Tell the browser to actually expose this custom header to JS
            resp.headers["Access-Control-Expose-Headers"] = "X-Edit-Results"
        except Exception:
            pass

        return resp
    except Exception as e:
        return jsonify({"error": f"Download failed: {str(e)}"}), 400


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------

@app.route("/api/export/json", methods=["POST"])
def export_json():
    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400

    sid = body.get("sessionId")
    with _lock:
        session = sessions.get(sid)
    if not session:
        return jsonify({"error": "Session not found or expired"}), 404

    try:
        mission_dict = parse_mission_text(session["original_mission_text"])
        data = extract_full_mission_data(mission_dict, session["theater"])

        # Apply server-authoritative waypoint state
        for group in data["groups"]:
            server_wps = session["group_waypoints"].get(group["groupName"])
            if server_wps:
                group["waypoints"] = server_wps
            if group["waypoints"]:
                group["waypoints"] = recompute_route(group["waypoints"])

        return jsonify({
            "theater": session["theater"],
            "filename": session["filename"],
            "groups": data["groups"],
        })
    except Exception as e:
        return jsonify({"error": f"Export failed: {str(e)}"}), 400


# --------------------------------------------------------------------------
# Weapon / Launcher settings
# --------------------------------------------------------------------------

@app.route("/api/launcher-settings/<path:clsid>", methods=["GET"])
def launcher_settings(clsid):
    settings = get_launcher_settings(clsid)
    if settings is None:
        return jsonify({"error": "CLSID not found"}), 404
    return jsonify(settings)


# --------------------------------------------------------------------------
# Weather presets
# --------------------------------------------------------------------------

@app.route("/api/sop/extract-archive", methods=["POST"])
def extract_archive():
    """Extract a squadron kneeboard mod archive (.ozp / .zip) and return each
    image file as base64. Handles standard deflate AND method 93 (Zstandard)
    used by CSG-3 and other DCS mod packs.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    archive_bytes = f.read()
    if not archive_bytes:
        return jsonify({"error": "Empty file"}), 400

    try:
        from services.archive_reader import read_archive
        entries = read_archive(archive_bytes)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Archive extraction failed: {str(e)}"}), 400

    IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp")
    import base64, os
    results = []
    for name, body in entries:
        lower = name.lower()
        if not lower.endswith(IMAGE_EXT):
            continue
        mime = (
            "image/png" if lower.endswith(".png") else
            "image/jpeg" if lower.endswith((".jpg", ".jpeg")) else
            "image/gif" if lower.endswith(".gif") else
            "image/webp" if lower.endswith(".webp") else
            "application/octet-stream"
        )
        results.append({
            "path": name,
            "filename": os.path.basename(name),
            "mimeType": mime,
            "dataBase64": base64.b64encode(body).decode("ascii"),
        })

    return jsonify({
        "filename": f.filename,
        "imageCount": len(results),
        "images": results,
    })


@app.route("/api/weather/presets", methods=["GET"])
def weather_presets():
    return jsonify(WEATHER_PRESETS)


# --------------------------------------------------------------------------
# Liveries (from baked livery_db.json)
# --------------------------------------------------------------------------

from reference.loader import get_liveries
_LIVERY_DB = get_liveries()


@app.route("/api/liveries", methods=["GET"])
def liveries_list():
    """List all aircraft types with available liveries."""
    return jsonify({t: len(livs) for t, livs in _LIVERY_DB.items()})


@app.route("/api/liveries/<path:unit_type>", methods=["GET"])
def liveries_for_type(unit_type):
    """List available liveries for a specific aircraft type."""
    livs = _LIVERY_DB.get(unit_type, [])
    return jsonify(livs)


# --------------------------------------------------------------------------
# DTC endpoints
# --------------------------------------------------------------------------

@app.route("/api/dtc/generate", methods=["POST"])
def dtc_generate():
    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400

    sid = body.get("sessionId")
    group_name = body.get("groupName")
    dtc_name = body.get("dtcName", group_name)
    edits = body.get("edits")

    with _lock:
        session = sessions.get(sid)
    if not session:
        return jsonify({"error": "Session not found or expired"}), 404

    try:
        mission_dict = parse_mission_text(session["original_mission_text"])
        flight_data = extract_flight_for_dtc(mission_dict, group_name)
        if not flight_data:
            return jsonify({"error": f"Flight '{group_name}' not found"}), 404

        # Overlay server-authoritative waypoints if the group was edited
        server_wps = session["group_waypoints"].get(group_name)
        if server_wps and group_name in session.get("dirty_groups", set()):
            flight_data["waypoints"] = server_wps

        flight_data["theatre"] = session["theater"]
        dtc = build_dtc_from_flight(flight_data, dtc_name)

        if edits:
            dtc = build_dtc_from_edits(dtc, edits)

        dtc_bytes = serialize_dtc(dtc)
        filename = f"{dtc_name or group_name}.dtc"

        return send_file(
            io.BytesIO(dtc_bytes),
            mimetype="application/json",
            as_attachment=True,
            download_name=filename,
        )
    except Exception as e:
        return jsonify({"error": f"DTC generation failed: {str(e)}"}), 400


@app.route("/api/dtc/preview", methods=["POST"])
def dtc_preview():
    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400

    sid = body.get("sessionId")
    group_name = body.get("groupName")

    with _lock:
        session = sessions.get(sid)
    if not session:
        return jsonify({"error": "Session not found or expired"}), 404

    try:
        mission_dict = parse_mission_text(session["original_mission_text"])
        flight_data = extract_flight_for_dtc(mission_dict, group_name)
        if not flight_data:
            return jsonify({"error": f"Flight '{group_name}' not found"}), 404

        # Overlay server-authoritative waypoints if the group was edited
        server_wps = session["group_waypoints"].get(group_name)
        if server_wps and group_name in session.get("dirty_groups", set()):
            flight_data["waypoints"] = server_wps

        flight_data["theatre"] = session["theater"]
        dtc = build_dtc_from_flight(flight_data, group_name)

        return jsonify({
            "groupName": group_name,
            "aircraftType": flight_data.get("aircraft_type", ""),
            "theatre": session["theater"],
            "dtc": dtc,
        })
    except Exception as e:
        return jsonify({"error": f"DTC preview failed: {str(e)}"}), 400


@app.route("/api/dtc/blank", methods=["GET"])
def dtc_blank():
    import copy
    return jsonify(copy.deepcopy(FA18_DEFAULTS))


@app.route("/api/dtc/export-raw", methods=["POST"])
def dtc_export_raw():
    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400

    dtc_data = body.get("dtc")
    filename = body.get("filename", "export.dtc")

    if not dtc_data:
        return jsonify({"error": "No DTC data provided"}), 400

    dtc_bytes = json.dumps(dtc_data, indent=4).encode("utf-8")
    return send_file(
        io.BytesIO(dtc_bytes),
        mimetype="application/json",
        as_attachment=True,
        download_name=filename,
    )


@app.route("/api/dtc/export-standalone", methods=["POST"])
def dtc_export_standalone():
    """Build a DTC from scratch (no mission needed) with user edits."""
    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400

    import copy
    dtc_name = body.get("dtcName", "Standalone")
    edits = body.get("edits")

    dtc = {
        "data": copy.deepcopy(FA18_DEFAULTS.get("data", {})),
        "name": dtc_name,
        "type": "FA-18C_hornet",
    }
    dtc["data"]["name"] = dtc_name
    dtc["data"]["type"] = "FA-18C_hornet"

    if edits:
        dtc = build_dtc_from_edits(dtc, edits)

    dtc_bytes = json.dumps(dtc, indent=4).encode("utf-8")
    return send_file(
        io.BytesIO(dtc_bytes),
        mimetype="application/json",
        as_attachment=True,
        download_name=f"{dtc_name}.dtc",
    )


# --------------------------------------------------------------------------
# Static data endpoints
# --------------------------------------------------------------------------

@app.route("/api/sam-ranges", methods=["GET"])
def sam_ranges():
    return jsonify(SAM_THREAT_RANGES)


@app.route("/api/projections", methods=["GET"])
def projections():
    return jsonify(THEATERS)


@app.route("/api/elevation/<float:lat>/<float:lon>", methods=["GET"])
def elevation(lat, lon):
    try:
        elev = _srtm_data.get_elevation(lat, lon)
        return jsonify({"elevation": elev})
    except Exception as e:
        # SRTM tile download may have failed or timed out
        return jsonify({"elevation": None})


@app.route("/api/sessions/<sid>/debug", methods=["GET"])
def debug_mission(sid):
    """Run debug analysis on the loaded mission."""
    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    try:
        from services.mission_debugger import run_debug_analysis

        mission_text = session["original_mission_text"]
        mission_dict = parse_mission_text(mission_text)
        theater = session.get("theater", "Unknown")

        data = extract_full_mission_data(mission_dict, theater)
        client_units = find_client_units(mission_dict)
        overview = data.get("overview", {})

        issues = run_debug_analysis(data["groups"], client_units, overview, mission_dict)
        return jsonify({"issues": issues})
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"DEBUG ANALYSIS ERROR:\n{tb}")
        return jsonify({"error": f"Debug analysis failed: {str(e)}", "trace": tb}), 500


@app.route("/api/close", methods=["POST"])
def close_session():
    body = request.get_json()
    sid = body.get("sessionId") if body else None
    if sid:
        with _lock:
            sessions.pop(sid, None)
    return jsonify({"ok": True})


# --------------------------------------------------------------------------
# Planner Drawings (user-created overlays)
# --------------------------------------------------------------------------

@app.route("/api/sessions/<sid>/drawings", methods=["GET"])
def get_planner_drawings(sid):
    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found"}), 404
    return jsonify({"drawings": session.get("planner_drawings", [])})


@app.route("/api/sessions/<sid>/drawings", methods=["POST"])
def save_planner_drawings(sid):
    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found"}), 404
    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400
    with _lock:
        session["planner_drawings"] = body.get("drawings", [])
    _broadcast(session, "drawings_update", {"drawings": session["planner_drawings"]})
    return jsonify({"ok": True})


# --------------------------------------------------------------------------
# Triggers & Audio
# --------------------------------------------------------------------------

@app.route("/api/triggers", methods=["GET"])
def get_triggers():
    """Get parsed triggers from the loaded mission."""
    sid = request.args.get("sessionId")
    if not sid or sid not in sessions:
        return jsonify({"error": "Session not found"}), 404

    session = sessions[sid]
    try:
        mission_dict = parse_mission_text(session.get("mission_text", session["original_mission_text"]))
        trigger_data = extract_triggers(mission_dict)
        audio_files = list_audio_files(session["miz_bytes"])
        return jsonify({**trigger_data, "audioFiles": audio_files})
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500


@app.route("/api/triggers", methods=["POST"])
def save_triggers():
    """Update triggers in the mission (immediate apply to session)."""
    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400

    sid = body.get("sessionId")
    if not sid or sid not in sessions:
        return jsonify({"error": "Session not found"}), 404

    trigger_data = body.get("triggers")
    if not trigger_data:
        return jsonify({"error": "No trigger data"}), 400

    session = sessions[sid]
    try:
        # Inline-format missions use a different on-disk shape than the
        # indexed format our full serializer emits. Rewriting an inline
        # mission with the indexed serializer wipes every rule's body.
        # For inline missions we fall back to surgical APPEND of new
        # rules only — original rules stay byte-for-byte intact.
        from services.trigger_editor import extract_triggers, append_inline_rules
        from services.miz_parser import parse_mission_text as _pmt

        current_text = session.get("mission_text", session["original_mission_text"])
        is_inline = False
        existing_rule_count = 0
        try:
            md = _pmt(current_text)
            existing = extract_triggers(md)
            is_inline = bool(existing.get("inlineFormat"))
            existing_rule_count = len(existing.get("rules", []))
        except Exception:
            pass  # fall through to default path

        # ── Always-prefer-append safety: if the ORIGINAL upload was
        # inline (we track that on the session), use append even if the
        # current text appears indexed (which can happen when the user
        # uploaded a previously-corrupted _edited.miz). This prevents
        # the rewrite path from compounding damage on already-broken
        # missions.
        if session.get("orig_inline_format"):
            is_inline = True

        rules = trigger_data.get("rules") or []

        # ── Catastrophic-loss guard: refuse the save if it would empty
        # out a substantial number of existing rules. Specifically: in
        # the indexed (rewrite) path, if any incoming rule has an id
        # matching an existing one but the rule's conditions+actions
        # are empty, the rewrite would replace a working rule with an
        # empty one. We can't always tell with certainty (some rules
        # legitimately have no body), but if MORE THAN HALF the rules
        # would be emptied we treat that as user error and refuse.
        if not is_inline and existing_rule_count >= 4:
            empty_count = sum(
                1 for r in rules
                if isinstance(r, dict)
                and not r.get("conditions") and not r.get("actions")
            )
            if empty_count > existing_rule_count // 2:
                return jsonify({
                    "error": (
                        "Refusing to save: this would wipe most existing trigger "
                        "bodies. The mission's session state may be corrupted from "
                        "a previous edit. Please re-upload the ORIGINAL .miz file "
                        "(not an _edited version) and try again."
                    ),
                }), 422

        if is_inline:
            new_text = append_inline_rules(current_text, rules)
        else:
            new_text = update_triggers_in_mission(current_text, trigger_data)

        with _lock:
            session["mission_text"] = new_text
        return jsonify({"ok": True, "inlineFormat": is_inline})
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500


@app.route("/api/audio/list", methods=["GET"])
def audio_list():
    """List audio files in the .miz archive."""
    sid = request.args.get("sessionId")
    if not sid or sid not in sessions:
        return jsonify({"error": "Session not found"}), 404

    audio_files = list_audio_files(sessions[sid]["miz_bytes"])
    return jsonify({"audioFiles": audio_files})


@app.route("/api/audio/upload", methods=["POST"])
def audio_upload():
    """Upload an audio file and embed it in the .miz archive."""
    sid = request.form.get("sessionId")
    if not sid or sid not in sessions:
        return jsonify({"error": "Session not found"}), 404

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "No filename"}), 400

    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in (".wav", ".ogg", ".mp3"):
        return jsonify({"error": "File must be .wav, .ogg, or .mp3"}), 400

    audio_data = f.read()
    session = sessions[sid]

    if session["miz_bytes"] is None:
        return jsonify({"error": "Cannot add audio to a raw mission file — must be a .miz archive"}), 400

    try:
        new_miz = add_audio_to_miz(session["miz_bytes"], f.filename, audio_data)
        with _lock:
            session["miz_bytes"] = new_miz
        return jsonify({
            "ok": True,
            "filename": f.filename,
            "path": f"l10n/DEFAULT/{f.filename}",
            "sizeBytes": len(audio_data),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/audio/<path:filepath>", methods=["DELETE"])
def audio_delete(filepath):
    """Remove an audio file from the .miz archive."""
    sid = request.args.get("sessionId")
    if not sid or sid not in sessions:
        return jsonify({"error": "Session not found"}), 404

    session = sessions[sid]
    try:
        new_miz = remove_audio_from_miz(session["miz_bytes"], filepath)
        with _lock:
            session["miz_bytes"] = new_miz
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/audio/stream/<path:filepath>", methods=["GET"])
def audio_stream(filepath):
    """Stream an audio file from the .miz for preview playback."""
    sid = request.args.get("sessionId")
    if not sid or sid not in sessions:
        return jsonify({"error": "Session not found"}), 404

    audio_bytes = get_audio_bytes(sessions[sid]["miz_bytes"], filepath)
    if audio_bytes is None:
        return jsonify({"error": "Audio file not found"}), 404

    ext = os.path.splitext(filepath)[1].lower()
    mime_map = {".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg"}
    mimetype = mime_map.get(ext, "application/octet-stream")

    return send_file(io.BytesIO(audio_bytes), mimetype=mimetype)


# --------------------------------------------------------------------------
# Brief generator — squadron PowerPoint template token replacement.
# Stateless: client posts the template + a resolved {token: value} dict,
# server returns the rendered .pptx. Mission-data → token resolution
# lives entirely in the frontend so the brief generator is independent
# of mission-data shape changes.
# --------------------------------------------------------------------------

@app.route("/api/brief/scan", methods=["POST"])
def brief_scan():
    """Inspect a .pptx template and return the unique token paths it uses.

    Request: multipart/form-data with field 'file' containing the .pptx.
    Response: {"tokens": ["mission.theater", "flight[0].callsign", ...]}
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    if not f.filename or not f.filename.lower().endswith(".pptx"):
        return jsonify({"error": "Template must be a .pptx file"}), 400
    template_bytes = f.read()
    if not template_bytes:
        return jsonify({"error": "Empty template"}), 400

    try:
        from services.brief_renderer import scan_template
        tokens = scan_template(template_bytes)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Scan failed: {e}"}), 500

    return jsonify({"filename": f.filename, "tokens": tokens})


@app.route("/api/brief/render", methods=["POST"])
def brief_render():
    """Substitute {{tokens}} in a .pptx template and return the rendered file.

    Request: multipart/form-data with:
      - 'file': the .pptx template
      - 'values': JSON string of {token_path: substituted_value}
      - 'format' (query param or form field): 'pptx' | 'pdf' | 'png' | 'jpg'
        Default 'pptx'. PNG/JPG return a ZIP with one image per slide.
    Tokens absent from `values` are left as literal `{{token}}` so the
    user can spot what didn't get filled.

    PDF/PNG/JPG paths require LibreOffice on the server. Returns 503 with
    a helpful message if it's not installed.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    if not f.filename or not f.filename.lower().endswith(".pptx"):
        return jsonify({"error": "Template must be a .pptx file"}), 400
    template_bytes = f.read()
    if not template_bytes:
        return jsonify({"error": "Empty template"}), 400

    values_raw = request.form.get("values", "{}")
    try:
        values = json.loads(values_raw)
    except json.JSONDecodeError as e:
        return jsonify({"error": f"Bad values JSON: {e}"}), 400
    if not isinstance(values, dict):
        return jsonify({"error": "values must be a JSON object"}), 400
    values = {k: ("" if v is None else str(v)) for k, v in values.items()}

    # Format selection — accept from query param or form field.
    fmt = (request.args.get("format") or request.form.get("format") or "pptx").lower()
    if fmt not in ("pptx", "pdf", "png", "jpg"):
        return jsonify({"error": f"Unsupported format: {fmt}"}), 400

    try:
        from services.brief_renderer import (
            render_template, convert_pptx, LibreOfficeNotFoundError,
        )
        rendered_pptx = render_template(template_bytes, values)
        out_bytes, mime = convert_pptx(rendered_pptx, fmt)
    except LibreOfficeNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Render failed: {e}"}), 500

    base = f.filename[:-len(".pptx")] if f.filename.lower().endswith(".pptx") else f.filename
    # PNG/JPG come back as a ZIP of per-slide images
    if fmt in ("png", "jpg"):
        out_name = f"{base}_brief_{fmt}.zip"
    elif fmt == "pdf":
        out_name = f"{base}_brief.pdf"
    else:
        out_name = f"{base}_brief.pptx"

    return send_file(
        io.BytesIO(out_bytes),
        mimetype=mime,
        as_attachment=True,
        download_name=out_name,
    )


@app.route("/api/brief/build-wing", methods=["POST"])
def brief_build_wing():
    """Build a WingBrief from the session's parsed mission data.

    Request: JSON {"sessionId": "..."}
    Response: WingBrief dict — all sections pre-filled with sensible defaults
    that the frontend editor displays for review/edit before render.
    """
    body = request.get_json(silent=True) or {}
    sid = body.get("sessionId")
    with _lock:
        session = sessions.get(sid)
    if not session:
        return jsonify({"error": "Session not found or expired"}), 404

    # Re-parse the mission to get a fresh structured view. The brief is
    # built from the original (non-edited) mission text — edits the user
    # has queued aren't applied here because the brief should reflect the
    # baseline mission state.
    try:
        from services.miz_parser import parse_mission_text, extract_full_mission_data
        from services.miz_editor import extract_dictionary_from_miz
        from services.brief_builder import build_wing_brief
        mission_dict = parse_mission_text(session["original_mission_text"])
        mission_data = extract_full_mission_data(mission_dict, session["theater"])
        # Pull the dictionary so DictKey_* refs resolve to user-visible text.
        dictionary_text = extract_dictionary_from_miz(session["miz_bytes"])
        brief = build_wing_brief(
            mission_data=mission_data,
            theater=session["theater"],
            filename=session.get("filename") or "",
            dictionary_text=dictionary_text,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Brief build failed: {e}"}), 500

    return jsonify(brief)


@app.route("/api/brief/preview-wing", methods=["POST"])
def brief_preview_wing():
    """Render an (edited) WingBrief to per-slide PNGs for the editor's
    inline preview pane. Returns a JSON array of base64 PNGs (one per
    slide) so the frontend can display without zip-parsing client-side.

    Request: JSON {"brief": {...WingBrief...}, "dpi": 100 (optional)}
    Response: {"slides": ["<base64 png>", ...]}

    Requires LibreOffice on the server — returns 503 with a helpful
    message when unavailable.
    """
    body = request.get_json(silent=True) or {}
    brief = body.get("brief")
    dpi = int(body.get("dpi") or 100)
    if not isinstance(brief, dict):
        return jsonify({"error": "brief object required"}), 400
    # Cap DPI to something reasonable — preview doesn't need print quality
    dpi = max(60, min(dpi, 200))

    try:
        from services.brief_renderer import (
            render_wing_brief, convert_pptx, _rasterize_pdf,
            LibreOfficeNotFoundError,
        )
        # PPTX → PDF (LibreOffice) → per-page PNG (pypdfium2). Skip the
        # zip-bundling that the public PNG export does — the editor needs
        # the raw slide images.
        pptx_bytes = render_wing_brief(brief)
        pdf_bytes, _ = convert_pptx(pptx_bytes, "pdf")
        slide_pngs = _rasterize_pdf(pdf_bytes, "png", dpi=dpi)
    except LibreOfficeNotFoundError as e:
        return jsonify({"error": str(e), "needs_libreoffice": True}), 503
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": f"Preview render failed: {e}"}), 500

    import base64
    return jsonify({
        "slides": [base64.b64encode(b).decode("ascii") for b in slide_pngs],
    })


@app.route("/api/brief/build-package", methods=["POST"])
def brief_build_package():
    """Build a complete brief package: wing brief + one per blue player flight.

    Request: JSON {"sessionId": "..."}
    Response: {"wing": WingBrief, "flights": [FlightBrief, ...]}
    The frontend can edit the wing brief before render; in Phase 3a flight
    briefs are rendered as auto-generated (no per-flight editor yet).
    """
    body = request.get_json(silent=True) or {}
    sid = body.get("sessionId")
    with _lock:
        session = sessions.get(sid)
    if not session:
        return jsonify({"error": "Session not found or expired"}), 404

    try:
        from services.miz_parser import parse_mission_text, extract_full_mission_data
        from services.miz_editor import extract_dictionary_from_miz
        from services.brief_builder import build_wing_brief, build_flight_briefs
        mission_dict = parse_mission_text(session["original_mission_text"])
        mission_data = extract_full_mission_data(mission_dict, session["theater"])
        dictionary_text = extract_dictionary_from_miz(session["miz_bytes"])
        kwargs = dict(
            mission_data=mission_data, theater=session["theater"],
            filename=session.get("filename") or "",
            dictionary_text=dictionary_text,
        )
        wing = build_wing_brief(**kwargs)
        flights = build_flight_briefs(**kwargs)
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": f"Package build failed: {e}"}), 500

    return jsonify({"wing": wing, "flights": flights})


@app.route("/api/brief/render-package", methods=["POST"])
def brief_render_package():
    """Render the wing brief + all flight briefs as a single .zip download.

    Request: JSON {"wing": WingBrief, "flights": [FlightBrief, ...], "format": "pptx|pdf"}
    Response: application/zip containing one file per brief at the chosen format.

    Format support: pptx and pdf in this slice. PNG/JPG package output is
    not yet supported — convert_pptx returns a per-slide ZIP for those
    formats which would require nested-zip handling. Use the per-brief
    /api/brief/render-wing endpoint for image exports.
    """
    body = request.get_json(silent=True) or {}
    wing = body.get("wing")
    flights = body.get("flights") or []
    fmt = (body.get("format") or "pptx").lower()
    if not isinstance(wing, dict):
        return jsonify({"error": "wing brief object required"}), 400
    if not isinstance(flights, list):
        return jsonify({"error": "flights must be a list"}), 400
    if fmt not in ("pptx", "pdf"):
        return jsonify({"error": f"Package format must be pptx or pdf (got {fmt})"}), 400

    try:
        from services.brief_renderer import (
            render_wing_brief, render_flight_brief, convert_pptx,
            LibreOfficeNotFoundError,
        )
        import zipfile

        safe_name = (wing.get("mission_name") or "brief").replace("/", "_").replace("\\", "_")

        # Render every brief to pptx bytes, then convert each to the
        # requested format. We do conversions inside the loop so a single
        # malformed brief doesn't take down the whole package.
        items: list[tuple[str, bytes]] = []  # (filename_in_zip, bytes)

        wing_pptx = render_wing_brief(wing)
        wing_out, _ = convert_pptx(wing_pptx, fmt)  # noqa: pptx passthrough or pdf
        items.append((f"{safe_name}_wing.{fmt}", wing_out))

        for fb in flights:
            cs = (fb.get("callsign") or "flight").replace("/", "_").replace("\\", "_").replace(" ", "_")
            fb_pptx = render_flight_brief(fb)
            fb_out, _ = convert_pptx(fb_pptx, fmt)
            items.append((f"{safe_name}_flight_{cs}.{fmt}", fb_out))

        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, data in items:
                zf.writestr(name, data)

    except LibreOfficeNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": f"Package render failed: {e}"}), 500

    return send_file(
        io.BytesIO(zip_buf.getvalue()),
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"{safe_name}_brief_package_{fmt}.zip",
    )


@app.route("/api/brief/render-wing", methods=["POST"])
def brief_render_wing():
    """Render an (edited) WingBrief dict to .pptx / .pdf / .png.zip / .jpg.zip.

    Request: JSON {"brief": {...WingBrief...}, "format": "pptx|pdf|png|jpg"}
    """
    body = request.get_json(silent=True) or {}
    brief = body.get("brief")
    fmt = (body.get("format") or "pptx").lower()
    if not isinstance(brief, dict):
        return jsonify({"error": "brief object required"}), 400
    if fmt not in ("pptx", "pdf", "png", "jpg"):
        return jsonify({"error": f"Unsupported format: {fmt}"}), 400

    try:
        from services.brief_renderer import (
            render_wing_brief, convert_pptx, LibreOfficeNotFoundError,
        )
        pptx_bytes = render_wing_brief(brief)
        out_bytes, mime = convert_pptx(pptx_bytes, fmt)
    except LibreOfficeNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Render failed: {e}"}), 500

    safe_name = (brief.get("mission_name") or "wing_brief").replace("/", "_").replace("\\", "_")
    if fmt in ("png", "jpg"):
        out_name = f"{safe_name}_wing_{fmt}.zip"
    elif fmt == "pdf":
        out_name = f"{safe_name}_wing.pdf"
    else:
        out_name = f"{safe_name}_wing.pptx"

    return send_file(
        io.BytesIO(out_bytes), mimetype=mime, as_attachment=True, download_name=out_name,
    )


@app.route("/api/brief/sample-template", methods=["GET"])
def brief_sample_template():
    """Return a starter .pptx template populated with every supported token.

    Squadrons can download this, drop their logo + restyle in PowerPoint,
    and re-upload as their custom template. Generated on the fly so it
    never drifts from the documented token list.
    """
    from services.brief_renderer import generate_default_template
    pptx_bytes = generate_default_template()
    return send_file(
        io.BytesIO(pptx_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        as_attachment=True,
        download_name="mission_brief_template.pptx",
    )


@app.route("/api/brief/capabilities", methods=["GET"])
def brief_capabilities():
    """Report which output formats this server can produce.

    Used by the frontend to disable PDF/PNG/JPG options when LibreOffice
    isn't installed (e.g. local dev), so the user gets a clear UI cue
    instead of a surprise 503.
    """
    from services.brief_renderer import is_conversion_available
    has_libreoffice = is_conversion_available()
    return jsonify({
        "formats": ["pptx"] + (["pdf", "png", "jpg"] if has_libreoffice else []),
        "libreoffice": has_libreoffice,
    })


# --------------------------------------------------------------------------
# Frontend SPA catch-all — both `/` (bare root) and `/<anything>` are
# served from the built frontend's static directory. The two decorators
# MUST stay stacked on the same function; if anything is inserted between
# them, the `/` decorator orphans onto the next function and routes the
# bare URL into the wrong handler (this happened once — a hit to `/` was
# 500ing because it landed on `brief_scan`).
# --------------------------------------------------------------------------

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    # Serve actual static files (JS, CSS, images) if they exist
    if path and os.path.exists(os.path.join(static_dir, path)):
        return send_from_directory(static_dir, path)
    # Everything else gets index.html (SPA client-side routing)
    return send_from_directory(static_dir, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False)
