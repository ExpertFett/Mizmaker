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
import { useSopStore } from '../../sop/sopStore';
import { useGoalsStore, type GoalSide } from '../../store/goalsStore';
import { useDmpiStore } from '../../store/dmpiStore';
import { formatLatLon } from '../../utils/conversions';
import { isPlayerGroup } from '../../utils/groups';
import { useAiStore } from '../../ai/aiStore';
import { generateCommandersIntent } from '../../ai/commandersIntent';
import { AiSettingsPanel } from '../../panels/AiSettingsPanel';

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
  logo_base64: string;
  cover_image_base64: string;
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

  // AI integration — BYOK Anthropic/Gemini. We read the active
  // provider's key + model from aiStore; if empty, the AI button
  // opens AiSettingsPanel instead of attempting a doomed call.
  const aiProvider = useAiStore((s) => s.provider);
  const aiKey = useAiStore((s) =>
    s.provider === 'anthropic' ? s.anthropicKey : s.geminiKey,
  );
  const aiModel = useAiStore((s) =>
    s.provider === 'anthropic' ? s.anthropicModel : s.geminiModel,
  );
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  /** Last successful AI generation note for the toast under the
   *  intent card — model + token count, ephemeral. Cleared when the
   *  user edits the field or rebuilds the brief. */
  const [aiNote, setAiNote] = useState<string | null>(null);
  /** Optional free-text steer the user can add before clicking the
   *  AI button. Empty by default; rendered in a small input above
   *  the textarea on the Commander's Intent card. */
  const [aiSteer, setAiSteer] = useState('');

  // Inline preview pane state. Slides come from the server as base64 PNGs
  // rendered via LibreOffice → pypdfium2. Empty until user clicks Preview.
  // Edits don't auto-refresh — user clicks Refresh after a batch of edits
  // to avoid burning CPU on every keystroke.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSlides, setPreviewSlides] = useState<string[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);

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
    // Rebuilding from mission wipes any AI-generated intent — the new
    // brief will come back with the templated placeholder. Clear the
    // note + steer so the UI reflects the reset state honestly.
    setAiNote(null);
    setAiSteer('');
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

  const handlePreview = async () => {
    if (!brief) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/brief/preview-wing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, dpi: 100 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Preview failed' }));
        if (err.needs_libreoffice) {
          throw new Error('Preview requires LibreOffice on the server. ' +
            'Locally: install it and restart the backend. ' +
            'Production: should be installed via Dockerfile.');
        }
        throw new Error(err.error || 'Preview failed');
      }
      const data = await res.json();
      setPreviewSlides(data.slides || []);
      setPreviewIdx(0);
    } catch (e: any) {
      setError(e.message);
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
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

  const handleRenderPackage = async () => {
    if (!brief || !sessionId) return;
    // Package render only supports pptx/pdf right now (per-slide image
    // packs would need nested-zip handling we haven't built).
    const pkgFormat: 'pptx' | 'pdf' = format === 'pdf' ? 'pdf' : 'pptx';
    setRendering(true); setError(null);
    try {
      // Step 1: build the package — backend produces wing + flight briefs
      // from current session state. We send the user's edited wing brief
      // verbatim and let the backend regenerate flight briefs each call
      // (flights aren't yet editable, so they're always fresh from .miz).
      const buildRes = await fetch('/api/brief/build-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!buildRes.ok) {
        const err = await buildRes.json().catch(() => ({ error: 'Build failed' }));
        throw new Error(err.error || 'Package build failed');
      }
      const pkg = await buildRes.json();
      // Override the auto-built wing with the user's edited one
      pkg.wing = brief;

      // Step 2: render the whole package as a ZIP
      const renderRes = await fetch('/api/brief/render-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wing: pkg.wing, flights: pkg.flights, format: pkgFormat }),
      });
      if (!renderRes.ok) {
        const err = await renderRes.json().catch(() => ({ error: 'Render failed' }));
        throw new Error(err.error || 'Package render failed');
      }
      const blob = await renderRes.blob();
      const safe = (brief.mission_name || 'brief').replace(/[/\\]/g, '_');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safe}_brief_package_${pkgFormat}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRendering(false);
    }
  };

  // AI: regenerate Commander's Intent --------------------------------------
  // Reads the current scenario / flights / threats from the in-editor brief,
  // ships them to the active provider with the structured-intent prompt,
  // and drops the result into brief.commanders_intent. The user can edit
  // the textarea afterward exactly like the templated placeholder.
  const handleAiIntent = async () => {
    if (!brief) return;
    if (!aiKey) {
      setAiOpen(true);
      return;
    }
    setAiBusy(true);
    setError(null);
    setAiNote(null);
    try {
      const result = await generateCommandersIntent(aiProvider, aiKey, aiModel, {
        mission_name: brief.mission_name,
        theater: brief.theater,
        date: brief.date,
        time_zulu: brief.time_zulu,
        scenario: brief.scenario,
        threats: brief.threats,
        flights: brief.flights,
        userSteer: aiSteer,
      });
      setBrief((b) => (b ? { ...b, commanders_intent: result.text } : null));
      setAiNote(
        `Generated via ${result.model} · ${result.usage.input_tokens} in / ${result.usage.output_tokens} out tokens.`,
      );
    } catch (e: any) {
      setError(`AI intent generation failed: ${e.message}`);
    } finally {
      setAiBusy(false);
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
              title="Download just the wing brief in the selected format"
            >
              {rendering ? 'Rendering…' : 'Wing Brief'}
            </button>
            <button
              onClick={handleRenderPackage}
              disabled={rendering || (format !== 'pptx' && format !== 'pdf')}
              style={{ ...btnPrimary, opacity: rendering ? 0.5 : 1 }}
              title="Download wing brief + one brief per blue flight as a single .zip (pptx or pdf only)"
            >
              {rendering ? 'Rendering…' : 'Wing + Flights (.zip)'}
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
            <button
              onClick={handlePreview}
              disabled={previewLoading}
              style={{
                ...btnSecondary,
                borderColor: previewOpen ? '#ffa500' : '#4a4a4a',
                color: previewOpen ? '#ffa500' : '#cccccc',
              }}
              title="Render the brief as PNGs and show inline (~5s)"
            >
              {previewLoading ? 'Rendering…' : previewOpen ? '↻ Refresh Preview' : 'Preview'}
            </button>
            <span style={{ flex: 1 }} />
            <button onClick={() => setBrief(null)} style={btnDanger}>Discard</button>
          </div>

          {/* Preview pane — inline slide viewer with prev/next nav */}
          {previewOpen && (
            <div style={{
              marginBottom: 16, background: '#1a1a1a',
              border: '1px solid #3a3a3a',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', background: '#262626',
                borderBottom: '1px solid #3a3a3a',
              }}>
                <div style={{ fontSize: 11, color: '#ffa500', fontWeight: 600,
                              letterSpacing: 1, textTransform: 'uppercase' }}>
                  Preview
                </div>
                <span style={{ fontSize: 12, color: '#aaaaaa' }}>
                  {previewSlides.length > 0
                    ? `Slide ${previewIdx + 1} / ${previewSlides.length}`
                    : previewLoading ? 'Rendering…' : 'No slides'}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))}
                  disabled={previewIdx === 0 || previewLoading}
                  style={{ ...btnSmall, opacity: previewIdx === 0 ? 0.4 : 1 }}
                >‹ Prev</button>
                <button
                  onClick={() => setPreviewIdx((i) =>
                    Math.min(previewSlides.length - 1, i + 1))}
                  disabled={previewIdx >= previewSlides.length - 1 || previewLoading}
                  style={{ ...btnSmall,
                           opacity: previewIdx >= previewSlides.length - 1 ? 0.4 : 1 }}
                >Next ›</button>
                <button onClick={() => setPreviewOpen(false)} style={btnSmall}>
                  Close
                </button>
              </div>
              <div style={{
                padding: 12, display: 'flex', justifyContent: 'center',
                background: '#0f0f0f', minHeight: 360,
              }}>
                {previewLoading && previewSlides.length === 0 ? (
                  <div style={{ color: '#aaaaaa', fontSize: 14, padding: 60 }}>
                    Rendering brief… (~5s)
                  </div>
                ) : previewSlides[previewIdx] ? (
                  <img
                    src={`data:image/png;base64,${previewSlides[previewIdx]}`}
                    alt={`slide ${previewIdx + 1}`}
                    style={{
                      maxWidth: '100%', maxHeight: 600,
                      objectFit: 'contain',
                      boxShadow: '0 0 0 1px #3a3a3a',
                    }}
                    onClick={() => setPreviewIdx((i) =>
                      i + 1 < previewSlides.length ? i + 1 : 0)}
                  />
                ) : (
                  <div style={{ color: '#888', fontSize: 13, padding: 60 }}>
                    No slides to display.
                  </div>
                )}
              </div>
              {previewSlides.length > 0 && !previewLoading && (
                <div style={{
                  padding: '6px 10px', borderTop: '1px solid #3a3a3a',
                  fontSize: 11, color: '#888888',
                }}>
                  Click slide or hit Next ›  ·  Edit any section then ↻ Refresh Preview
                </div>
              )}
            </div>
          )}

          {/* Header card — mission name / date / time + logo */}
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

            {/* Cover image + squadron logo — both render on the cover slide.
                Cover image fills the upper half of the slide; logo overlays
                top-right. Both optional. */}
            <div style={{ marginTop: 14, display: 'grid',
                          gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <ImageUploadField
                label="Cover image (optional)"
                hint="Theater shot, mission area, squadron art — fills the top of the cover slide"
                inputId="brief-cover-image-input"
                value={brief.cover_image_base64}
                onChange={(b64) => set('cover_image_base64', b64)}
                onError={setError}
                previewAspect="wide"
              />
              <ImageUploadField
                label="Squadron logo (optional)"
                hint="Top-right corner of the cover slide"
                inputId="brief-logo-input"
                value={brief.logo_base64}
                onChange={(b64) => set('logo_base64', b64)}
                onError={setError}
                previewAspect="square"
              />
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

          <Card
            title="Commander's Intent"
            right={
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  onClick={handleAiIntent}
                  disabled={aiBusy}
                  style={{
                    ...btnSmall,
                    background: aiKey ? '#2a2418' : '#2a2a2a',
                    borderColor: aiKey ? '#ffa500' : '#4a4a4a',
                    color: aiKey ? '#ffa500' : '#cccccc',
                    opacity: aiBusy ? 0.6 : 1,
                  }}
                  title={
                    aiKey
                      ? `Generate via ${aiProvider} (${aiModel}). Uses your BYOK key.`
                      : 'No AI key configured. Click to open AI Settings.'
                  }
                >
                  {aiBusy
                    ? 'Thinking…'
                    : aiKey
                      ? '✨ Generate with AI'
                      : '✨ Set up AI'}
                </button>
              </div>
            }
          >
            {/* Optional steer — tucked above the textarea. Most users
                will leave this blank; advanced users (training-flight
                designers) can drop a sentence like "stress IFF
                discipline" or "make it sound like a maintenance OPS
                run". Cleared on Rebuild from mission. */}
            {aiKey && (
              <div style={{ marginBottom: 8 }}>
                <div style={{
                  fontSize: 10, color: '#888888', marginBottom: 3,
                  textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  Optional steer (passed to AI on Generate)
                </div>
                <input
                  style={{ ...inputStyle, fontSize: 12 }}
                  value={aiSteer}
                  onChange={(e) => setAiSteer(e.target.value)}
                  placeholder='e.g. "emphasise SEAD flow", "training mission tone"'
                />
              </div>
            )}
            <textarea
              style={textareaStyle}
              rows={6}
              value={brief.commanders_intent}
              onChange={(e) => {
                set('commanders_intent', e.target.value);
                setAiNote(null);
              }}
            />
            {aiNote && (
              <div style={{
                marginTop: 6, fontSize: 11, color: '#ffa500',
                fontFamily: "'B612 Mono', monospace",
              }}>
                {aiNote}
              </div>
            )}
            {!aiKey && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#888888' }}>
                Bring your own Anthropic or Gemini key to auto-generate
                a tailored intent. Without a key the templated starter
                above stays — fully editable.
              </div>
            )}
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

      {/* BYOK AI settings — opened when the user clicks the ✨ button
          with no key configured. Lives outside the brief-editor block so
          it's available even before the user has built a brief. */}
      <AiSettingsPanel open={aiOpen} onClose={() => setAiOpen(false)} />
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
  // Rebuild stamp — bumped when the user hits the Rebuild button.
  // The token-resolution useMemo below depends on it, so a click
  // forces tokens to re-resolve against the current mission state.
  // Useful if the user edited something (loadout, freq, callsign)
  // in another tab and wants to confirm the briefing is fresh.
  const [rebuildAt, setRebuildAt] = useState(() => Date.now());

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
    // `rebuildAt` is here on purpose: clicking Rebuild bumps it,
    // forcing this memo to recompute even if the store reference
    // looks unchanged (e.g. for token resolution that pulls from
    // useGoalsStore / useDmpiStore via getState() — those reads
    // bypass the missionStore deps).
  }, [scan, store, overrides, rebuildAt]);

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
          <div style={{ marginBottom: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <strong>{scan.filename}</strong>
            <span style={{ color: '#aaaaaa' }}>— {scan.tokens.length} tokens</span>
            <button onClick={() => setScan(null)} style={{ ...btnSecondary }}>Different file</button>
            {/* Rebuild + last-built stamp. Tokens auto-update when the
                mission store changes, but cross-store reads (goals,
                DMPIs, SOP) need the explicit nudge — clicking forces
                a full re-resolution against the current state. */}
            <button
              onClick={() => setRebuildAt(Date.now())}
              style={{ ...btnSecondary, marginLeft: 'auto' }}
              title="Re-resolve tokens against the current mission state"
            >
              ↻ Rebuild
            </button>
            <span style={{ color: '#888', fontSize: 11 }}>
              Last built:{' '}
              <span style={{ color: '#cccccc', fontFamily: "'B612 Mono', monospace" }}>
                {new Date(rebuildAt).toLocaleTimeString()}
              </span>
            </span>
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

  // Active SOP — read once at token-resolve time. resolveCustomToken
  // is called many times per template render so the lookup must be
  // cheap; useSopStore.getState() is just a property read.
  const sopState = useSopStore.getState();
  const activeSop = sopState.activeId
    ? sopState.sops.find((x) => x.id === sopState.activeId) || null
    : null;

  // Mission goals — same cheap getState() pattern. Format as a
  // bullet list per side. Empty list returns null so a missing-side
  // token renders as the literal "{goals.red}" rather than a blank
  // line, alerting the template designer.
  const goals = useGoalsStore.getState().goals;
  const formatGoalsForSide = (side: GoalSide | 'any'): string | null => {
    const filtered = goals.filter(
      side === 'any' ? () => true : (g) => g.side === side || g.side === 'all',
    );
    if (filtered.length === 0) return null;
    return filtered.map((g) => {
      const pts = g.points > 0 ? ` (${g.points}pt)` : '';
      return `• ${g.text}${pts}`;
    }).join('\n');
  };

  // DMPIs — same pattern. Filter blank-name placeholders so the
  // template doesn't render "DMPI 3 - 0.000 / 0.000" lines for
  // un-set rows.
  const dmpis = useDmpiStore.getState().dmpis.filter(
    (d) => d.name.trim().length > 0 && (d.lat !== 0 || d.lon !== 0),
  );
  const formatDmpiList = (mode: 'full' | 'names' | 'coords'): string | null => {
    if (dmpis.length === 0) return null;
    if (mode === 'names') return dmpis.map((d) => d.name).join(', ');
    if (mode === 'coords') {
      return dmpis.map((d) => formatLatLon(d.lat, d.lon)).join('\n');
    }
    // 'full' — bullet list with coords + weapon delivery if set
    return dmpis.map((d) => {
      const coord = formatLatLon(d.lat, d.lon);
      const wd = d.weaponDelivery ? ` [${d.weaponDelivery}]` : '';
      const desc = d.description ? ` — ${d.description}` : '';
      return `• ${d.name}${wd}: ${coord}${desc}`;
    }).join('\n');
  };

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
    // SOP tokens — let squadrons embed their SOP-defined values
    // directly in custom .pptx templates.
    'sop.name':             () => activeSop?.name ?? null,
    'sop.squadron':         () => activeSop?.squadron ?? null,
    'sop.notes':             () => activeSop?.notes ?? null,
    'sop.laser_base':       () => activeSop?.laserCodeBase?.toString() ?? null,
    'sop.tanker.callsigns': () => activeSop?.tankers?.map((t) => t.callsign).filter(Boolean).join(', ') || null,
    'sop.flight.callsigns': () => activeSop?.flights.map((f) => f.callsign).filter(Boolean).join(', ') || null,
    'sop.guard_freq':       () => {
      const guard = activeSop?.comms.find((c) => /guard/i.test(c.role));
      return guard?.frequency.toFixed(3) ?? null;
    },
    // Mission goals tokens — bullet-listed objectives by side. {goals.all}
    // emits every goal regardless of side; {goals.blue} / {goals.red} /
    // {goals.neutral} include side-specific PLUS goals tagged 'all'.
    'goals.all':       () => formatGoalsForSide('any'),
    'goals.blue':      () => formatGoalsForSide('blue'),
    'goals.red':       () => formatGoalsForSide('red'),
    'goals.neutral':   () => formatGoalsForSide('neutral'),
    'goals.count':     () => goals.length > 0 ? String(goals.length) : null,
    'goals.points':    () => {
      const total = goals.reduce((sum, g) => sum + (g.points || 0), 0);
      return total > 0 ? String(total) : null;
    },
    // DMPI tokens (v0.9.16) — bullet-listed targets with coords.
    // {dmpis.list} = full bullet list with coords + weapon + desc.
    // {dmpis.names} = comma-separated names. {dmpis.coords} = stacked
    // coords only (handy for a "TARGETS" column on a kneeboard).
    'dmpis.list':      () => formatDmpiList('full'),
    'dmpis.names':     () => formatDmpiList('names'),
    'dmpis.coords':    () => formatDmpiList('coords'),
    'dmpis.count':     () => dmpis.length > 0 ? String(dmpis.length) : null,
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

/**
 * Reusable image-upload control used on the Cover card. Reads PNG/JPG/
 * WEBP up to 2MB into base64 (sans data: prefix) and shows a preview
 * at either square (logo) or wide (cover) aspect.
 */
function ImageUploadField(props: {
  label: string;
  hint?: string;
  inputId: string;
  value: string;
  onChange: (b64: string) => void;
  onError: (msg: string | null) => void;
  previewAspect: 'square' | 'wide';
}) {
  const { label, hint, inputId, value, onChange, onError, previewAspect } = props;
  return (
    <div>
      <div style={{ fontSize: 11, color: '#aaaaaa', marginBottom: 3,
                    textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: '#888888', marginBottom: 6 }}>
          {hint}
        </div>
      )}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        id={inputId}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          // 4MB cap for cover (it's a hero) — 2MB for logo. Cover gets a
          // looser cap because file dimensions matter more than logo's do.
          const limit = previewAspect === 'wide' ? 4 * 1024 * 1024 : 2 * 1024 * 1024;
          if (file.size > limit) {
            onError(`Image must be under ${limit / 1024 / 1024}MB.`);
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const b64 = result.includes(',') ? result.split(',')[1] : result;
            onChange(b64);
            onError(null);
          };
          reader.readAsDataURL(file);
        }}
      />
      {value ? (
        <div>
          <div style={{
            width: '100%',
            aspectRatio: previewAspect === 'wide' ? '16 / 9' : '1 / 1',
            background: '#0f0f0f', border: '1px solid #3a3a3a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 6, overflow: 'hidden',
          }}>
            <img
              src={`data:image/png;base64,${value}`}
              alt={`${label} preview`}
              style={{ width: '100%', height: '100%',
                       objectFit: previewAspect === 'wide' ? 'cover' : 'contain' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <label htmlFor={inputId} style={{ ...btnSecondary, display: 'inline-block', flex: 1, textAlign: 'center' }}>
              Replace
            </label>
            <button onClick={() => onChange('')} style={btnDanger}>Remove</button>
          </div>
        </div>
      ) : (
        <label htmlFor={inputId} style={{
          ...btnSecondary, display: 'block',
          textAlign: 'center', padding: '20px 12px',
          border: '1px dashed #4a4a4a',
        }}>
          Upload image
        </label>
      )}
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
