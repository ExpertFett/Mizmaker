"""SRS Phase-0 spike — prove we can connect (External AWACS Mode), RECEIVE voice,
and (optionally) TRANSMIT a test tone against a REAL SRS server, with no DCS and
no web stack. Pure stdlib for RX; Opus (opuslib) only needed to TX a tone.

This is the gate for the whole feature: if this hears a pilot and a pilot hears
the tone, the protocol port is correct and Phase 1 (WS + bridge) can proceed.

Run (from planner/backend):
    python -m services.srs_voice.spike --host SRS_HOST --password EAM_PASS \\
        --coalition blue --freq 251.0 --mod AM --listen 30
    # add --transmit to also send a 1 kHz tone for ~3 s (needs opuslib)

Coalition passwords + EAM must be enabled on the SRS server. UDP+TCP on --port
(default 5002) must be reachable from this machine.
"""
from __future__ import annotations

import argparse
import math
import socket
import struct
import threading
import time

from . import protocol as P

try:
    import opuslib  # type: ignore
    _HAVE_OPUS = True
except Exception:
    _HAVE_OPUS = False


def _coalition_int(s: str) -> int:
    return {"red": 1, "blue": 2, "spectator": 0}.get(s.lower(), 2)


def _connect_tcp(host: str, port: int, client: dict, password: str, timeout: float = 8.0) -> int:
    """SYNC + EAM password handshake. Returns the assigned coalition (0 = rejected)."""
    s = socket.create_connection((host, port), timeout=timeout)
    s.sendall(P.sync_message(client))
    s.sendall(P.eam_password_message(client, password))
    buf = b""
    deadline = time.time() + timeout
    coalition = -1
    s.settimeout(1.0)
    while time.time() < deadline:
        try:
            chunk = s.recv(65536)
        except socket.timeout:
            continue
        if not chunk:
            break
        buf += chunk
        msgs, buf = P.iter_tcp_messages(buf)
        for m in msgs:
            mt = m.get("MsgType")
            if mt == P.MSG_VERSION_MISMATCH:
                print("  !! server: VERSION_MISMATCH — bump CLIENT_VERSION in protocol.py")
            if mt == P.MSG_EXTERNAL_AWACS_MODE_PASSWORD:
                coalition = int((m.get("Client") or {}).get("Coalition", 0))
                break
        if coalition >= 0:
            break
    # keep the TCP socket open in a background keepalive reader (server pings)
    threading.Thread(target=_tcp_keepalive, args=(s, client), daemon=True).start()
    return coalition


def _tcp_keepalive(s: socket.socket, client: dict) -> None:
    buf = b""
    s.settimeout(2.0)
    last_update = time.time()
    while True:
        try:
            chunk = s.recv(65536)
            if not chunk:
                return
            buf += chunk
            _msgs, buf = P.iter_tcp_messages(buf)
        except socket.timeout:
            pass
        except OSError:
            return
        if time.time() - last_update > 60:
            try:
                s.sendall(P.radio_update_message(client))
                last_update = time.time()
            except OSError:
                return


def _rx_loop(udp: socket.socket, want_freq_hz: float, stop: threading.Event, stats: dict) -> None:
    udp.settimeout(1.0)
    while not stop.is_set():
        try:
            data, _ = udp.recvfrom(65536)
        except socket.timeout:
            continue
        except OSError:
            return
        pkt = P.decode_voice_packet(data)
        if pkt is None:
            continue  # ping/echo
        stats["packets"] += 1
        stats["bytes"] += len(pkt["audio"])
        on_freq = any(abs(f - want_freq_hz) < 100 for f in pkt["frequencies"])
        tag = "  RX" if on_freq else "  rx(other freq)"
        print(f"{tag}: {len(pkt['audio'])}B opus  freqs={[round(f/1e6,3) for f in pkt['frequencies']]}MHz "
              f"from {pkt['guid'][:8]}  (#{stats['packets']})")


def _tone_opus_frames(seconds: float, freq_hz: float = 1000.0):
    """Yield Opus frames of a sine tone at SRS settings (16 kHz mono, 40 ms)."""
    enc = opuslib.Encoder(P.SAMPLE_RATE, P.CHANNELS, application="voip")
    n_frames = int(seconds * 1000 / P.FRAME_MS)
    phase = 0.0
    step = 2 * math.pi * freq_hz / P.SAMPLE_RATE
    for _ in range(n_frames):
        pcm = bytearray()
        for _i in range(P.FRAME_SAMPLES):
            pcm += struct.pack("<h", int(0.5 * 32767 * math.sin(phase)))
            phase += step
        yield enc.encode(bytes(pcm), P.FRAME_SAMPLES)


def main() -> None:
    ap = argparse.ArgumentParser(description="SRS External-AWACS-Mode connectivity spike")
    ap.add_argument("--host", required=True)
    ap.add_argument("--port", type=int, default=P.DEFAULT_PORT)
    ap.add_argument("--password", default="", help="EAM coalition password")
    ap.add_argument("--coalition", default="blue", choices=["red", "blue", "spectator"])
    ap.add_argument("--name", default="OPT-DM")
    ap.add_argument("--freq", type=float, default=251.0, help="MHz")
    ap.add_argument("--mod", default="AM", choices=["AM", "FM"])
    ap.add_argument("--listen", type=float, default=30.0, help="seconds to listen")
    ap.add_argument("--transmit", action="store_true", help="also send a 1 kHz tone (needs opuslib)")
    args = ap.parse_args()

    freq_hz = args.freq * 1e6
    mod = P.MOD_AM if args.mod == "AM" else P.MOD_FM
    guid = P.short_guid()
    unit_id = 100000000 + (int(time.time()) % 1000)
    client = P.make_client(guid=guid, name=args.name, coalition=_coalition_int(args.coalition),
                           freq_hz=freq_hz, modulation=mod, unit_id=unit_id)

    print(f"== SRS spike → {args.host}:{args.port}  guid={guid[:8]}  freq={args.freq} {args.mod} ==")
    print("[1] TCP connect + EAM handshake…")
    coalition = _connect_tcp(args.host, args.port, client, args.password)
    if coalition <= 0:
        print(f"  !! EAM rejected (coalition={coalition}). Check the password / EAM enabled.")
        return
    print(f"  OK — accepted as coalition {coalition} ({'red' if coalition==1 else 'blue'})")

    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp.connect((args.host, args.port))
    udp.send(P.ping_packet(guid))   # register UDP endpoint immediately
    print("[2] UDP open + ping sent. Listening for voice on the tuned freq…")

    stop = threading.Event()
    stats = {"packets": 0, "bytes": 0}
    threading.Thread(target=_rx_loop, args=(udp, freq_hz, stop, stats), daemon=True).start()

    t0 = time.time()
    pkt_no = 0
    while time.time() - t0 < args.listen:
        udp.send(P.ping_packet(guid))   # keep-alive (15 s is enough; we spam lightly)
        if args.transmit:
            if not _HAVE_OPUS:
                print("  -- --transmit needs opuslib (pip install opuslib + a libopus shared lib); skipping TX")
                args.transmit = False
            else:
                print("  TX: sending ~3 s of 1 kHz tone on the freq — a pilot tuned here should hear it")
                for frame in _tone_opus_frames(3.0):
                    pkt_no += 1
                    udp.send(P.encode_voice_packet(
                        audio=frame, frequencies=[freq_hz], modulations=[mod],
                        unit_id=unit_id, packet_number=pkt_no, guid=guid, original_guid=guid))
                    time.sleep(P.FRAME_MS / 1000.0)
                args.transmit = False  # once
        time.sleep(2.0)

    stop.set()
    print(f"== done. RX: {stats['packets']} voice packets, {stats['bytes']} opus bytes. "
          f"{'HEARD voice ✅' if stats['packets'] else 'no voice received (was anyone talking on the freq?)'} ==")


if __name__ == "__main__":
    main()
