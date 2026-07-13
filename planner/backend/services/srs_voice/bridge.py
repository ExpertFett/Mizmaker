"""SRS voice bridge — a per-WebSocket relay between a browser and an SRS server.

Dumb relay (the browser does Opus): the browser sends Opus frames (binary) +
control (JSON text) over the WebSocket; we wrap each frame in an SRS UDP voice
packet and forward inbound SRS voice on the tuned frequency back to the browser
as raw Opus frames. All wire framing comes from `protocol` — there is no Opus /
audio dependency in this process.

Runs inside the flask-sock handler greenlet (gunicorn `-k gevent`). Spawns
gevent greenlets for the UDP receive + keep-alives; the handler greenlet itself
pumps browser → SRS. Verified WS-through-gevent works (Phase-1 spike).

The browser never sees the SRS server address or the EAM password — the bridge
holds those and the browser only ever talks to us.
"""
from __future__ import annotations

import json
import socket
import time
from typing import Any, Callable, Dict, List, Optional

import gevent

from . import protocol as P

FREQ_MATCH_HZ = 100.0   # treat freqs within 100 Hz as "the same channel"


def run_bridge(
    ws,
    *,
    host: str,
    port: int,
    coalition: int,
    password: str,
    name: str,
    freq_hz: float,
    modulation: int,
    unit_id: int,
    log: Optional[Callable[[str], None]] = None,
) -> None:
    """Block for the lifetime of one browser WebSocket, relaying voice to/from
    the SRS server via External-AWACS Mode. Returns when the WS closes."""
    def _log(m: str) -> None:
        if log:
            try:
                log(m)
            except Exception:
                pass

    def _status(**kw: Any) -> None:
        try:
            ws.send(json.dumps({"type": "status", **kw}))
        except Exception:
            pass

    guid = P.short_guid()
    client = P.make_client(
        guid=guid, name=name, coalition=coalition,
        freq_hz=freq_hz, modulation=modulation, unit_id=unit_id,
    )
    # Single-writer flags (each mutated from exactly one greenlet).
    state: Dict[str, Any] = {"freq": freq_hz, "mod": modulation, "ptt": False, "pkt": 0, "alive": True}

    tcp: Optional[socket.socket] = None
    udp: Optional[socket.socket] = None
    greenlets: List[gevent.Greenlet] = []

    try:
        # 1) TCP control + EAM handshake ---------------------------------------
        try:
            tcp = socket.create_connection((host, port), timeout=8.0)
        except OSError as e:
            _status(state="error", error=f"Can't reach the SRS server at {host}:{port} ({e}).")
            return
        tcp.sendall(P.sync_message(client))
        tcp.sendall(P.eam_password_message(client, password))
        assigned = _await_eam(tcp, timeout=8.0)
        if assigned == -2:
            _status(state="error", error="SRS version mismatch — update CLIENT_VERSION in protocol.py.")
            return
        if assigned <= 0:
            _status(state="error", error="SRS rejected External-AWACS login (bad password or EAM disabled).")
            return
        client["Coalition"] = assigned

        # 2) UDP voice endpoint ----------------------------------------------
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp.connect((host, port))
        udp.send(P.ping_packet(guid))
        _status(state="connected", coalition=assigned)
        _log(f"SRS bridge up: {name} coalition={assigned} freq={freq_hz/1e6:.3f}")

        # 3) Concurrent pumps -------------------------------------------------
        def udp_rx() -> None:
            assert udp is not None
            udp.settimeout(1.0)
            while state["alive"]:
                try:
                    data, _ = udp.recvfrom(65536)
                except socket.timeout:
                    continue
                except OSError:
                    return
                pkt = P.decode_voice_packet(data)
                if not pkt or not pkt.get("audio"):
                    continue
                if pkt.get("guid") == guid:
                    continue  # our own transmission echoed back
                tuned = state["freq"]
                if any(abs(f - tuned) < FREQ_MATCH_HZ for f in pkt["frequencies"]):
                    try:
                        ws.send(pkt["audio"])  # raw Opus frame → browser decodes
                    except Exception:
                        return

        def udp_ping() -> None:
            assert udp is not None
            while state["alive"]:
                try:
                    udp.send(P.ping_packet(guid))
                except OSError:
                    return
                gevent.sleep(5.0)

        def tcp_keep() -> None:
            assert tcp is not None
            tcp.settimeout(2.0)
            buf = b""
            last = time.time()
            while state["alive"]:
                try:
                    chunk = tcp.recv(65536)
                    if not chunk:
                        return
                    buf += chunk
                    _msgs, buf = P.iter_tcp_messages(buf)
                except socket.timeout:
                    pass
                except OSError:
                    return
                if time.time() - last > 55:
                    try:
                        tcp.sendall(P.radio_update_message(client))
                        last = time.time()
                    except OSError:
                        return

        greenlets = [gevent.spawn(udp_rx), gevent.spawn(udp_ping), gevent.spawn(tcp_keep)]

        # 4) Browser → SRS (this greenlet) -----------------------------------
        while state["alive"]:
            msg = ws.receive()
            if msg is None:
                break
            if isinstance(msg, (bytes, bytearray)):
                if not state["ptt"] or not msg:
                    continue
                state["pkt"] += 1
                packet = P.encode_voice_packet(
                    audio=bytes(msg),
                    frequencies=[state["freq"]],
                    modulations=[state["mod"]],
                    unit_id=unit_id,
                    packet_number=state["pkt"],
                    guid=guid,
                    original_guid=guid,
                )
                try:
                    udp.send(packet)
                except OSError:
                    break
            else:
                _handle_control(str(msg), state, client, tcp)
    finally:
        state["alive"] = False
        if greenlets:
            gevent.killall(greenlets, block=False)
        if tcp is not None:
            try:
                tcp.sendall(P.disconnect_message(client))
            except Exception:
                pass
            try:
                tcp.close()
            except Exception:
                pass
        if udp is not None:
            try:
                udp.close()
            except Exception:
                pass
        _log("SRS bridge closed")


def run_loopback(ws) -> None:
    """Self-test path: echo the browser's own Opus frames back to it without
    touching SRS. Exercises the entire browser audio pipeline (mic → encode →
    WS → decode → playback) so it can be validated with no SRS server. The
    browser only sends frames while PTT is held, so the user hears themselves
    when they key up — a "radio check". Control messages are ignored."""
    try:
        ws.send(json.dumps({"type": "status", "state": "connected", "loopback": True}))
    except Exception:
        return
    while True:
        msg = ws.receive()
        if msg is None:
            return
        if isinstance(msg, (bytes, bytearray)) and msg:
            try:
                ws.send(bytes(msg))
            except Exception:
                return


def _handle_control(text: str, state: Dict[str, Any], client: Dict[str, Any], tcp: socket.socket) -> None:
    try:
        m = json.loads(text)
    except (ValueError, TypeError):
        return
    t = m.get("type")
    if t == "ptt":
        state["ptt"] = bool(m.get("on"))
    elif t == "tune":
        if "freq" in m:
            state["freq"] = float(m["freq"])
        if "mod" in m:
            state["mod"] = int(m["mod"])
        # Retune our radio so the server routes RX for the new channel to us.
        client["RadioInfo"]["radios"][1] = P.make_radio(state["freq"], state["mod"], "RADIO 1")
        try:
            tcp.sendall(P.radio_update_message(client))
        except OSError:
            pass


def _await_eam(tcp: socket.socket, timeout: float) -> int:
    """Read the EAM handshake reply. Returns the assigned coalition (>0),
    0 = rejected/timeout, -2 = version mismatch."""
    tcp.settimeout(1.0)
    buf = b""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            chunk = tcp.recv(65536)
        except socket.timeout:
            continue
        if not chunk:
            return 0
        buf += chunk
        msgs, buf = P.iter_tcp_messages(buf)
        for msg in msgs:
            if msg.get("MsgType") == P.MSG_VERSION_MISMATCH:
                return -2
            if msg.get("MsgType") == P.MSG_EXTERNAL_AWACS_MODE_PASSWORD:
                return int((msg.get("Client") or {}).get("Coalition", 0))
    return 0
