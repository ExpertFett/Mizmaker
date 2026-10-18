"""Tests for the OlympusLite relay (services/olympuslite_bridge.py) and the
server-profile `kind` routing in services/groups.py.

A fake OlympusLite runs on a real local socket (http.server in a thread) and
speaks the README API: /health, /units, /airbases, POST /command, X-OLite-Key
auth with gm/blue/observer roles. It records every command body it receives."""

from __future__ import annotations

import json
import math
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from services import olympuslite_bridge as olb
from tests.test_groups import FakeSB, login  # noqa: F401  (fixture helpers)
from services import supabase_client, profile_crypto
import os

GM, BLUE, OBS = "gm-pw", "blue-pw", "obs-pw"

UNITS = [
    {"id": 101, "name": "SA6-1", "type": "Kub 1S91 str", "group": "SA6 Site", "groupId": 11,
     "coalition": "red", "category": "ground", "lat": 42.1, "lon": 41.1, "alt": 120,
     "heading": 90, "speed": 0.0, "life": 3.0, "life0": 4.0, "spawned": False},
    {"id": 202, "name": "Hornet-1", "type": "FA-18C_hornet", "group": "OLITE-Hornet", "groupId": 22,
     "coalition": "blue", "category": "air", "lat": 42.5, "lon": 41.6, "alt": 6000,
     "heading": 180, "speed": 200.0, "life": 1.0, "life0": 1.0, "player": None, "spawned": True},
    {"id": 303, "name": "Viper-1", "type": "F-16C_50", "group": "Viper", "groupId": 33,
     "coalition": "blue", "category": "air", "lat": 43.0, "lon": 42.0, "alt": 8000,
     "heading": 0, "speed": 250.0, "life": 0, "life0": 1.0, "player": "Fett", "spawned": False},
]
AIRBASES = [
    {"name": "Batumi", "id": 22, "coalition": "blue", "kind": "airdrome", "lat": 41.6, "lon": 41.6},
    {"name": "CVN-73", "id": 9, "coalition": "blue", "kind": "ship", "lat": 41.0, "lon": 40.0},
]


class FakeOlite:
    def __init__(self):
        self.commands: list = []
        self.unit_gets = 0
        self.redirect = False
        self.fail_command: str | None = None
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *_a):
                pass

            def _role(self):
                return {GM: "gm", BLUE: "blue", OBS: "observer"}.get(self.headers.get("X-OLite-Key"))

            def _send(self, code, obj, extra=None):
                body = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                for k, v in (extra or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if fake.redirect:
                    return self._send(302, {}, {"Location": "http://169.254.169.254/latest/meta-data"})
                if self.path == "/health":
                    return self._send(200, {"ok": True, "version": "0.1.0", "installed": True,
                                            "state": "server", "mission": "TEST.miz", "modelTime": 12.5})
                role = self._role()
                if not role:
                    return self._send(401, {"ok": False, "error": "missing or wrong password"})
                if self.path.startswith("/units"):
                    fake.unit_gets += 1
                    units = UNITS if role in ("gm", "observer") else [u for u in UNITS if u["coalition"] == role]
                    return self._send(200, {"time": 1, "units": units, "statics": [], "role": role})
                if self.path == "/airbases":
                    return self._send(200, AIRBASES)
                return self._send(404, {"ok": False, "error": "not found"})

            def do_POST(self):
                role = self._role()
                if not role:
                    return self._send(401, {"ok": False, "error": "missing or wrong password"})
                if role == "observer":
                    return self._send(403, {"ok": False, "error": "observers cannot send commands"})
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
                fake.commands.append(body)
                if fake.fail_command == body.get("command"):
                    return self._send(400, {"ok": False, "error": f"{body['command']} refused"})
                return self._send(200, {"ok": True, "echo": body.get("command")})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def fake():
    f = FakeOlite()
    olb._PICTURE.clear()
    yield f
    f.close()
    olb._PICTURE.clear()


@pytest.fixture
def fake_sb():
    sb = FakeSB()
    supabase_client.set_client(sb)
    os.environ["PROFILE_ENC_KEY"] = profile_crypto.gen_key()
    yield sb
    supabase_client.reset_client()
    os.environ.pop("PROFILE_ENC_KEY", None)


# --------------------------------------------------------------------------
# Picture mapping
# --------------------------------------------------------------------------
class TestMapping:
    def test_unit_shape_matches_decoder(self):
        m = olb.map_unit(UNITS[0])
        assert m["olympusID"] == 101 and m["unitName"] == "SA6-1" and m["name"] == "Kub 1S91 str"
        assert m["groupName"] == "SA6 Site" and m["category"] == "GroundUnit"
        assert m["coalition"] == 1 and m["alive"] == 1 and m["human"] == 0 and m["controlled"] == 0
        assert m["position"] == {"lat": 42.1, "lng": 41.1, "alt": 120}
        assert math.isclose(m["heading"], math.pi / 2) and m["health"] == 75

    def test_air_player_dead_spawned(self):
        hornet, viper = olb.map_unit(UNITS[1]), olb.map_unit(UNITS[2])
        assert hornet["category"] == "Aircraft" and hornet["coalition"] == 2 and hornet["controlled"] == 1
        assert viper["human"] == 1 and viper["alive"] == 0 and viper["callsign"] == "Fett"

    def test_airbases_shape(self):
        ab = olb.map_airbases(AIRBASES)["airbases"]
        assert ab["0"] == {"callsign": "Batumi", "unitId": 22, "coalition": "blue",
                           "latitude": 41.6, "longitude": 41.6, "kind": "airdrome"}
        assert len(ab) == 2


# --------------------------------------------------------------------------
# Telemetry + Test Connection against the fake server
# --------------------------------------------------------------------------
class TestTelemetry:
    def test_units(self, fake):
        r = olb.fetch_telemetry("127.0.0.1", fake.port, GM, "units")
        assert r["ok"] and [u["olympusID"] for u in r["data"]] == [101, 202, 303]

    def test_commander_sees_own_side(self, fake):
        r = olb.fetch_telemetry("127.0.0.1", fake.port, BLUE, "units")
        assert {u["coalition"] for u in r["data"]} == {2}

    def test_airbases_and_mission(self, fake):
        ab = olb.fetch_telemetry("127.0.0.1", fake.port, GM, "airbases")
        assert ab["ok"] and ab["data"]["airbases"]["1"]["callsign"] == "CVN-73"
        ms = olb.fetch_telemetry("127.0.0.1", fake.port, GM, "mission")
        assert ms["ok"] and ms["data"]["backend"] == "olympuslite" and ms["data"]["mission"] == "TEST.miz"

    def test_unserved_resources_empty(self, fake):
        assert olb.fetch_telemetry("127.0.0.1", fake.port, GM, "bullseye") == {"ok": True, "data": {}}
        assert not olb.fetch_telemetry("127.0.0.1", fake.port, GM, "nope")["ok"]

    def test_bad_password(self, fake):
        r = olb.fetch_telemetry("127.0.0.1", fake.port, "wrong", "units")
        assert not r["ok"] and "password" in r["error"]

    def test_status_check(self, fake):
        assert olb.status_check("127.0.0.1", fake.port, GM) == {"ok": True, "reachable": True, "authOk": True}
        bad = olb.status_check("127.0.0.1", fake.port, "wrong")
        assert bad["reachable"] and bad["authOk"] is False

    def test_unreachable(self):
        r = olb.status_check("127.0.0.1", 1, GM)
        assert r["ok"] is False and r["reachable"] is False

    def test_redirect_not_followed(self, fake):
        fake.redirect = True
        r = olb.fetch_telemetry("127.0.0.1", fake.port, GM, "mission")
        assert not r["ok"] and "302" in r["error"]

    @pytest.mark.parametrize("host", ["http://127.0.0.1", "127.0.0.1/x", "a@b", "h:80", "..", ""])
    def test_bad_host_rejected(self, host):
        assert not olb.fetch_telemetry(host, 4513, GM, "units")["ok"]
        with pytest.raises(ValueError):
            olb.olite_request(host or "", 4513, GM, "GET", "units")

    def test_only_fixed_paths(self):
        with pytest.raises(ValueError):
            olb.olite_request("127.0.0.1", 4513, GM, "GET", "../admin")


# --------------------------------------------------------------------------
# Command translation (pure)
# --------------------------------------------------------------------------
_BY_ID = {u["id"]: u for u in UNITS}


def tr(cmd, params):
    return olb.translate(cmd, params, _BY_ID.get)


class TestTranslate:
    def test_spawn_ground_spreads_units(self):
        [b] = tr("spawnGroundUnits", {"coalition": "red", "units": [
            {"unitType": "Kub 1S91 str", "location": {"lat": 42.0, "lng": 41.0}, "skill": "High", "liveryID": ""},
            {"unitType": "Kub 1S91 str", "location": {"lat": 42.0, "lng": 41.0}, "skill": "High", "liveryID": ""},
        ], "country": "", "immediate": False, "spawnPoints": 0})
        assert b["command"] == "spawn" and b["category"] == "ground" and b["coalition"] == "red"
        assert b["name"] == "Kub 1S91 str" and len(b["units"]) == 2
        u0, u1 = b["units"]
        assert u0 == {"type": "Kub 1S91 str", "lat": 42.0, "lon": 41.0, "skill": "High"}
        assert u1["lat"] == 42.0 and u1["lon"] > 41.0  # offset east, not stacked

    def test_spawn_air_altitude_and_livery(self):
        [b] = tr("spawnAircrafts", {"coalition": "blue", "airbaseName": "", "units": [
            {"unitType": "FA-18C_hornet", "location": {"lat": 42, "lng": 41}, "skill": "Excellent",
             "liveryID": "VFA-37", "altitude": 6096, "loadout": ""}]})
        assert b["category"] == "air" and b["units"][0]["alt"] == 6096 and b["units"][0]["livery"] == "VFA-37"
        assert b["altType"] == "asl"

    def test_spawn_helo_navy_categories(self):
        assert tr("spawnHelicopters", {"coalition": "blue", "units": [
            {"unitType": "AH-64D_BLK_II", "location": {"lat": 1, "lng": 2}}]})[0]["category"] == "helicopter"
        assert tr("spawnNavyUnits", {"coalition": "neutral", "units": [
            {"unitType": "CVN_73", "location": {"lat": 1, "lng": 2}}]})[0]["category"] == "ship"

    @pytest.mark.parametrize("params", [
        {"coalition": "purple", "units": [{"unitType": "x", "location": {"lat": 1, "lng": 1}}]},
        {"coalition": "red", "units": []},
        {"coalition": "red", "units": [{"unitType": "x", "location": {"lat": 95, "lng": 1}}]},
        {"coalition": "red", "units": [{"location": {"lat": 1, "lng": 1}}]},
    ])
    def test_spawn_validation(self, params):
        with pytest.raises(ValueError):
            tr("spawnGroundUnits", params)

    def test_move(self):
        assert tr("setPath", {"ID": 101, "path": [{"lat": 1, "lng": 2}, {"lat": 42.3, "lng": 41.4}]}) == [
            {"command": "move", "group": "SA6 Site", "lat": 42.3, "lon": 41.4}]

    def test_delete_and_delete_with_explosion(self):
        assert tr("deleteUnit", {"ID": 202, "explosion": False, "explosionType": "", "immediate": True}) == [
            {"command": "delete", "unit": "Hornet-1"}]
        boom = tr("deleteUnit", {"ID": 101, "explosion": True})
        assert [b["command"] for b in boom] == ["delete", "explosion"]

    @pytest.mark.parametrize("cmd,params,expect", [
        ("setROE", {"ROE": 1}, {"roe": "free"}),
        ("setROE", {"ROE": 4}, {"roe": "hold"}),
        ("setAlarmState", {"alarmState": 0}, {"alarm": "auto"}),
        ("setAlarmState", {"alarmState": 1}, {"alarm": "green"}),
        ("setAlarmState", {"alarmState": 2}, {"alarm": "red"}),
        ("setEmissionsCountermeasures", {"emissionsCountermeasures": 0}, {"emission": False}),
        ("setEmissionsCountermeasures", {"emissionsCountermeasures": 3}, {"emission": True}),
        ("setReactionToThreat", {"reactionToThreat": 2}, {"reaction": "passive"}),
    ])
    def test_options(self, cmd, params, expect):
        assert tr(cmd, {"ID": 101, **params}) == [{"command": "options", "group": "SA6 Site", **expect}]

    @pytest.mark.parametrize("cmd,params", [
        ("setROE", {"ROE": 9}), ("setAlarmState", {"alarmState": 5}),
        ("setEmissionsCountermeasures", {"emissionsCountermeasures": "x"}),
    ])
    def test_option_range(self, cmd, params):
        with pytest.raises(ValueError):
            tr(cmd, {"ID": 101, **params})

    def test_smoke_and_explosion(self):
        assert tr("smoke", {"color": "orange", "location": {"lat": 42, "lng": 41}}) == [
            {"command": "smoke", "lat": 42, "lon": 41, "color": "orange"}]
        assert tr("smoke", {"color": "purple", "location": {"lat": 42, "lng": 41}})[0]["color"] == "red"
        [e] = tr("explosion", {"explosionType": "napalm", "intensity": 50, "location": {"lat": 42, "lng": 41}})
        assert e == {"command": "explosion", "lat": 42, "lon": 41, "power": 100}

    def test_unknown_unit_and_unsupported(self):
        with pytest.raises(ValueError, match="live picture"):
            tr("setROE", {"ID": 999, "ROE": 1})
        with pytest.raises(ValueError, match="isn't supported"):
            tr("attackUnit", {"ID": 101, "targetID": 202})
        with pytest.raises(ValueError, match="isn't supported"):
            tr("setAltitude", {"ID": 202, "altitude": 3000})


# --------------------------------------------------------------------------
# send_command end to end against the fake
# --------------------------------------------------------------------------
class TestSendCommand:
    def test_resolves_id_from_live_picture(self, fake):
        r = olb.send_command("127.0.0.1", fake.port, GM, "setROE", {"ID": 101, "ROE": 4})
        assert r["ok"], r
        assert fake.commands == [{"command": "options", "group": "SA6 Site", "roe": "hold"}]

    def test_uses_cached_picture(self, fake):
        olb.fetch_telemetry("127.0.0.1", fake.port, GM, "units")
        before = fake.unit_gets
        olb.send_command("127.0.0.1", fake.port, GM, "setPath", {"ID": 202, "path": [{"lat": 1, "lng": 2}]})
        assert fake.unit_gets == before and fake.commands[-1]["group"] == "OLITE-Hornet"

    def test_spawn_posts_one_body(self, fake):
        r = olb.send_command("127.0.0.1", fake.port, GM, "spawnGroundUnits", {"coalition": "red", "units": [
            {"unitType": "T-72B", "location": {"lat": 42, "lng": 41}}]})
        assert r["ok"] and fake.commands[0]["command"] == "spawn"

    def test_server_error_surfaced(self, fake):
        fake.fail_command = "smoke"
        r = olb.send_command("127.0.0.1", fake.port, GM, "smoke", {"location": {"lat": 1, "lng": 2}})
        assert r == {"ok": False, "error": "OlympusLite: smoke refused"}

    def test_failed_explosion_after_delete_still_ok(self, fake):
        fake.fail_command = "explosion"
        r = olb.send_command("127.0.0.1", fake.port, GM, "deleteUnit", {"ID": 101, "explosion": True})
        assert r["ok"] and [c["command"] for c in fake.commands] == ["delete", "explosion"]

    def test_observer_rejected(self, fake):
        r = olb.send_command("127.0.0.1", fake.port, OBS, "smoke", {"location": {"lat": 1, "lng": 2}})
        assert not r["ok"] and "password" in r["error"]

    def test_unsupported_never_hits_server(self, fake):
        r = olb.send_command("127.0.0.1", fake.port, GM, "setOnOff", {"ID": 101, "onOff": False})
        assert not r["ok"] and fake.commands == []


# --------------------------------------------------------------------------
# Unit database (pydcs-built)
# --------------------------------------------------------------------------
class TestUnitDatabase:
    def test_ground_buckets(self):
        db = olb.fetch_unit_database("", 0, "", "groundunit")["data"]
        assert db["Kub 1S91 str"]["type"] == "SAM Site"
        assert db["ZSU-23-4 Shilka"]["type"] == "AAA"
        assert db["1L13 EWR"]["type"] == "Radar (EWR)"
        assert db["ZSU-23-4 Shilka"]["engagementRange"] == 2500

    def test_air_and_unknown(self):
        assert "FA-18C_hornet" in olb.fetch_unit_database("", 0, "", "aircraft")["data"]
        assert not olb.fetch_unit_database("", 0, "", "bogus")["ok"]


# --------------------------------------------------------------------------
# groups.py: profile kind + routing
# --------------------------------------------------------------------------
class TestProfileKind:
    def _group(self, client, monkeypatch):
        login(monkeypatch, "admin1", "Admin")
        return client.post("/api/groups", json={"name": "G"}).get_json()["id"]

    def _lite(self, client, gid, port):
        return client.post(f"/api/groups/{gid}/profiles", json={
            "name": "Lite", "kind": "olympuslite", "olympusHost": "127.0.0.1",
            "olympusPort": port, "olympusPassword": GM}).get_json()["id"]

    def test_olympus_default_writes_no_kind_column(self, client, fake_sb, monkeypatch):
        gid = self._group(client, monkeypatch)
        client.post(f"/api/groups/{gid}/profiles", json={"name": "Main", "olympusHost": "h"})
        row = fake_sb.tables["server_profiles"][0]
        assert "kind" not in row and row["olympus_port"] == 4512  # pre-migration safe
        p = client.get(f"/api/groups/{gid}/profiles").get_json()["profiles"][0]
        assert p["kind"] == "olympus"

    def test_olympuslite_kind_and_default_port(self, client, fake_sb, monkeypatch):
        gid = self._group(client, monkeypatch)
        client.post(f"/api/groups/{gid}/profiles", json={"name": "L", "kind": "olympuslite", "olympusHost": "h"})
        row = fake_sb.tables["server_profiles"][0]
        assert row["kind"] == "olympuslite" and row["olympus_port"] == 4513
        p = client.get(f"/api/groups/{gid}/profiles").get_json()["profiles"][0]
        assert p["kind"] == "olympuslite" and "olympus_password_enc" not in p

    def test_bad_kind_400(self, client, fake_sb, monkeypatch):
        gid = self._group(client, monkeypatch)
        r = client.post(f"/api/groups/{gid}/profiles", json={"name": "X", "kind": "evil"})
        assert r.status_code == 400
        pid = client.post(f"/api/groups/{gid}/profiles", json={"name": "Y"}).get_json()["id"]
        assert client.patch(f"/api/groups/{gid}/profiles/{pid}", json={"kind": "evil"}).status_code == 400

    def test_patch_kind(self, client, fake_sb, monkeypatch):
        gid = self._group(client, monkeypatch)
        pid = client.post(f"/api/groups/{gid}/profiles", json={"name": "Y"}).get_json()["id"]
        # Setting the default on a pre-migration row doesn't reference the column.
        client.patch(f"/api/groups/{gid}/profiles/{pid}", json={"kind": "olympus"})
        assert "kind" not in fake_sb.tables["server_profiles"][0]
        client.patch(f"/api/groups/{gid}/profiles/{pid}", json={"kind": "olympuslite"})
        assert fake_sb.tables["server_profiles"][0]["kind"] == "olympuslite"
        client.patch(f"/api/groups/{gid}/profiles/{pid}", json={"kind": "olympus"})
        assert fake_sb.tables["server_profiles"][0]["kind"] == "olympus"

    def test_telemetry_routes_to_olympuslite(self, client, fake_sb, fake, monkeypatch):
        gid = self._group(client, monkeypatch)
        pid = self._lite(client, gid, fake.port)
        monkeypatch.setattr("services.olympus_bridge.fetch_telemetry",
                            lambda *a: pytest.fail("Olympus bridge used for an OlympusLite profile"))
        r = client.get(f"/api/groups/{gid}/profiles/{pid}/telemetry/units")
        assert r.status_code == 200
        assert [u["olympusID"] for u in r.get_json()["data"]] == [101, 202, 303]

    def test_test_connection_and_command(self, client, fake_sb, fake, monkeypatch):
        gid = self._group(client, monkeypatch)
        pid = self._lite(client, gid, fake.port)
        assert client.post(f"/api/groups/{gid}/profiles/{pid}/test").get_json()["authOk"] is True
        r = client.post(f"/api/groups/{gid}/profiles/{pid}/command",
                        json={"command": "setAlarmState", "params": {"ID": 101, "alarmState": 1}})
        assert r.status_code == 200 and r.get_json()["ok"]
        assert fake.commands[-1] == {"command": "options", "group": "SA6 Site", "alarm": "green"}

    def test_command_role_gate_still_applies(self, client, fake_sb, fake, monkeypatch):
        gid = self._group(client, monkeypatch)
        pid = self._lite(client, gid, fake.port)
        code = client.post(f"/api/groups/{gid}/invites", json={}).get_json()["code"]
        login(monkeypatch, "op1")
        client.post("/api/groups/join", json={"code": code})
        r = client.post(f"/api/groups/{gid}/profiles/{pid}/command",
                        json={"command": "smoke", "params": {"location": {"lat": 1, "lng": 2}}})
        assert r.status_code == 403 and fake.commands == []

    def test_database_and_image(self, client, fake_sb, fake, monkeypatch):
        gid = self._group(client, monkeypatch)
        pid = self._lite(client, gid, fake.port)
        r = client.get(f"/api/groups/{gid}/profiles/{pid}/database/groundunit")
        assert r.status_code == 200 and "T-72B" in r.get_json()["data"]
        assert client.get(f"/api/groups/{gid}/profiles/{pid}/unit-image/a.png").status_code == 502

    def test_no_request_supplied_host(self, client, fake_sb, fake, monkeypatch):
        """The relay only reaches the stored profile host; body/query can't redirect it."""
        gid = self._group(client, monkeypatch)
        pid = self._lite(client, gid, fake.port)
        seen = {}
        real = olb.olite_request

        def spy(host, port, *a, **k):
            seen.setdefault("hosts", set()).add((host, port))
            return real(host, port, *a, **k)

        monkeypatch.setattr(olb, "olite_request", spy)
        client.post(f"/api/groups/{gid}/profiles/{pid}/command?host=evil.example",
                    json={"command": "smoke", "host": "evil.example", "olympusHost": "evil.example",
                          "params": {"location": {"lat": 1, "lng": 2}, "host": "evil.example"}})
        assert seen["hosts"] == {("127.0.0.1", fake.port)}
