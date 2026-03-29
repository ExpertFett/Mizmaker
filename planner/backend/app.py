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
  POST /api/sessions/{id}/invite — Generate invite link for a flight lead
  GET  /api/sessions/{id}/join   — Join session via invite token
  GET  /api/sessions/{id}/stream — SSE event stream for real-time updates
  GET  /api/sessions/{id}/state  — Get current session state (for reconnection)
"""

import json
import os
import time
import uuid
import threading
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
from services.miz_editor import replace_group_waypoints, repack_miz
from services.unit_editor import apply_unit_edits
from services.trigger_editor import (
    extract_triggers,
    update_triggers_in_mission,
    list_audio_files,
    get_audio_bytes,
    add_audio_to_miz,
    remove_audio_from_miz,
)
from services.unit_extractor import (
    find_client_units,
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
import srtm

# Initialize SRTM elevation data (downloads HGT tiles on first use, caches locally)
_srtm_data = srtm.get_data()

# Serve built frontend from /static in production, or run with Vite proxy in dev
static_dir = os.path.join(os.path.dirname(__file__), "static")
# Disable Flask's built-in static serving — our catch-all handles everything.
# static_url_path="" conflicts with the SPA catch-all (both match /<path:path>).
app = Flask(__name__, static_folder=None)

CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB

# In-memory session store — server is the source of truth for waypoint state
sessions = {}
SESSION_TTL = 7200  # 2 hours for collaborative planning
MAX_SESSIONS = 20
_lock = threading.Lock()


def _cleanup_sessions():
    now = time.time()
    with _lock:
        expired = [k for k, v in sessions.items() if now - v.get("last_activity", v["created_at"]) > SESSION_TTL]
        for k in expired:
            del sessions[k]


def _create_session(miz_bytes, mission_text, theater, filename, group_waypoints):
    _cleanup_sessions()
    if len(sessions) >= MAX_SESSIONS:
        oldest = min(sessions, key=lambda k: sessions[k]["created_at"])
        del sessions[oldest]
    sid = str(uuid.uuid4())
    host_token = str(uuid.uuid4())
    with _lock:
        sessions[sid] = {
            "miz_bytes": miz_bytes,
            "original_mission_text": mission_text,  # never mutated
            "theater": theater,
            "filename": filename,
            "created_at": time.time(),
            "last_activity": time.time(),
            # Server-authoritative waypoint state
            "group_waypoints": group_waypoints,  # { group_name: [wp, wp, ...] }
            "dirty_groups": set(),  # groups that were actually edited
            # Server-authoritative unit edits (loadouts, datalink, etc.)
            "unit_edits": [],  # accumulated from all participants
            "pending_triggers": None,  # trigger edits, applied at download
            # Collaborative session fields
            "host_token": host_token,
            "participants": {},  # { token: { name, group, connected, ready } }
            "status": "planning",
            "sse_clients": [],
        }
    return sid, host_token


def _get_session(sid):
    with _lock:
        return sessions.get(sid)


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
        data = extract_full_mission_data(mission_dict, theater)
        for group in data["groups"]:
            if group["waypoints"]:
                group["waypoints"] = recompute_route(group["waypoints"])

        # 856-equivalent extraction (client units, loadouts, datalink, liveries, etc.)
        client_units = find_client_units(mission_dict)
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
        return jsonify({"error": f"Failed to extract mission data: {str(e)}"}), 400

    # Build server-authoritative waypoint state from parsed groups
    group_waypoints = {}
    for group in data["groups"]:
        group_waypoints[group["groupName"]] = group["waypoints"]

    sid, host_token = _create_session(miz_bytes, mission_text, theater, f.filename, group_waypoints)

    return jsonify({
        "sessionId": sid,
        "hostToken": host_token,
        "filename": f.filename,
        "theater": theater,
        # Planner map data
        **data,
        # 856-equivalent data
        "clientUnits": client_units,
        "allUnitsDonor": all_units_donor,
        "pylonOptions": pylon_options,
        "suggestions": suggestions,
        "allGroupsRenamer": all_groups_renamer,
        "liveryData": livery_data,
        "laserClsids": sorted(LASER_CLSIDS),
        "dtcFlights": dtc_flights,
        "statistics": statistics,
        "countries": countries,
        "taskLists": {
            "air": AIR_TASKS,
            "ground": GROUND_TASKS,
            "ship": SHIP_TASKS,
        },
    })


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
            "laserClsids": sorted(LASER_CLSIDS),
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

    session = _get_session(sid)
    if not session:
        return jsonify({"error": "Session not found or expired"}), 404

    try:
        mission_text = session["original_mission_text"]

        # 1. Replace waypoints only for groups that were actually edited
        dirty = session.get("dirty_groups", set())
        for group_name in dirty:
            waypoints = session["group_waypoints"].get(group_name)
            if not waypoints:
                continue
            mission_text = replace_group_waypoints(mission_text, group_name, waypoints)

        # 2. Apply unit-level surgical edits (856's edit engine)
        # Merge: server-stored edits from all participants + any client-local edits
        all_edits = list(session.get("unit_edits", [])) + unit_edits
        if all_edits:
            mission_text = apply_unit_edits(mission_text, all_edits)

        # 3. Apply trigger edits if any
        pending_triggers = session.get("pending_triggers")
        if pending_triggers:
            mission_text = update_triggers_in_mission(mission_text, pending_triggers)

        miz_bytes = repack_miz(session["miz_bytes"], mission_text)

        return send_file(
            io.BytesIO(miz_bytes),
            mimetype="application/zip",
            as_attachment=True,
            download_name=session["filename"],
        )
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

@app.route("/api/weather/presets", methods=["GET"])
def weather_presets():
    return jsonify(WEATHER_PRESETS)


# --------------------------------------------------------------------------
# Liveries (from baked livery_db.json)
# --------------------------------------------------------------------------

_livery_db_path = os.path.join(os.path.dirname(__file__), "data", "livery_db.json")
_LIVERY_DB = {}
if os.path.exists(_livery_db_path):
    with open(_livery_db_path) as f:
        _LIVERY_DB = json.load(f)


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


@app.route("/api/close", methods=["POST"])
def close_session():
    body = request.get_json()
    sid = body.get("sessionId") if body else None
    if sid:
        with _lock:
            sessions.pop(sid, None)
    return jsonify({"ok": True})


# --------------------------------------------------------------------------
# Triggers & Audio
# --------------------------------------------------------------------------

@app.route("/api/triggers", methods=["GET"])
def get_triggers():
    """Get parsed triggers from the loaded mission."""
    sid = request.args.get("sessionId")
    session = _get_session(sid) if sid else None
    if not session:
        return jsonify({"error": "Session not found"}), 404

    try:
        # If triggers were edited, return the pending version
        if session.get("pending_triggers"):
            trigger_data = session["pending_triggers"]
        else:
            mission_dict = parse_mission_text(session["original_mission_text"])
            trigger_data = extract_triggers(mission_dict)
        audio_files = list_audio_files(session["miz_bytes"])
        return jsonify({**trigger_data, "audioFiles": audio_files})
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500


@app.route("/api/triggers", methods=["POST"])
def save_triggers():
    """Store trigger edits — applied at download time."""
    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400

    sid = body.get("sessionId")
    session = _get_session(sid) if sid else None
    if not session:
        return jsonify({"error": "Session not found"}), 404

    trigger_data = body.get("triggers")
    if not trigger_data:
        return jsonify({"error": "No trigger data"}), 400

    with _lock:
        session["pending_triggers"] = trigger_data
        session["last_activity"] = time.time()

    return jsonify({"ok": True})


@app.route("/api/audio/list", methods=["GET"])
def audio_list():
    """List audio files in the .miz archive."""
    sid = request.args.get("sessionId")
    session = _get_session(sid) if sid else None
    if not session:
        return jsonify({"error": "Session not found"}), 404

    audio_files = list_audio_files(session["miz_bytes"])
    return jsonify({"audioFiles": audio_files})


@app.route("/api/audio/upload", methods=["POST"])
def audio_upload():
    """Upload an audio file and embed it in the .miz archive."""
    sid = request.form.get("sessionId")
    session = _get_session(sid) if sid else None
    if not session:
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
    session = _get_session(sid) if sid else None
    if not session:
        return jsonify({"error": "Session not found"}), 404

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
    session = _get_session(sid) if sid else None
    if not session:
        return jsonify({"error": "Session not found"}), 404

    audio_bytes = get_audio_bytes(session["miz_bytes"], filepath)
    if audio_bytes is None:
        return jsonify({"error": "Audio file not found"}), 404

    ext = os.path.splitext(filepath)[1].lower()
    mime_map = {".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg"}
    mimetype = mime_map.get(ext, "application/octet-stream")

    return send_file(io.BytesIO(audio_bytes), mimetype=mimetype)


# --------------------------------------------------------------------------
# Frontend SPA catch-all
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
    app.run(host="0.0.0.0", port=5001, debug=True)
