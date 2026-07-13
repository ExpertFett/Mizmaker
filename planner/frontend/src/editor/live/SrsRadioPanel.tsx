// SRS Radio — full-duplex browser voice on the squadron SRS server, no DCS.
//
// Architecture (browser-side Opus; the bridge is a dumb relay — see
// backend/services/srs_voice/bridge.py):
//   TX: mic → 16 kHz AudioContext → recorder worklet (640-sample frames) →
//       WebCodecs AudioEncoder(opus) → WS binary → bridge → SRS UDP
//   RX: SRS UDP → bridge → WS binary → AudioDecoder(opus) → scheduled
//       AudioBufferSource on the same 16 kHz context → speakers
//   Control (WS text JSON): {type:'tune',freq,mod}, {type:'ptt',on}
//   Status (from bridge): {type:'status',state:'connected'|'error',...}
//
// The audio graph (mic/encoder/decoder/context) is set up once; only the WS
// re-opens on a drop (bridge restart, network blip) with capped backoff, so a
// brief outage doesn't cost the mic permission or a re-key.
//
// WebCodecs Opus is Chrome/Edge only — we gate on it and tell Safari/Firefox
// users to fall back to the native SRS client (matches the v1 decision).
import { useCallback, useEffect, useRef, useState } from 'react';
import { srsVoiceWsUrl } from '../../api/groups';

// --- SRS voice wire constants (mirror backend protocol.py) ------------------
const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 640;          // 40 ms Opus frame
const MOD_AM = 0;
const MOD_FM = 1;

// WebCodecs is Chrome/Edge only — typeof guards never throw where it's absent.
const hasWebCodecs = (): boolean =>
  typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined' && typeof AudioData !== 'undefined';

// Recorder worklet — buffers 128-sample render quanta into 640-sample frames
// and posts them to the main thread. Loaded via a Blob URL so no bundler/
// worklet config is needed.
const RECORDER_WORKLET = `
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._buf = new Float32Array(${FRAME_SAMPLES}); this._n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this._buf[this._n++] = ch[i];
      if (this._n === ${FRAME_SAMPLES}) {
        const out = this._buf.slice(0);
        this.port.postMessage(out, [out.buffer]);
        this._n = 0;
      }
    }
    return true;
  }
}
registerProcessor('srs-recorder', RecorderProcessor);
`;

type ConnState = 'idle' | 'connecting' | 'connected' | 'error';

export interface SrsTuneRequest { freqMhz: number; mod: number; seq: number }

interface Props {
  groupId: string;
  callsign?: string;
  tuneRequest?: SrsTuneRequest | null;   // set from an SRS-directory row click
  onClose: () => void;
}

export function SrsRadioPanel({ groupId, callsign, tuneRequest, onClose }: Props) {
  const [freqMhz, setFreqMhz] = useState('251.000');
  const [mod, setMod] = useState<number>(MOD_AM);
  const [coalition, setCoalition] = useState<'blue' | 'red'>('blue');
  const [state, setState] = useState<ConnState>('idle');
  const [statusMsg, setStatusMsg] = useState('Not connected.');
  const [ptt, setPtt] = useState(false);
  const [rx, setRx] = useState(false);
  const [volume, setVolume] = useState(1);
  const [spacePtt, setSpacePtt] = useState(true);

  const supported = hasWebCodecs();

  // Live refs (avoid stale closures inside the audio/WS callbacks).
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const encRef = useRef<AudioEncoder | null>(null);
  const decRef = useRef<AudioDecoder | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const pttRef = useRef(false);
  const tsRef = useRef(0);              // monotonically-increasing encoder timestamp (µs)
  const playHeadRef = useRef(0);        // next playback start time on the ctx clock
  const rxTimer = useRef<number | null>(null);
  // Reconnect machinery.
  const manualCloseRef = useRef(false);
  const reconnectRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const cfgRef = useRef<{ coalition: 'blue' | 'red'; name?: string }>({ coalition: 'blue' });
  const curFreqRef = useRef(251_000_000);
  const curModRef = useRef(MOD_AM);
  const lastTuneSeq = useRef(0);
  const loopbackRef = useRef(false);
  const hadErrorRef = useRef(false);   // a server-reported error must survive the ensuing close

  useEffect(() => { pttRef.current = ptt; }, [ptt]);
  useEffect(() => { if (gainRef.current) gainRef.current.gain.value = volume; }, [volume]);
  useEffect(() => { curModRef.current = mod; }, [mod]);

  const parseFreqHz = useCallback((): number => {
    const mhz = parseFloat(freqMhz);
    return Number.isFinite(mhz) ? Math.round(mhz * 1e6) : 251_000_000;
  }, [freqMhz]);
  useEffect(() => { curFreqRef.current = parseFreqHz(); }, [parseFreqHz]);

  // --- playback: decoded AudioData → gapless scheduled buffer sources -------
  const onDecoded = useCallback((audioData: AudioData) => {
    const ctx = ctxRef.current;
    const gain = gainRef.current;
    if (!ctx || !gain) { audioData.close(); return; }
    const n = audioData.numberOfFrames;
    const pcm = new Float32Array(n);
    try { audioData.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' }); } catch { /* fmt */ }
    audioData.close();
    const buf = ctx.createBuffer(1, n, SAMPLE_RATE);
    buf.copyToChannel(pcm, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    const now = ctx.currentTime;
    const at = Math.max(now + 0.02, playHeadRef.current);
    src.start(at);
    playHeadRef.current = at + n / SAMPLE_RATE;
    // RX indicator: lit while frames are arriving, auto-clears on a gap.
    setRx(true);
    if (rxTimer.current) window.clearTimeout(rxTimer.current);
    rxTimer.current = window.setTimeout(() => setRx(false), 250);
  }, []);

  const teardown = useCallback(() => {
    manualCloseRef.current = true;
    if (reconnectRef.current) { window.clearTimeout(reconnectRef.current); reconnectRef.current = null; }
    try { wsRef.current?.close(); } catch { /* */ }
    wsRef.current = null;
    try { nodeRef.current?.disconnect(); } catch { /* */ }
    nodeRef.current = null;
    try { encRef.current?.close(); } catch { /* */ }
    encRef.current = null;
    try { decRef.current?.close(); } catch { /* */ }
    decRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    try { ctxRef.current?.close(); } catch { /* */ }
    ctxRef.current = null;
    gainRef.current = null;
    playHeadRef.current = 0;
    setPtt(false); setRx(false);
  }, []);

  // (Re)open just the WebSocket — the audio graph persists across reconnects.
  const openSocket = useCallback(() => {
    if (manualCloseRef.current || !ctxRef.current) return;
    const url = srsVoiceWsUrl(groupId, { coalition: cfgRef.current.coalition, freqHz: curFreqRef.current, mod: curModRef.current, name: cfgRef.current.name, loopback: loopbackRef.current });
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => { attemptRef.current = 0; };
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === 'status') {
            if (m.state === 'connected') {
              setState('connected');
              setStatusMsg(loopbackRef.current
                ? '🔁 LOOPBACK — hold PTT and you should hear yourself. Use headphones.'
                : `On freq ${(curFreqRef.current / 1e6).toFixed(3)} ${curModRef.current === MOD_AM ? 'AM' : 'FM'} — ${cfgRef.current.coalition.toUpperCase()}`);
            } else if (m.state === 'error') {
              manualCloseRef.current = true;          // server said no — don't loop
              hadErrorRef.current = true;             // survive the close that follows
              setState('error'); setStatusMsg(m.error || 'SRS error');
            }
          }
        } catch { /* ignore */ }
        return;
      }
      const data = ev.data as ArrayBuffer;
      const dec2 = decRef.current;
      if (!dec2 || data.byteLength === 0) return;
      const chunk = new EncodedAudioChunk({ type: 'key', timestamp: tsRef.current, data: new Uint8Array(data) });
      try { dec2.decode(chunk); } catch { /* drop */ }
    };
    ws.onclose = () => {
      // A server-reported error already set the message — leave it visible.
      if (hadErrorRef.current) { setState('error'); return; }
      // Deliberate close (user disconnect / unmount / failed setup).
      if (manualCloseRef.current || !ctxRef.current) { setState('idle'); setStatusMsg('Disconnected.'); return; }
      // Unexpected drop while the graph is live → reconnect with capped backoff.
      setPtt(false); pttRef.current = false;
      const n = Math.min(attemptRef.current, 5);
      attemptRef.current += 1;
      const delay = Math.min(1000 * 2 ** n, 10000);
      setState('connecting');
      setStatusMsg(`Connection lost — reconnecting in ${Math.round(delay / 1000)}s…`);
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      reconnectRef.current = window.setTimeout(() => openSocket(), delay);
    };
    ws.onerror = () => { /* onclose drives the reconnect */ };
  }, [groupId]);

  const connect = useCallback(async (loopback = false) => {
    if (!supported) return;
    loopbackRef.current = loopback;
    manualCloseRef.current = false;
    hadErrorRef.current = false;
    attemptRef.current = 0;
    cfgRef.current = { coalition, name: callsign };
    curFreqRef.current = parseFreqHz();
    curModRef.current = mod;
    setState('connecting');
    setStatusMsg('Requesting microphone…');
    try {
      // 1) Audio graph @ 16 kHz (browser resamples the mic into this context).
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      ctxRef.current = ctx;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      gainRef.current = gain;

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micRef.current = mic;

      const blobUrl = URL.createObjectURL(new Blob([RECORDER_WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);

      // 2) WebCodecs encoder (mic frames → Opus → WS) & decoder (Opus → speaker).
      const enc = new AudioEncoder({
        output: (chunk: EncodedAudioChunk) => {
          if (!pttRef.current) return;
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          ws.send(bytes);
        },
        error: (e: unknown) => setStatusMsg(`Encoder error: ${String(e)}`),
      });
      const encConfig: AudioEncoderConfig = { codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1, bitrate: 24000 };
      (encConfig as unknown as Record<string, unknown>).opus = { frameDuration: 40000 };
      enc.configure(encConfig);
      encRef.current = enc;

      const dec = new AudioDecoder({
        output: (d: AudioData) => onDecoded(d),
        error: (e: unknown) => setStatusMsg(`Decoder error: ${String(e)}`),
      });
      dec.configure({ codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1 });
      decRef.current = dec;

      // 3) Mic worklet → encoder (only encodes while keyed).
      const node = new AudioWorkletNode(ctx, 'srs-recorder');
      node.port.onmessage = (ev: MessageEvent) => {
        if (!pttRef.current) return;
        const frame = ev.data as Float32Array<ArrayBuffer>;
        const ts = tsRef.current;
        tsRef.current += Math.round((FRAME_SAMPLES / SAMPLE_RATE) * 1e6);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: FRAME_SAMPLES, numberOfChannels: 1, timestamp: ts, data: frame });
        try { enc.encode(ad); } finally { ad.close(); }
      };
      const srcNode = ctx.createMediaStreamSource(mic);
      srcNode.connect(node);
      node.connect(ctx.createGain());     // keep the worklet pulling; don't monitor mic to speakers
      nodeRef.current = node;

      // 4) Open the WebSocket to the bridge (reconnectable).
      setStatusMsg('Connecting to SRS…');
      openSocket();
    } catch (e) {
      manualCloseRef.current = true;
      setState('error');
      setStatusMsg(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Microphone permission denied.' : `Connect failed: ${e instanceof Error ? e.message : String(e)}`);
      teardown();
    }
  }, [supported, volume, coalition, callsign, mod, parseFreqHz, onDecoded, teardown, openSocket]);

  const disconnect = useCallback(() => { teardown(); setState('idle'); setStatusMsg('Disconnected.'); }, [teardown]);

  // Retune live without reconnecting.
  const applyTune = useCallback(() => {
    curFreqRef.current = parseFreqHz();
    curModRef.current = mod;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'tune', freq: parseFreqHz(), mod }));
      setStatusMsg(`On freq ${freqMhz} ${mod === MOD_AM ? 'AM' : 'FM'} — ${coalition.toUpperCase()}`);
    }
  }, [parseFreqHz, mod, freqMhz, coalition]);

  // A directory-row "tune" click: set the fields, and retune live if connected.
  useEffect(() => {
    if (!tuneRequest || tuneRequest.seq === lastTuneSeq.current) return;
    lastTuneSeq.current = tuneRequest.seq;
    const f = tuneRequest.freqMhz;
    setFreqMhz(f.toFixed(3));
    setMod(tuneRequest.mod);
    curFreqRef.current = Math.round(f * 1e6);
    curModRef.current = tuneRequest.mod;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'tune', freq: Math.round(f * 1e6), mod: tuneRequest.mod }));
      setStatusMsg(`On freq ${f.toFixed(3)} ${tuneRequest.mod === MOD_AM ? 'AM' : 'FM'} — ${cfgRef.current.coalition.toUpperCase()}`);
    }
  }, [tuneRequest]);

  const setKey = useCallback((on: boolean) => {
    setPtt((cur) => {
      if (cur === on) return cur;
      pttRef.current = on;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ptt', on }));
      return on;
    });
  }, []);

  // Space-bar PTT (opt-in; guarded so it doesn't scroll or fire while typing).
  useEffect(() => {
    if (!spacePtt || state !== 'connected') return;
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !e.repeat && !isField(e.target)) { e.preventDefault(); setKey(true); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && !isField(e.target)) { e.preventDefault(); setKey(false); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [spacePtt, state, setKey]);

  useEffect(() => () => teardown(), [teardown]);   // cleanup on unmount

  const connected = state === 'connected';
  const busy = state === 'connecting';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0e1116', color: '#d7dde5', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderBottom: '1px solid #232a33', background: '#141a22' }}>
        <span style={{ fontWeight: 700, letterSpacing: 0.5, color: '#8fd0ff' }}>🎙 SRS VOICE</span>
        <span style={{ marginLeft: 8, fontSize: 10, color: connected ? '#5fd38a' : state === 'error' ? '#ff7a7a' : '#7b8695' }}>
          {connected ? '● LIVE' : busy ? '… connecting' : state === 'error' ? '● error' : '○ offline'}
        </span>
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#7b8695', cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>

      {!supported ? (
        <div style={{ padding: 12, lineHeight: 1.5 }}>
          <b style={{ color: '#ffd24a' }}>Browser voice needs Chrome or Edge.</b>
          <p style={{ margin: '6px 0 0', color: '#9aa4b2' }}>
            This browser lacks the WebCodecs Opus support the voice client uses. Open the Live panel in Chrome/Edge, or use the native SRS client in DCS. The SRS directory still works everywhere.
          </p>
        </div>
      ) : (
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          {/* Frequency + modulation */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ color: '#9aa4b2', minWidth: 34 }}>Freq</label>
            <input value={freqMhz} onChange={(e) => setFreqMhz(e.target.value)}
                   style={{ width: 82, background: '#0b0e13', border: '1px solid #2a323d', color: '#e7edf5', padding: '4px 6px', borderRadius: 4, fontFamily: 'monospace' }} />
            <span style={{ color: '#7b8695' }}>MHz</span>
            <div style={{ display: 'flex', marginLeft: 'auto', border: '1px solid #2a323d', borderRadius: 4, overflow: 'hidden' }}>
              {([[MOD_AM, 'AM'], [MOD_FM, 'FM']] as const).map(([v, l]) => (
                <button key={l} onClick={() => setMod(v)}
                        style={{ padding: '4px 10px', background: mod === v ? '#2a68b8' : 'transparent', color: mod === v ? '#fff' : '#9aa4b2', border: 'none', cursor: 'pointer', fontWeight: 600 }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Coalition (drives which EAM password the bridge uses) */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ color: '#9aa4b2', minWidth: 34 }}>Side</label>
            <div style={{ display: 'flex', border: '1px solid #2a323d', borderRadius: 4, overflow: 'hidden' }}>
              {(['blue', 'red'] as const).map((c) => (
                <button key={c} disabled={connected} onClick={() => setCoalition(c)}
                        style={{ padding: '4px 12px', background: coalition === c ? (c === 'blue' ? '#2a68b8' : '#b8392a') : 'transparent', color: coalition === c ? '#fff' : '#9aa4b2', border: 'none', cursor: connected ? 'not-allowed' : 'pointer', fontWeight: 600, textTransform: 'uppercase' }}>{c}</button>
              ))}
            </div>
            {connected && (
              <button onClick={applyTune} style={{ marginLeft: 'auto', padding: '4px 10px', background: 'transparent', border: '1px solid #2a68b8', color: '#8fd0ff', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Tune ⟳</button>
            )}
          </div>

          {/* Connect / PTT */}
          {!connected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={() => connect(false)} disabled={busy}
                      style={{ padding: '9px 0', background: busy ? '#33465f' : '#2a68b8', color: '#fff', border: 'none', borderRadius: 5, cursor: busy ? 'default' : 'pointer', fontWeight: 700, letterSpacing: 0.5 }}>
                {busy ? 'CONNECTING…' : 'CONNECT'}
              </button>
              <button onClick={() => connect(true)} disabled={busy}
                      title="Echo your own mic back through the full audio path — verifies your browser can capture, encode, round-trip, and play SRS voice with no server"
                      style={{ padding: '6px 0', background: 'transparent', border: '1px solid #3a4a5e', color: '#9aa4b2', borderRadius: 5, cursor: busy ? 'default' : 'pointer', fontWeight: 600, fontSize: 11 }}>
                🔁 Radio check (loopback)
              </button>
            </div>
          ) : (
            <>
              <button
                onMouseDown={() => setKey(true)} onMouseUp={() => setKey(false)} onMouseLeave={() => ptt && setKey(false)}
                onTouchStart={(e) => { e.preventDefault(); setKey(true); }} onTouchEnd={(e) => { e.preventDefault(); setKey(false); }}
                style={{ padding: '16px 0', background: ptt ? '#c02b2b' : '#1c3350', color: '#fff', border: `2px solid ${ptt ? '#ff6b6b' : '#2a68b8'}`, borderRadius: 6, cursor: 'pointer', fontWeight: 800, letterSpacing: 1, userSelect: 'none' }}>
                {ptt ? '● TRANSMITTING' : 'HOLD TO TALK'}
              </button>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11 }}>
                <span style={{ color: rx ? '#5fd38a' : '#4a5563' }}>● RX</span>
                <span style={{ color: ptt ? '#ff6b6b' : '#4a5563' }}>● TX</span>
                <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, color: '#9aa4b2', cursor: 'pointer' }}>
                  <input type="checkbox" checked={spacePtt} onChange={(e) => setSpacePtt(e.target.checked)} /> Space = PTT
                </label>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: '#9aa4b2' }}>🔊</span>
                <input type="range" min={0} max={1.5} step={0.05} value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} style={{ flex: 1 }} />
              </div>
              <button onClick={disconnect} style={{ padding: '6px 0', background: 'transparent', border: '1px solid #55606e', color: '#9aa4b2', borderRadius: 5, cursor: 'pointer', fontWeight: 600 }}>DISCONNECT</button>
            </>
          )}

          <div style={{ fontSize: 10.5, color: state === 'error' ? '#ff9a9a' : '#7b8695', lineHeight: 1.4, borderTop: '1px solid #1c222b', paddingTop: 6 }}>
            {statusMsg}
          </div>
        </div>
      )}
    </div>
  );
}
