"""DM trigger fire through OlympusLite's direct gm `flag` command (hook 0.2.0+).

fire_trigger on a kind='olympuslite' profile asks /health whether the hook has
the command (features: ["flag"], or version >= 0.2.0). If so it POSTs
{"command":"flag","flag":N,"value":1} and spawns nothing, so the mission needs
no dcsopt-dm-bridge.lua. Otherwise, or if the mission side answers "unknown
command", it falls back to the DMFIRE-<flag> name-channel spawn.

A fake OlympusLite runs on a real local socket and enforces the hook's rules:
flag is gm-only, 1..999999, value a number."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from services import olympuslite_bridge as olb
from tests.test_groups import login  # noqa: F401
from tests.test_olympuslite_bridge import fake_sb  # noqa: F401  (sets PROFILE_ENC_KEY)

GM, BLUE = "gm-pw", "blue-pw"
AIRBASES = [{"name": "Kutaisi", "id": 25, "coalition": "blue", "kind": "airdrome",
             "lat": 42.176, "lon": 42.482}]


class FakeLite:
    def __init__(self, version="0.2.0", features=("flag",), mission_knows_flag=True):
        self.version = version
        self.features = features
        self.mission_knows_flag = mission_knows_flag
        self.health_up = True
        self.commands: list = []
        self.flags: dict = {}
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *_a):
                pass

            def _send(self, code, obj):
                body = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _role(self):
                return {GM: "gm", BLUE: "blue"}.get(self.headers.get("X-OLite-Key"))

            def do_GET(self):
                if self.path == "/health":
                    if not fake.health_up:
                        return self._send(500, {"ok": False})
                    h = {"ok": True, "name": "OlympusLite", "version": fake.version, "installed": True}
                    if fake.features is not None:
                        h["features"] = list(fake.features)
                    return self._send(200, h)
                if not self._role():
                    return self._send(401, {"ok": False, "error": "missing or wrong password"})
                if self.path == "/airbases":
                    return self._send(200, AIRBASES)
                return self._send(404, {"ok": False})

            def do_POST(self):
                role = self._role()
                if not role:
                    return self._send(401, {"ok": False, "error": "missing or wrong password"})
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
                fake.commands.append(body)
                if body.get("command") == "flag":
                    if not fake.mission_knows_flag:
                        return self._send(400, {"ok": False, "error": "unknown command: flag"})
                    if role != "gm":
                        return self._send(400, {"ok": False, "error": "flag is gm-only"})
                    f, v = body.get("flag"), body.get("value", 1)
                    if not isinstance(f, int) or not 1 <= f <= 999999:
                        return self._send(400, {"ok": False, "error": "'flag' must be an integer 1..999999"})
                    if not isinstance(v, (int, float)) or isinstance(v, bool):
                        return self._send(400, {"ok": False, "error": "'value' must be a number"})
                    fake.flags[f] = v
                    return self._send(200, {"ok": True, "flag": f, "value": v, "readback": v})
                return self._send(200, {"ok": True, "group": "OLITE-" + str(body.get("name"))})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def lite():
    made = []

    def make(**kw):
        f = FakeLite(**kw)
        made.append(f)
        return f

    yield make
    for f in made:
        f.close()


def _profile(client, monkeypatch, port, password=GM):
    login(monkeypatch, "admin1", "Admin")
    gid = client.post("/api/groups", json={"name": "G"}).get_json()["id"]
    pid = client.post(f"/api/groups/{gid}/profiles", json={
        "name": "Lite", "kind": "olympuslite", "olympusHost": "127.0.0.1",
        "olympusPort": port, "olympusPassword": password}).get_json()["id"]
    return gid, pid


def _fire(client, gid, pid, flag=9001):
    r = client.post(f"/api/groups/{gid}/profiles/{pid}/fire_trigger", json={"flagIndex": flag})
    return r.status_code, r.get_json()


# --------------------------------------------------------------------------
# Bridge helpers
# --------------------------------------------------------------------------
class TestSupportsFlag:
    @pytest.mark.parametrize("version,features,want", [
        ("0.2.0", ("flag",), True),
        ("0.2.0", None, True),        # version alone is enough
        ("0.3.1", None, True),
        ("1.0", None, True),
        ("0.1.0", None, False),       # v0.1 hook: spawn channel
        ("0.1.0", ("flag",), True),   # an advertised feature wins
        ("0.2.0", (), True),
        ("garbage", None, False),
        (None, None, False),
    ])
    def test_detection(self, lite, version, features, want):
        f = lite(version=version, features=features)
        assert olb.supports_flag("127.0.0.1", f.port, GM) is want

    def test_unreachable_or_no_host_is_false(self, lite):
        f = lite()
        f.health_up = False
        assert olb.supports_flag("127.0.0.1", f.port, GM) is False
        assert olb.supports_flag("", f.port, GM) is False
        assert olb.supports_flag("127.0.0.1", 1, GM) is False  # nothing listening

    def test_version_tuple(self):
        assert olb._version_tuple("0.2.0") == (0, 2, 0)
        assert olb._version_tuple("0.10") == (0, 10, 0)
        assert olb._version_tuple("0.2.0-beta") == (0, 2, 0)
        assert olb._version_tuple("x") is None


class TestSetFlag:
    def test_ok(self, lite):
        f = lite()
        r = olb.set_flag("127.0.0.1", f.port, GM, 9001)
        assert r["ok"] is True and r["response"]["readback"] == 1
        assert f.commands == [{"command": "flag", "flag": 9001, "value": 1}]

    def test_value_passed(self, lite):
        f = lite()
        assert olb.set_flag("127.0.0.1", f.port, GM, 42, 0)["ok"]
        assert f.flags[42] == 0

    def test_non_gm_rejected(self, lite):
        f = lite()
        r = olb.set_flag("127.0.0.1", f.port, BLUE, 9001)
        assert r["ok"] is False and "gm-only" in r["error"] and not r.get("unsupported")
        assert f.flags == {}

    def test_unknown_command_marked_unsupported(self, lite):
        f = lite(mission_knows_flag=False)
        r = olb.set_flag("127.0.0.1", f.port, GM, 9001)
        assert r["ok"] is False and r["unsupported"] is True

    def test_bad_password_and_no_host(self, lite):
        f = lite()
        assert "password" in olb.set_flag("127.0.0.1", f.port, "nope", 1)["error"]
        assert olb.set_flag("", f.port, GM, 1)["ok"] is False


# --------------------------------------------------------------------------
# Route
# --------------------------------------------------------------------------
class TestFireRouteFlag:
    def test_flag_channel_spawns_nothing(self, client, fake_sb, monkeypatch, lite):
        f = lite()
        gid, pid = _profile(client, monkeypatch, f.port)
        code, j = _fire(client, gid, pid, 9001)
        assert code == 200 and j["ok"] is True and j["channel"] == "flag", j
        assert j["flagIndex"] == 9001 and "anchor" not in j
        assert f.commands == [{"command": "flag", "flag": 9001, "value": 1}]  # no spawn, no airbases
        assert f.flags == {9001: 1}

    def test_old_hook_falls_back_to_name_spawn(self, client, fake_sb, monkeypatch, lite):
        f = lite(version="0.1.0", features=None)
        gid, pid = _profile(client, monkeypatch, f.port)
        code, j = _fire(client, gid, pid, 9001)
        assert code == 200 and j["ok"] is True and j["channel"] == "name", j
        assert j["anchor"]["name"] == "Kutaisi"
        assert [c["command"] for c in f.commands] == ["spawn"]
        assert f.commands[0]["name"] == "DMFIRE-9001" and f.flags == {}

    def test_unknown_command_falls_back_to_name_spawn(self, client, fake_sb, monkeypatch, lite):
        f = lite(mission_knows_flag=False)
        gid, pid = _profile(client, monkeypatch, f.port)
        code, j = _fire(client, gid, pid, 77)
        assert code == 200 and j["channel"] == "name", j
        assert [c["command"] for c in f.commands] == ["flag", "spawn"]
        assert f.commands[1]["name"] == "DMFIRE-77"

    def test_flag_refused_is_502_without_spawn(self, client, fake_sb, monkeypatch, lite):
        # A commander password: the hook says gm-only. Don't spawn a signal the
        # same role couldn't place either; surface the error.
        f = lite()
        gid, pid = _profile(client, monkeypatch, f.port, password=BLUE)
        code, j = _fire(client, gid, pid, 9001)
        assert code == 502 and j["ok"] is False and j["channel"] == "flag"
        assert "gm-only" in j["error"]
        assert [c["command"] for c in f.commands] == ["flag"]

    def test_olympus_kind_never_asks_for_flag(self, client, fake_sb, monkeypatch):
        monkeypatch.setattr("services.olympuslite_bridge.supports_flag",
                            lambda *a: pytest.fail("Olympus profiles must not probe for flag"))
        monkeypatch.setattr("services.olympus_bridge.fetch_telemetry",
                            lambda h, p, pw, res: {"ok": True, "data": {"airbases": {
                                "0": {"callsign": "Batumi", "latitude": 41.6, "longitude": 41.6}}}})
        monkeypatch.setattr("services.olympus_bridge.send_command", lambda *a: {"ok": True})
        login(monkeypatch, "admin1", "Admin")
        gid = client.post("/api/groups", json={"name": "G"}).get_json()["id"]
        pid = client.post(f"/api/groups/{gid}/profiles",
                          json={"name": "S", "olympusHost": "h"}).get_json()["id"]
        code, j = _fire(client, gid, pid, 9001)
        assert code == 200 and j["channel"] == "pair"
