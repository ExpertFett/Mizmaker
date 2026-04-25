/**
 * Brief Generator tab — auto-builds a wing briefing from the loaded mission,
 * lets the mission maker review/edit each section, then exports as
 * .pptx / .pdf / .png slides / .jpg slides.
 *
 * Two modes:
 *   1. "Build from mission" (default) — calls /api/brief/build-wing,
 *      shows the auto-generated WingBrief in an editor with one card per
 *      section. User reviews/edits any field, hits Render & Download.
 *   2. "Custom template" (advanced, collapsible) — token-substitution
 *      flow against a squadron's own .pptx. Preserved from the previous
 *      version since some users will want this path.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { isPlayerGroup } from '../../utils/groups';

// ---------------------------------------------------------------------------
// Types — mirror services/brief_builder.py WingBrief shape
// ---------------------------------------------------------------------------

interface TimelineRow { phase: string; time_zulu: string; note: string }
interface FlightRow { callsign: string; aircraft: string; count: number; role: string;
                      frequency: string; tacan: string; home_plate: string }
interface ThreatRow { name: string; type: string; coalition: string; range_km: number; location: string }
interface CommsRow  { label: string; value: string }

interface WingBrief {
  mission_name: string;
  theater: string;
  date: string;
  time_zulu: string;
  coalition: string;
  theatre_overview: string;
  scenario: string;
  commanders_intent: string;
  mission_flow: string;
  notes: string;
  timeline: TimelineRow[];
  threats: ThreatRow[];
  flights: FlightRow[];
  comms: CommsRow[];
}

type OutputFormat = 'pptx' | 'pdf' | 'png' | 'jpg';
const FORMAT_LABEL: Record<OutputFormat, string> = {
  pptx: 'PowerPoint (.pptx)',
  pdf: 'PDF',
  png: 'PNG slides (.zip)',
  jpg: 'JPG slides (.zip)',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BriefGenTab() {
  const sessionId = useMissionStore((s) => s.sessionId);
  const [brief, setBrief] = useState<WingBrief | null>(null);
  const [building, setBuilding] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<OutputFormat>('pptx');
  const [availableFormats, setAvailableFormats] = useState<OutputFormat[]>(['pptx']);

  const probeCapabilities = () => {
    fetch('/api/brief/capabilities')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.formats && setAvailableFormats(d.formats as OutputFormat[]))
      .catch(() => {});
  };
  useEffect(() => { probeCapabilities(); }, []);

  const handleBuild = async () => {
    if (!sessionId) {
      setError('Load a mission first.');
      return;
    }
    setBuilding(true); setError(null);
    try {
      const res = await fetch('/api/brief/build-wing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Build failed' }));
        throw new Error(err.error || 'Build failed');
      }
      const data = await res.json();
      setBrief(data as WingBrief);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBuilding(false);
    }
  };

  const handleRender = async () => {
    if (!brief) return;
    setRendering(true); setError(null);
    try {
      const res = await fetch('/api/brief/render-wing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, format }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Render failed' }));
        throw new Error(err.error || 'Render failed');
      }
      const blob = await res.blob();
      const safe = (brief.mission_name || 'wing_brief').replace(/[/\\]/g, '_');
      const ext = format === 'png' || format === 'jpg' ? `_${format}.zip`
                : format === 'pdf' ? '.pdf' : '.pptx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safe}_wing${ext}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRendering(false);
    }
  };

  // Brief mutators ----------------------------------------------------------
  function set<K extends keyof WingBrief>(key: K, value: WingBrief[K]) {
    setBrief((b) => (b ? { ...b, [key]: value } : null));
  }
  function setRow<F extends 'timeline' | 'threats' | 'flights' | 'comms'>(
    field: F, idx: number, row: WingBrief[F][number],
  ) {
    setBrief((b) => {
      if (!b) return null;
      const arr = [...b[field]] as WingBrief[F];
      (arr as any)[idx] = row;
      return { ...b, [field]: arr };
    });
  }
  function addRow<F extends 'timeline' | 'threats' | 'flights' | 'comms'>(field: F, blank: WingBrief[F][number]) {
    setBrief((b) => (b ? { ...b, [field]: [...b[field], blank] as WingBrief[F] } : null));
  }
  function removeRow<F extends 'timeline' | 'threats' | 'flights' | 'comms'>(field: F, idx: number) {
    setBrief((b) => (b ? { ...b, [field]: b[field].filter((_, i) => i !== idx) as WingBrief[F] } : null));
  }

  return (
    <div style={{ padding: 20, color: '#e0e0e0', overflow: 'auto', height: '100%' }}>
      <h2 style={{ fontSize: 18, marginBottom: 6 }}>Brief Generator</h2>
      <p style={{ fontSize: 13, color: '#aaaaaa', marginBottom: 16 }}>
        Auto-build a wing briefing from the loaded mission. Review and edit
        each section, then export as PowerPoint, PDF, or per-slide images.
      </p>

      {/* No brief yet — show Build button */}
      {!brief && (
        <div style={{
          border: '1px solid #3a3a3a', background: '#222222',
          padding: '24px 20px', textAlign: 'center', marginBottom: 16,
        }}>
          <p style={{ fontSize: 14, marginBottom: 14 }}>
            {sessionId ? 'Ready to build a wing brief from the loaded mission.'
                       : 'Load a mission first, then build a brief.'}
          </p>
          <button
            onClick={handleBuild}
            disabled={!sessionId || building}
            style={{
              ...btnPrimary,
              opacity: !sessionId || building ? 0.5 : 1,
              cursor: !sessionId || building ? 'not-allowed' : 'pointer',
            }}
          >
            {building ? 'Building…' : 'Build Wing Brief'}
          </button>
          <p style={{ fontSize: 11, color: '#aaaaaa', marginTop: 12 }}>
            Output formats:{' '}
            <span style={{ color: '#cccccc', fontWeight: 600 }}>
              {availableFormats.map((f) => FORMAT_LABEL[f].replace(/ \(.*\)/, '')).join(' · ')}
            </span>
          </p>
        </div>
      )}

      {/* Editor view */}
      {brief && (
        <>
          {/* Sticky action bar */}
          <div style={{
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
            padding: '10px 14px', background: '#262626',
            border: '1px solid #3a3a3a', marginBottom: 16,
          }}>
            <button
              onClick={handleRender}
              disabled={rendering}
              style={{ ...btnPrimary, opacity: rendering ? 0.5 : 1 }}
            >
              {rendering ? 'Rendering…' : 'Render & Download'}
            </button>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as OutputFormat)}
              onFocus={probeCapabilities}
              disabled={rendering}
              style={selectStyle}
            >
              {(['pptx', 'pdf', 'png', 'jpg'] as OutputFormat[]).map((f) => (
                <option key={f} value={f} disabled={!availableFormats.includes(f)}>
                  {FORMAT_LABEL[f]}{!availableFormats.includes(f) ? ' (LibreOffice required)' : ''}
                </option>
              ))}
            </select>
            <button onClick={handleBuild} style={btnSecondary}>Rebuild from mission</button>
            <span style={{ flex: 1 }} />
            <button onClick={() => setBrief(null)} style={btnDanger}>Discard</button>
          </div>

          {/* Header card — mission name / date / time */}
          <Card title="Cover">
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
              <Field label="Mission name">
                <input style={inputStyle} value={brief.mission_name}
                       onChange={(e) => set('mission_name', e.target.value)} />
              </Field>
              <Field label="Date">
                <input style={inputStyle} value={brief.date}
                       onChange={(e) => set('date', e.target.value)} />
              </Field>
              <Field label="Time (Zulu)">
                <input style={inputStyle} value={brief.time_zulu}
                       onChange={(e) => set('time_zulu', e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="Theatre Overview">
            <textarea style={textareaStyle} rows={6} value={brief.theatre_overview}
                      onChange={(e) => set('theatre_overview', e.target.value)} />
          </Card>

          <Card title="Scenario">
            <textarea style={textareaStyle} rows={8} value={brief.scenario}
                      onChange={(e) => set('scenario', e.target.value)} />
          </Card>

          <Card title="Commander's Intent">
            <textarea style={textareaStyle} rows={6} value={brief.commanders_intent}
                      onChange={(e) => set('commanders_intent', e.target.value)} />
          </Card>

          <Card title="Threats" right={
            <button onClick={() => addRow('threats', { name: '', type: '', coalition: 'red', range_km: 0, location: '' })}
                    style={btnSmall}>+ Add</button>
          }>
            {brief.threats.length === 0 ? (
              <p style={emptyStyle}>No surface threats detected. Add manually if needed.</p>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr><th style={th}>Name</th><th style={th}>Type</th><th style={th}>Coalition</th>
                      <th style={th}>Range (km)</th><th style={th}>Location</th><th style={th}></th></tr>
                </thead>
                <tbody>
                  {brief.threats.map((t, i) => (
                    <tr key={i}>
                      <td style={td}><input style={cellInput} value={t.name}
                          onChange={(e) => setRow('threats', i, { ...t, name: e.target.value })} /></td>
                      <td style={td}><input style={cellInput} value={t.type}
                          onChange={(e) => setRow('threats', i, { ...t, type: e.target.value })} /></td>
                      <td style={td}><input style={cellInput} value={t.coalition}
                          onChange={(e) => setRow('threats', i, { ...t, coalition: e.target.value })} /></td>
                      <td style={td}><input style={cellInput} type="number" step="0.1" value={t.range_km}
                          onChange={(e) => setRow('threats', i, { ...t, range_km: Number(e.target.value) })} /></td>
                      <td style={td}><input style={cellInput} value={t.location}
                          onChange={(e) => setRow('threats', i, { ...t, location: e.target.value })} /></td>
                      <td style={td}><button style={btnIcon}
                          onClick={() => removeRow('threats', i)} title="Delete row">×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Friendly Forces" right={
            <button onClick={() => addRow('flights', { callsign: '', aircraft: '', count: 1, role: '', frequency: '', tacan: '', home_plate: '' })}
                    style={btnSmall}>+ Add</button>
          }>
            <table style={tableStyle}>
              <thead>
                <tr><th style={th}>Callsign</th><th style={th}>Aircraft</th><th style={th}>#</th>
                    <th style={th}>Role</th><th style={th}>Freq</th><th style={th}>TACAN</th>
                    <th style={th}>Home Plate</th><th style={th}></th></tr>
              </thead>
              <tbody>
                {brief.flights.map((f, i) => (
                  <tr key={i}>
                    <td style={td}><input style={cellInput} value={f.callsign}
                        onChange={(e) => setRow('flights', i, { ...f, callsign: e.target.value })} /></td>
                    <td style={td}><input style={cellInput} value={f.aircraft}
                        onChange={(e) => setRow('flights', i, { ...f, aircraft: e.target.value })} /></td>
                    <td style={td}><input style={{ ...cellInput, width: 50 }} type="number" value={f.count}
                        onChange={(e) => setRow('flights', i, { ...f, count: Number(e.target.value) })} /></td>
                    <td style={td}><input style={cellInput} value={f.role}
                        onChange={(e) => setRow('flights', i, { ...f, role: e.target.value })} /></td>
                    <td style={td}><input style={cellInput} value={f.frequency}
                        onChange={(e) => setRow('flights', i, { ...f, frequency: e.target.value })} /></td>
                    <td style={td}><input style={cellInput} value={f.tacan}
                        onChange={(e) => setRow('flights', i, { ...f, tacan: e.target.value })} /></td>
                    <td style={td}><input style={cellInput} value={f.home_plate}
                        onChange={(e) => setRow('flights', i, { ...f, home_plate: e.target.value })} /></td>
                    <td style={td}><button style={btnIcon}
                        onClick={() => removeRow('flights', i)} title="Delete row">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Comms" right={
            <button onClick={() => addRow('comms', { label: '', value: '' })} style={btnSmall}>+ Add</button>
          }>
            <table style={tableStyle}>
              <thead><tr><th style={th}>Label</th><th style={th}>Value</th><th style={th}></th></tr></thead>
              <tbody>
                {brief.comms.map((c, i) => (
                  <tr key={i}>
                    <td style={td}><input style={cellInput} value={c.label}
                        onChange={(e) => setRow('comms', i, { ...c, label: e.target.value })} /></td>
                    <td style={td}><input style={cellInput} value={c.value}
                        onChange={(e) => setRow('comms', i, { ...c, value: e.target.value })} /></td>
                    <td style={td}><button style={btnIcon}
                        onClick={() => removeRow('comms', i)} title="Delete row">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Mission Flow">
            <textarea style={textareaStyle} rows={8} value={brief.mission_flow}
                      onChange={(e) => set('mission_flow', e.target.value)} />
          </Card>

          <Card title="Timeline" right={
            <button onClick={() => addRow('timeline', { phase: '', time_zulu: '', note: '' })} style={btnSmall}>+ Add</button>
          }>
            <table style={tableStyle}>
              <thead><tr><th style={th}>Phase</th><th style={th}>Time (Z)</th>
                         <th style={th}>Note</th><th style={th}></th></tr></thead>
              <tbody>
                {brief.timeline.map((r, i) => (
                  <tr key={i}>
                    <td style={td}><input style={cellInput} value={r.phase}
                        onChange={(e) => setRow('timeline', i, { ...r, phase: e.target.value })} /></td>
                    <td style={td}><input style={{ ...cellInput, width: 80, fontFamily: "'B612 Mono', monospace" }} value={r.time_zulu}
                        onChange={(e) => setRow('timeline', i, { ...r, time_zulu: e.target.value })} /></td>
                    <td style={td}><input style={cellInput} value={r.note}
                        onChange={(e) => setRow('timeline', i, { ...r, note: e.target.value })} /></td>
                    <td style={td}><button style={btnIcon}
                        onClick={() => removeRow('timeline', i)} title="Delete row">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Special Instructions / Notes">
            <textarea style={textareaStyle} rows={6} value={brief.notes}
                      placeholder="ROE, special procedures, contingency plans, code-words, divert decisions…"
                      onChange={(e) => set('notes', e.target.value)} />
          </Card>
        </>
      )}

      {error && (
        <div style={{
          marginTop: 12, padding: '8px 12px', background: '#3a1a1a',
          border: '1px solid #d95050', color: '#d95050',
        }}>{error}</div>
      )}

      {/* Custom template — preserved as advanced fallback */}
      <details style={{ marginTop: 24, fontSize: 13, color: '#aaaaaa' }}>
        <summary style={{ cursor: 'pointer', padding: '6px 0', userSelect: 'none' }}>
          Advanced — use a custom .pptx template instead
        </summary>
        <CustomTemplateFlow />
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom-template subcomponent (legacy token-substitution flow, preserved
// for squadrons that already have a templated brief and want to use that
// path instead of the auto-built brief).
// ---------------------------------------------------------------------------

interface ScanResult {
  filename: string;
  tokens: string[];
  templateBytes: ArrayBuffer;
}

function CustomTemplateFlow() {
  const store = useMissionStore();
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<OutputFormat>('pptx');
  const [availableFormats, setAvailableFormats] = useState<OutputFormat[]>(['pptx']);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/brief/capabilities')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.formats && setAvailableFormats(d.formats as OutputFormat[]))
      .catch(() => {});
  }, []);

  const tokenRows = useMemo(() => {
    if (!scan) return [] as { token: string; auto: string | null; final: string;
                              isAutoResolved: boolean; isOverridden: boolean }[];
    return scan.tokens.map((token) => {
      const auto = resolveCustomToken(token, store);
      const override = overrides[token];
      const final = override !== undefined ? override : (auto ?? '');
      return { token, auto, final, isAutoResolved: auto !== null, isOverridden: override !== undefined };
    });
  }, [scan, store, overrides]);

  const handleUpload = async (file: File) => {
    setError(null); setOverrides({});
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch('/api/brief/scan', { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Scan failed');
      const data = await res.json();
      setScan({ filename: data.filename, tokens: data.tokens, templateBytes: await file.arrayBuffer() });
    } catch (e: any) { setError(e.message); }
  };

  const handleRender = async () => {
    if (!scan) return;
    setRendering(true); setError(null);
    const values: Record<string, string> = {};
    for (const r of tokenRows) if (r.final !== '') values[r.token] = r.final;
    try {
      const fd = new FormData();
      fd.append('file', new Blob([scan.templateBytes]), scan.filename);
      fd.append('values', JSON.stringify(values));
      fd.append('format', format);
      const res = await fetch('/api/brief/render', { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Render failed');
      const blob = await res.blob();
      const base = scan.filename.replace(/\.pptx$/i, '');
      const ext = format === 'png' || format === 'jpg' ? `_${format}.zip`
                : format === 'pdf' ? '.pdf' : '.pptx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${base}_brief${ext}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) { setError(e.message); } finally { setRendering(false); }
  };

  return (
    <div style={{ marginTop: 12, padding: 14, background: '#222222', border: '1px solid #3a3a3a' }}>
      {!scan && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <p style={{ fontSize: 13, marginBottom: 12 }}>
            Drop a squadron .pptx with <code>{'{{token}}'}</code> placeholders.
          </p>
          <input ref={fileInputRef} type="file" accept=".pptx" id="brief-template-upload"
                 onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                 style={{ display: 'none' }} />
          <label htmlFor="brief-template-upload" style={{ ...btnSecondary, display: 'inline-block' }}>
            Upload template
          </label>
          <div style={{ marginTop: 10, fontSize: 11 }}>
            <a href="/api/brief/sample-template" download="mission_brief_template.pptx"
               style={{ color: '#4a8fd4' }}>Download starter template</a>
          </div>
        </div>
      )}
      {scan && (
        <>
          <div style={{ marginBottom: 10, fontSize: 13 }}>
            <strong>{scan.filename}</strong> — {scan.tokens.length} tokens
            <button onClick={() => setScan(null)} style={{ ...btnSecondary, marginLeft: 12 }}>Different file</button>
          </div>
          <table style={tableStyle}>
            <thead><tr><th style={th}>Token</th><th style={th}>Source</th><th style={th}>Value</th></tr></thead>
            <tbody>
              {tokenRows.map((r) => (
                <tr key={r.token}>
                  <td style={{ ...td, fontFamily: "'B612 Mono', monospace", fontSize: 11 }}>{r.token}</td>
                  <td style={{ ...td, fontSize: 11, color: '#aaaaaa' }}>
                    {r.isOverridden ? 'manual' : r.isAutoResolved ? 'auto'
                      : <span style={{ color: '#d9a050' }}>unmapped</span>}
                  </td>
                  <td style={td}>
                    <input style={cellInput} value={r.final}
                           onChange={(e) => setOverrides((o) => ({ ...o, [r.token]: e.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button onClick={handleRender} disabled={rendering} style={btnPrimary}>
              {rendering ? 'Rendering…' : 'Render & Download'}
            </button>
            <select value={format} onChange={(e) => setFormat(e.target.value as OutputFormat)}
                    disabled={rendering} style={selectStyle}>
              {(['pptx', 'pdf', 'png', 'jpg'] as OutputFormat[]).map((f) => (
                <option key={f} value={f} disabled={!availableFormats.includes(f)}>
                  {FORMAT_LABEL[f]}{!availableFormats.includes(f) ? ' (LibreOffice required)' : ''}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      {error && (
        <div style={{ marginTop: 10, padding: 8, background: '#3a1a1a',
                      border: '1px solid #d95050', color: '#d95050', fontSize: 12 }}>{error}</div>
      )}
    </div>
  );
}

/** Resolve {{tokens}} in custom-template mode against the mission store. */
function resolveCustomToken(token: string, s: ReturnType<typeof useMissionStore.getState>): string | null {
  const fmtZ = (sec?: number | null) => {
    if (sec == null || isNaN(sec)) return '';
    const h = Math.floor(sec / 3600) % 24, m = Math.floor((sec % 3600) / 60);
    return `${h.toString().padStart(2, '0')}${m.toString().padStart(2, '0')}Z`;
  };
  const fmtWind = (w?: { speed: number; dir: number }) => w
    ? `${Math.round(w.dir).toString().padStart(3, '0')}/${Math.round(w.speed * 1.94384)}kt` : '';
  const flights = s.groups.filter(isPlayerGroup);

  const direct: Record<string, () => string | null> = {
    'mission.theater':      () => s.theater ?? null,
    'mission.sortie':       () => s.overview?.sortie ?? null,
    'mission.name':         () => s.overview?.sortie ?? null,
    'mission.date':         () => s.overview?.date ?? null,
    'mission.time_zulu':    () => fmtZ(s.overview?.start_time) || null,
    'mission.description':  () => s.overview?.description ?? null,
    'mission.blue_task':    () => s.overview?.descriptionBlueTask ?? null,
    'mission.red_task':     () => s.overview?.descriptionRedTask ?? null,
    'weather.qnh_inhg':     () => s.overview?.weather?.qnh_inhg?.toFixed(2) ?? null,
    'weather.qnh_hpa':      () => s.overview?.weather?.qnh_hpa?.toString() ?? null,
    'weather.temp_c':       () => s.overview?.weather?.temperature_c?.toFixed(0) ?? null,
    'weather.wind_surface': () => fmtWind(s.overview?.weather?.wind?.atGround) || null,
    'weather.wind_2000':    () => fmtWind(s.overview?.weather?.wind?.at2000) || null,
    'weather.wind_8000':    () => fmtWind(s.overview?.weather?.wind?.at8000) || null,
    'weather.cloud_preset': () => s.overview?.weather?.clouds_preset ?? null,
    'weather.visibility_m': () => s.overview?.weather?.visibility_m?.toString() ?? null,
  };
  if (direct[token]) return direct[token]!();

  const m = token.match(/^flight\[(\d+)\]\.(.+)$/);
  if (!m) return null;
  const g = flights[parseInt(m[1], 10)];
  if (!g) return null;
  switch (m[2]) {
    case 'callsign':   return g.units[0]?.name ?? g.groupName;
    case 'name':       return g.groupName;
    case 'aircraft':   return g.units[0]?.type ?? null;
    case 'count':      return g.units.length.toString();
    case 'frequency':  return g.frequency ? (g.frequency / 1_000_000).toFixed(3) : null;
    case 'tacan':      return g.tacan ? `${g.tacan.channel}${g.tacan.band}` : null;
    case 'tacan_call': return g.tacan?.callsign ?? null;
    case 'icls':       return g.icls?.channel?.toString() ?? null;
    case 'coalition':  return g.coalition;
    case 'country':    return g.country;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Reusable bits
// ---------------------------------------------------------------------------

function Card({ title, children, right }:
              { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14, background: '#222222', border: '1px solid #3a3a3a' }}>
      <div style={{
        padding: '8px 14px', borderBottom: '1px solid #3a3a3a',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#262626',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#ffa500',
                      letterSpacing: 1, textTransform: 'uppercase' }}>{title}</div>
        {right}
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 11, color: '#aaaaaa' }}>
      <div style={{ marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#1a1a1a', border: '1px solid #4a4a4a',
  color: '#e0e0e0', padding: '6px 8px', fontSize: 13, fontFamily: 'inherit',
};
const textareaStyle: React.CSSProperties = {
  width: '100%', background: '#1a1a1a', border: '1px solid #4a4a4a',
  color: '#e0e0e0', padding: 8, fontSize: 13, fontFamily: 'inherit',
  resize: 'vertical', lineHeight: 1.5,
};
const selectStyle: React.CSSProperties = {
  background: '#2a2a2a', border: '1px solid #4a4a4a', color: '#e0e0e0',
  padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
};
const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse',
};
const th: React.CSSProperties = {
  padding: '6px 8px', textAlign: 'left', fontSize: 11, color: '#cccccc',
  borderBottom: '1px solid #4a4a4a', textTransform: 'uppercase', letterSpacing: 0.5,
};
const td: React.CSSProperties = { padding: '3px 4px', verticalAlign: 'middle' };
const cellInput: React.CSSProperties = {
  width: '100%', background: '#1a1a1a', border: '1px solid #3a3a3a',
  color: '#e0e0e0', padding: '4px 6px', fontSize: 12, fontFamily: 'inherit',
};
const btnPrimary: React.CSSProperties = {
  background: '#2a2a2a', border: '1px solid #ffa500', color: '#ffa500',
  padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit',
};
const btnSecondary: React.CSSProperties = {
  background: 'transparent', border: '1px solid #4a4a4a', color: '#cccccc',
  padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
};
const btnDanger: React.CSSProperties = {
  background: 'transparent', border: '1px solid #5a3a3a', color: '#d95050',
  padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
};
const btnSmall: React.CSSProperties = {
  background: '#2a2a2a', border: '1px solid #4a4a4a', color: '#cccccc',
  padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
};
const btnIcon: React.CSSProperties = {
  background: 'transparent', border: '1px solid transparent', color: '#888888',
  padding: '2px 6px', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
};
const emptyStyle: React.CSSProperties = {
  fontStyle: 'italic', color: '#888888', fontSize: 13, padding: '6px 0',
};
