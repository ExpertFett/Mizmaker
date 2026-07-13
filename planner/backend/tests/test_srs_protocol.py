"""SRS wire-protocol unit tests (no network, no Opus).

Locks the byte layout + message shapes ported from DCS-SimpleRadioStandalone so
a refactor can't silently break interop. The live-server check is the Phase 0
spike (spike.py) — these are the offline guards.
"""
import json

from services.srs_voice import protocol as P


def test_short_guid_is_22_chars_and_unique():
    a, b = P.short_guid(), P.short_guid()
    assert len(a) == P.GUID_LENGTH == 22
    assert a != b
    assert "+" not in a and "/" not in a and "=" not in a


def test_voice_packet_round_trip():
    audio = bytes(range(120))  # stand-in for an Opus frame
    pkt = P.encode_voice_packet(
        audio=audio,
        frequencies=[251_000_000.0, 30_000_000.0],
        modulations=[P.MOD_AM, P.MOD_FM],
        unit_id=100000001,
        packet_number=42,
        guid="A" * 22,
        original_guid="B" * 22,
    )
    # header self-consistency: first ushort == total length
    assert int.from_bytes(pkt[:2], "little") == len(pkt)

    out = P.decode_voice_packet(pkt)
    assert out is not None
    assert out["audio"] == audio
    assert out["frequencies"] == [251_000_000.0, 30_000_000.0]
    assert out["modulations"] == [P.MOD_AM, P.MOD_FM]
    assert out["unit_id"] == 100000001
    assert out["packet_number"] == 42
    assert out["guid"] == "A" * 22
    assert out["original_guid"] == "B" * 22


def test_voice_packet_lengths_match_constants():
    pkt = P.encode_voice_packet(
        audio=b"\x01\x02\x03", frequencies=[251e6], modulations=[P.MOD_AM],
        unit_id=1, packet_number=1, guid="G" * 22, original_guid="O" * 22,
    )
    # total = header(6) + audio(3) + freqseg(10) + tail(57)
    assert len(pkt) == 6 + 3 + P.FREQ_SEGMENT_LENGTH + P.FIXED_TAIL_LENGTH


def test_ping_is_22_bytes_and_not_decoded_as_voice():
    ping = P.ping_packet("Z" * 22)
    assert len(ping) == 22
    assert P.decode_voice_packet(ping) is None
    assert P.decode_voice_packet(b"short") is None


def test_make_client_shape():
    c = P.make_client(guid="g" * 22, name="Bengal DM", coalition=2,
                      freq_hz=251_000_000.0, modulation=P.MOD_AM, unit_id=100000002)
    assert c["ClientGuid"] == "g" * 22 and c["Coalition"] == 2
    radios = c["RadioInfo"]["radios"]
    assert len(radios) == 11                       # intercom + 10
    assert radios[1]["freq"] == 251_000_000.0 and radios[1]["modulation"] == P.MOD_AM
    assert c["RadioInfo"]["selected"] == 1


def test_message_builders_framed_json():
    c = P.make_client(guid="g" * 22, name="DM", coalition=2,
                      freq_hz=251e6, modulation=P.MOD_AM, unit_id=1)
    sync = P.sync_message(c)
    assert sync.endswith(b"\n")
    m = json.loads(sync[:-1])
    assert m["MsgType"] == P.MSG_SYNC and m["Client"]["ClientGuid"] == "g" * 22
    assert m["Version"] == P.CLIENT_VERSION

    eam = json.loads(P.eam_password_message(c, "bluepass")[:-1])
    assert eam["MsgType"] == P.MSG_EXTERNAL_AWACS_MODE_PASSWORD
    assert eam["ExternalAWACSModePassword"] == "bluepass"


def test_iter_tcp_messages_splits_and_keeps_partial():
    a = P.sync_message(P.make_client(guid="g" * 22, name="A", coalition=2,
                                     freq_hz=251e6, modulation=0, unit_id=1))
    b = P.radio_update_message(P.make_client(guid="h" * 22, name="B", coalition=1,
                                             freq_hz=30e6, modulation=1, unit_id=2))
    # feed both + a partial third
    msgs, leftover = P.iter_tcp_messages(a + b + b'{"MsgType":2,')
    assert len(msgs) == 2
    assert msgs[0]["MsgType"] == P.MSG_SYNC and msgs[1]["MsgType"] == P.MSG_RADIO_UPDATE
    assert leftover == b'{"MsgType":2,'
    # the leftover completes on the next read
    msgs2, leftover2 = P.iter_tcp_messages(leftover + b'"Client":null}\n')
    assert len(msgs2) == 1 and leftover2 == b""
