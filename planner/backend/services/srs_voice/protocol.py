"""SRS wire protocol — pure, I/O-free, no Opus dependency.

Ported byte-for-byte from DCS-SimpleRadioStandalone (ciribob), `Common/Models/
UDPVoicePacket.cs` + `NetworkMessage.cs` + the External-Audio (DCS-less) client.
The packet's audio payload is opaque Opus bytes here — encode/decode of the
*packet* needs no codec, so this module is fully unit-testable without libopus.

Verified against the SRS source:
  - Audio: 16 kHz mono, 40 ms Opus frames (640 samples). (Constants.MIC_*)
  - TCP control: newline-terminated UTF-8 JSON NetworkMessage objects.
  - EAM: send SYNC(Client) then EXTERNAL_AWACS_MODE_PASSWORD(Client, password);
    the server replies EXTERNAL_AWACS_MODE_PASSWORD — Coalition==0 = rejected,
    else the returned Coalition is our assigned side.
  - UDP voice: same host:port as TCP. Keep-alive = the 22-byte ASCII GUID every
    15 s; inbound datagrams of exactly 22 bytes are pings, >22 are voice.
  - GUID = ShortGuid (22 chars).

NOTE: confirm the SRS server's actual version in the Phase 0 spike — these wire
details have shifted across releases.
"""
from __future__ import annotations

import base64
import json
import struct
import uuid
from typing import Any, Dict, List, Optional, Tuple

# --- audio / codec constants (the bridge uses these; here for one source of truth)
SAMPLE_RATE = 16000          # SRS voice is 16 kHz mono on the wire
CHANNELS = 1
FRAME_MS = 40
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000   # 640 samples / Opus frame

# --- packet constants (UDPVoicePacket.cs)
GUID_LENGTH = 22
PACKET_HEADER_LENGTH = 6          # 3 x ushort
FREQ_SEGMENT_LENGTH = 10          # double freq + modulation byte + encryption byte
# fixed tail = unitId(4) + packetNumber(8) + retransmission(1) + origGuid(22) + guid(22)
FIXED_TAIL_LENGTH = 4 + 8 + 1 + GUID_LENGTH + GUID_LENGTH   # 57

DEFAULT_PORT = 5002

# Modulation enum (Common/Models/Player/Modulation.cs)
MOD_AM = 0
MOD_FM = 1
MOD_INTERCOM = 2
MOD_DISABLED = 3

# NetworkMessage.MessageType
MSG_UPDATE = 0
MSG_PING = 1
MSG_SYNC = 2
MSG_RADIO_UPDATE = 3
MSG_SERVER_SETTINGS = 4
MSG_CLIENT_DISCONNECT = 5
MSG_VERSION_MISMATCH = 6
MSG_EXTERNAL_AWACS_MODE_PASSWORD = 7
MSG_EXTERNAL_AWACS_MODE_DISCONNECT = 8

# Mirrors the SRS client version it advertises; the server gates on this. Bump
# to match the squadron's server if it rejects on VERSION_MISMATCH.
CLIENT_VERSION = "2.2.0.2"


# --------------------------------------------------------------------------
# Identity
# --------------------------------------------------------------------------
def short_guid() -> str:
    """SRS ShortGuid: standard base64 of the 16 GUID bytes with +/→-_ and the
    trailing '==' dropped, giving a 22-char string."""
    b = uuid.uuid4().bytes
    s = base64.b64encode(b).decode("ascii")
    return s.replace("+", "-").replace("/", "_")[:GUID_LENGTH]


# --------------------------------------------------------------------------
# TCP control messages (newline-terminated JSON)
# --------------------------------------------------------------------------
def make_radio(freq_hz: float, modulation: int, name: str = "RADIO") -> Dict[str, Any]:
    return {
        "enc": False,
        "encKey": 0,
        "freq": float(freq_hz),
        "modulation": int(modulation),
        "retransmit": False,
        "secFreq": 1.0,
        "name": name,
    }


def make_client(
    *,
    guid: str,
    name: str,
    coalition: int,
    freq_hz: float,
    modulation: int,
    unit_id: int,
    lat: float = 0.0,
    lng: float = 0.0,
    alt: float = 0.0,
) -> Dict[str, Any]:
    """An SRClientBase with a single tuned radio in slot 1 (slot 0 = intercom).

    The radios list is 11 wide (intercom + 10) to match MAX_RADIOS; unused slots
    are DISABLED so the server doesn't route stray traffic to them."""
    radios: List[Dict[str, Any]] = [
        make_radio(100.0, MOD_INTERCOM, "INTERCOM"),
        make_radio(freq_hz, modulation, "RADIO 1"),
    ]
    while len(radios) < 11:
        radios.append(make_radio(1.0, MOD_DISABLED, ""))
    return {
        "ClientGuid": guid,
        "Name": name,
        "Coalition": int(coalition),
        "Seat": 0,
        "AllowRecord": False,
        "LatLngPosition": {"lat": lat, "lng": lng, "alt": alt},
        "RadioInfo": {
            "unit": name,
            "unitId": int(unit_id),
            "radios": radios,
            "selected": 1,
            "simultaneousTransmission": False,
        },
    }


def _encode_message(msg: Dict[str, Any]) -> bytes:
    """NetworkMessage → newline-terminated UTF-8 (SRS framing)."""
    msg.setdefault("Version", CLIENT_VERSION)
    return (json.dumps(msg, separators=(",", ":")) + "\n").encode("utf-8")


def sync_message(client: Dict[str, Any]) -> bytes:
    return _encode_message({"Client": client, "MsgType": MSG_SYNC})


def eam_password_message(client: Dict[str, Any], password: str) -> bytes:
    return _encode_message({
        "Client": client,
        "MsgType": MSG_EXTERNAL_AWACS_MODE_PASSWORD,
        "ExternalAWACSModePassword": password,
    })


def radio_update_message(client: Dict[str, Any]) -> bytes:
    return _encode_message({"Client": client, "MsgType": MSG_RADIO_UPDATE})


def disconnect_message(client: Dict[str, Any]) -> bytes:
    return _encode_message({"Client": client, "MsgType": MSG_EXTERNAL_AWACS_MODE_DISCONNECT})


def iter_tcp_messages(buffer: bytes) -> Tuple[List[Dict[str, Any]], bytes]:
    """Split a TCP read buffer into complete newline-delimited JSON messages.
    Returns (parsed_messages, leftover_partial_bytes)."""
    msgs: List[Dict[str, Any]] = []
    while b"\n" in buffer:
        line, buffer = buffer.split(b"\n", 1)
        line = line.strip()
        if not line:
            continue
        try:
            msgs.append(json.loads(line.decode("utf-8", errors="replace")))
        except (ValueError, UnicodeDecodeError):
            continue
    return msgs, buffer


# --------------------------------------------------------------------------
# UDP voice packet (UDPVoicePacket.cs)
# --------------------------------------------------------------------------
def _guid_bytes(guid: str) -> bytes:
    b = guid.encode("ascii")
    if len(b) != GUID_LENGTH:
        b = (b + b"\x00" * GUID_LENGTH)[:GUID_LENGTH]
    return b


def encode_voice_packet(
    *,
    audio: bytes,
    frequencies: List[float],
    modulations: List[int],
    encryptions: Optional[List[int]] = None,
    unit_id: int,
    packet_number: int,
    guid: str,
    original_guid: str,
) -> bytes:
    """Build a UDPVoicePacket. `audio` is the Opus payload. All ints little-endian."""
    if encryptions is None:
        encryptions = [0] * len(frequencies)
    audio_len = len(audio)
    freq_len = len(frequencies) * FREQ_SEGMENT_LENGTH
    total = PACKET_HEADER_LENGTH + audio_len + freq_len + FIXED_TAIL_LENGTH

    out = bytearray()
    out += struct.pack("<H", total)
    out += struct.pack("<H", audio_len)
    out += struct.pack("<H", freq_len)
    out += audio
    for i, f in enumerate(frequencies):
        out += struct.pack("<d", float(f))
        out += struct.pack("<B", int(modulations[i]) & 0xFF)
        out += struct.pack("<B", int(encryptions[i]) & 0xFF)
    out += struct.pack("<I", int(unit_id) & 0xFFFFFFFF)
    out += struct.pack("<Q", int(packet_number) & 0xFFFFFFFFFFFFFFFF)
    out += struct.pack("<B", 0)  # retransmission count
    out += _guid_bytes(original_guid)
    out += _guid_bytes(guid)
    assert len(out) == total, (len(out), total)
    return bytes(out)


def decode_voice_packet(data: bytes) -> Optional[Dict[str, Any]]:
    """Parse a received UDPVoicePacket. Returns None for a ping/too-short datagram."""
    if len(data) <= GUID_LENGTH:   # 22 bytes = ping, not voice
        return None
    if len(data) < PACKET_HEADER_LENGTH + FIXED_TAIL_LENGTH:
        return None
    audio_len = struct.unpack_from("<H", data, 2)[0]
    freq_len = struct.unpack_from("<H", data, 4)[0]
    audio_start = PACKET_HEADER_LENGTH
    audio_end = audio_start + audio_len
    freq_end = audio_end + freq_len
    if freq_end + FIXED_TAIL_LENGTH > len(data):
        return None

    audio = data[audio_start:audio_end]
    freqs: List[float] = []
    mods: List[int] = []
    for off in range(audio_end, freq_end, FREQ_SEGMENT_LENGTH):
        freqs.append(struct.unpack_from("<d", data, off)[0])
        mods.append(data[off + 8])

    o = freq_end
    unit_id = struct.unpack_from("<I", data, o)[0]
    packet_number = struct.unpack_from("<Q", data, o + 4)[0]
    original_guid = data[o + 13:o + 13 + GUID_LENGTH].decode("ascii", "replace")
    client_guid = data[o + 13 + GUID_LENGTH:o + 13 + 2 * GUID_LENGTH].decode("ascii", "replace")
    return {
        "audio": audio,
        "frequencies": freqs,
        "modulations": mods,
        "unit_id": unit_id,
        "packet_number": packet_number,
        "original_guid": original_guid,
        "guid": client_guid,
    }


def ping_packet(guid: str) -> bytes:
    """UDP keep-alive: the 22-byte ASCII GUID. Sent every ~15 s so the server
    routes inbound voice to our UDP endpoint."""
    return _guid_bytes(guid)
