# SRS voice bridge — browser voice on SRS, no DCS

Lets a Live-panel member **listen and push-to-talk on the squadron SRS server
from the browser**, with no DCS and no SRS client install. Uses SRS **External
AWACS Mode** (the DCS-less client mode).

```
Browser (SrsRadioPanel)  ⇄ wss ⇄  Railway gevent bridge  ⇄ TCP+UDP ⇄  SRS server
  WebCodecs Opus + PTT           dumb relay (protocol.py)        (EAM client)
```

The browser does Opus (WebCodecs — **Chrome/Edge only**); the bridge is a dumb
relay that reuses `protocol.py` for the SRS packet framing, so there is **no
server-side audio dependency**. The SRS host + EAM password stay server-side;
the browser only ever talks to us.

## Files
| File | Role |
|---|---|
| `protocol.py` | Pure SRS wire protocol (EAM handshake, UDP voice packet). No I/O. 7 unit tests in `tests/test_srs_protocol.py`. |
| `bridge.py` | Per-WebSocket relay (`run_bridge`) + loopback self-test (`run_loopback`). |
| `spike.py` | CLI to validate the protocol against a real SRS server. |
| `../../app.py` | `@sock.route("/api/groups/<gid>/srs/ws")` — member-gated. |
| `frontend/src/editor/live/SrsRadioPanel.tsx` | The radio UI. |

## Verifying — two independent halves

**1. Browser audio pipeline (no server needed).** In the Live panel open
**🎙 SRS voice → 🔁 Radio check (loopback)**, put on headphones, hold PTT and
talk. If you hear yourself, the whole browser half works (mic capture, Opus
encode, WS round-trip, decode, playback). This needs only a logged-in group
member — no SRS server, no env vars.

**2. SRS wire protocol (needs the real server).** SRS wire details drift across
versions, so pin them against the squadron server:
```bash
cd planner/backend
python -m services.srs_voice.spike --host <SRS_HOST> --port 5002 \
    --password <BLUE_PW> --coalition blue --freq 251.0 --mod AM --listen 60
```
Have a pilot key up on 251.0 AM — the spike should report received audio. (RX
needs no extra deps. `--transmit` sends a test tone and needs `opuslib`.)

When both pass, the feature works end to end.

## Server prerequisites (Fett)
- SRS server reachable from the internet on the voice port (**TCP and UDP**,
  default **5002**).
- **External AWACS Mode enabled** with blue/red coalition passwords.

## Railway env (lights up the panel)
| Var | Example |
|---|---|
| `SRS_VOICE_HOST` | `srs.myserver.com` |
| `SRS_VOICE_PORT` | `5002` |
| `SRS_EAM_PASSWORD_BLUE` | *(blue coalition password)* |
| `SRS_EAM_PASSWORD_RED` | *(red coalition password)* |

Unset → the panel shows "SRS voice is not configured" (the loopback radio check
still works). Per-group SRS profiles are a v2 follow-up.

## Troubleshooting
- **"SRS version mismatch"** → bump `CLIENT_VERSION` in `protocol.py` to match
  the server's advertised version.
- **"rejected External-AWACS login"** → wrong coalition password, or EAM is off.
- **"Browser voice needs Chrome or Edge"** → WebCodecs Opus is Chromium-only.
- **Loopback howls** → use headphones; speaker + mic feeds back.
