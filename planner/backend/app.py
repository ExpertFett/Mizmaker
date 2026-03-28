"""
DCS Mission Map Planner — Flask backend.

Routes:
  POST /api/upload       — Upload .miz, parse, return full mission JSON
  POST /api/edit/waypoints — Apply waypoint edits to session
  POST /api/download     — Apply edits, repack .miz, stream file
  POST /api/export/json  — Export planning data as airboss-compatible JSON
  GET  /api/sam-ranges   — Return SAM/AAA threat range data
  GET  /api/projections  — Return theater projection parameters
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

# In-memory session store (same pattern as 856)
sessions = {}
SESSION_TTL = 600  # 10 minutes
MAX_SESSIONS = 50
_lock = threading.Lock()


def _cleanup_sessions():
    now = time.time()
    with _lock:
        expired = [k for k, v in sessions.items() if now - v["created_at"] > SESSION_TTL]
        for k in expired:
            del sessions[k]


def _create_session(miz_bytes: bytes, mission_text: str, theater: str, filename: str) -> str:
    _cleanup_sessions()
    if len(sessions) >= MAX_SESSIONS:
        # Evict oldest
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
        data = extract_full_mission_data(mission_dict, theater)
    except Exception as e:
        return jsonify({"error": f"Failed to extract mission data: {str(e)}"}), 400

    # Recompute route leg data for all groups
    for group in data["groups"]:
        if group["waypoints"]:
            group["waypoints"] = recompute_route(group["waypoints"])

    # Store session (discard parsed dict to save memory)
    sid = _create_session(miz_bytes, mission_text, theater, f.filename)

    return jsonify({
        "sessionId": sid,
        "filename": f.filename,
        "theater": theater,
        **data,
    })



@app.route("/api/download", methods=["POST"])
def download():
    body = request.get_json()
    if not body:
        return jsonify({"error": "No JSON body"}), 400

    sid = body.get("sessionId")
    edits = body.get("edits", [])
    modified_groups = body.get("modifiedGroups", {})

    with _lock:
        session = sessions.get(sid)
    if not session:
        return jsonify({"error": "Session not found or expired"}), 404

    try:
        mission_text = session["mission_text"]

        # Replace waypoints for each modified group — identified by name
        for group_name, group_data in modified_groups.items():
            waypoints = group_data.get("waypoints", []) if isinstance(group_data, dict) else group_data
            mission_text = replace_group_waypoints(mission_text, group_name, waypoints)

        miz_bytes = repack_miz(session["miz_bytes"], mission_text)

        return send_file(
            io.BytesIO(miz_bytes),
            mimetype="application/zip",
            as_attachment=True,
            download_name=session["filename"],
        )
    except Exception as e:
        return jsonify({"error": f"Download failed: {str(e)}"}), 400


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

        # Shape matches airboss DcsWaypoint/DcsGroup columns
        return jsonify({
            "theater": session["theater"],
            "filename": session["filename"],
            "groups": data["groups"],
        })
    except Exception as e:
        return jsonify({"error": f"Export failed: {str(e)}"}), 400


@app.route("/api/sam-ranges", methods=["GET"])
def sam_ranges():
    return jsonify(SAM_THREAT_RANGES)


@app.route("/api/projections", methods=["GET"])
def projections():
    return jsonify(THEATERS)


@app.route("/api/elevation/<float:lat>/<float:lon>", methods=["GET"])
def elevation(lat, lon):
    """Get terrain elevation at lat/lon using local SRTM data. No API key needed."""
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


# Serve frontend SPA — catch-all for non-API routes
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path and os.path.exists(os.path.join(app.static_folder or "", path)):
        return send_from_directory(app.static_folder or "static", path)
    return send_from_directory(app.static_folder or "static", "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
