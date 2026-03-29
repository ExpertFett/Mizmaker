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
"""

import json
import os
import time
import uuid
import threading
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
import io

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
    list_audio_files,
    get_audio_bytes,
    add_audio_to_miz,
    remove_audio_from_miz,
    update_triggers_in_mission,
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
if os.path.exists(static_dir):
    app = Flask(__name__, static_folder=static_dir, static_url_path="")
else:
    app = Flask(__name__)

CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB

# In-memory session store
sessions = {}
SESSION_TTL = 600
MAX_SESSIONS = 50
_lock = threading.Lock()


def _cleanup_sessions():
    now = time.time()
    with _lock:
        expired = [k for k, v in sessions.items() if now - v["created_at"] > SESSION_TTL]
        for k in expired:
            del sessions[k]


def _create_session(miz_bytes, mission_text, theater, filename):
    _cleanup_sessions()
    if len(sessions) >= MAX_SESSIONS:
        oldest = min(sessions, key=lambda k: sessions[k]["created_at"])
        del sessions[oldest]
    sid = str(uuid.uuid4())
    with _lock:
        sessions[sid] = {
            "miz_bytes": miz_bytes,
            "mission_text": mission_text,
            "theater": theater,
            "filename": filename,
            "created_at": time.time(),
        }
    return sid


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

    sid = _create_session(miz_bytes, mission_text, theater, f.filename)

    return jsonify({
        "sessionId": sid,
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
# Download — apply waypoint + unit edits, repack .miz
# --------------------------------------------------------------------------

@app.route("/api/download", methods=["POST"])
def download():
    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400

    sid = body.get("sessionId")
    modified_groups = body.get("modifiedGroups", {})
    unit_edits = body.get("unitEdits", [])

    with _lock:
        session = sessions.get(sid)
    if not session:
        return jsonify({"error": "Session not found or expired"}), 404

    try:
        mission_text = session["mission_text"]

        # 1. Replace waypoints for modified groups (hierarchy-based, by name)
        for group_name, group_data in modified_groups.items():
            waypoints = group_data.get("waypoints", []) if isinstance(group_data, dict) else group_data
            mission_text = replace_group_waypoints(mission_text, group_name, waypoints)

        # 2. Apply unit-level surgical edits (856's edit engine)
        if unit_edits:
            mission_text = apply_unit_edits(mission_text, unit_edits)

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
        mission_dict = parse_mission_text(session["mission_text"])
        data = extract_full_mission_data(mission_dict, session["theater"])
        for group in data["groups"]:
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
        mission_dict = parse_mission_text(session["mission_text"])
        flight_data = extract_flight_for_dtc(mission_dict, group_name)
        if not flight_data:
            return jsonify({"error": f"Flight '{group_name}' not found"}), 404

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
        mission_dict = parse_mission_text(session["mission_text"])
        flight_data = extract_flight_for_dtc(mission_dict, group_name)
        if not flight_data:
            return jsonify({"error": f"Flight '{group_name}' not found"}), 404

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
        print(f"SRTM elevation error for ({lat},{lon}): {e}")
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
    if not sid or sid not in sessions:
        return jsonify({"error": "Session not found"}), 404

    session = sessions[sid]
    try:
        mission_dict = parse_mission_text(session["mission_text"])
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
        new_text = update_triggers_in_mission(session["mission_text"], trigger_data)
        with _lock:
            session["mission_text"] = new_text
        return jsonify({"ok": True})
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
# Frontend SPA catch-all
# --------------------------------------------------------------------------

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path and os.path.exists(os.path.join(app.static_folder or "", path)):
        return send_from_directory(app.static_folder or "static", path)
    return send_from_directory(app.static_folder or "static", "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
