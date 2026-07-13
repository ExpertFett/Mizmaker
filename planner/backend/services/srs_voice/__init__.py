"""SRS (DCS-SimpleRadio-Standalone) voice bridge.

Lets a Live-panel member listen + talk on SRS without running DCS, via SRS's
External AWACS Mode. `protocol.py` is the pure wire protocol (no I/O, no Opus);
`bridge.py` (Phase 1) runs a per-user gevent bridge between a browser WebSocket
and the SRS server's TCP control + UDP voice.
"""
