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
import type { SOP } from '../../sop/types';
import { useGoalsStore, type GoalSide } from '../../store/goalsStore';
import { useDmpiStore } from '../../store/dmpiStore';
import { formatLatLon } from '../../utils/conversions';
import { isPlayerGroup } from '../../utils/groups';
import { captureRouteImage, captureOverviewImage } from '../../kneeboard/captureRoute';
import { useAiStore } from '../../ai/aiStore';
import { generateCommandersIntent } from '../../ai/commandersIntent';
import { generateThreatNarrative } from '../../ai/threatNarrative';
import { generateFullBrief } from '../../ai/briefWriter';
import { AiSettingsPanel } from '../../panels/AiSettingsPanel';

// ---------------------------------------------------------------------------
// Types — mirror services/brief_builder.py WingBrief shape
// ---------------------------------------------------------------------------

interface TimelineRow { phase: string; time_zulu: string; note: string }
interface FlightRow { callsign: string; aircraft: string; count: number; role: string;
                      frequency: string; tacan: string; home_plate: string }
interface ThreatRow { name: string; type: string; coalition: string; range_km: number; location: string }
interface AirThreatRow { composition: string; airframe_class: string; weapons: string; notes: string; coalition?: string }
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
  threat_narrative: string;
  mission_flow: string;
  notes: string;
  timeline: TimelineRow[];
  threats: ThreatRow[];
  air_threats: AirThreatRow[];
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

  // Per-flight brief editor (v1.13.x). Loaded on demand from the mission
  // (build-package); when present, the package render uses THESE edited
  // flights instead of regenerating fresh from the .miz. Each is a plain
  // FlightBrief dict — we keep all server fields ([k]:any) and only surface
  // tasking / fuel / notes for editing; route/timeline stay auto.
  const [flightBriefs, setFlightBriefs] = useState<Record<string, any>[] | null>(null);
  const [loadingFlights, setLoadingFlights] = useState(false);
  const loadFlights = async () => {
    if (!sessionId) return;
    setLoadingFlights(true); setError(null);
    try {
      const res = await fetch('/api/brief/build-package', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load flights');
      const pkg = await res.json();
      setFlightBriefs(pkg.flights || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoadingFlights(false); }
  };
  const updateFlight = (i: number, patch: Record<string, any>) =>
    setFlightBriefs((prev) => (prev ? prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) : prev));

  // Wing/cover overview map: all flight tracks + threat rings on one image,
  // rendered client-side and attached to the wing brief as route_overview_base64
  // (placed on a ROUTE OVERVIEW slide by the backend). Best-effort — never blocks.
  const buildOverviewMap = async (): Promise<string> => {
    try {
      const st = useMissionStore.getState();
      const url = await captureOverviewImage(st.groups, st.threats);
      return url.split(',')[1] || '';
    } catch { return ''; }
  };

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
  /** Busy + result-note state for the "Generate Full Brief" action
   *  (writes scenario + intent + mission flow + notes from the story). */
  const [aiFullBusy, setAiFullBusy] = useState(false);
  const [aiFullNote, setAiFullNote] = useState<string | null>(null);
  /** Last successful AI generation note for the toast under the
   *  intent card — model + token count, ephemeral. Cleared when the
   *  user edits the field or rebuilds the brief. */
  const [aiNote, setAiNote] = useState<string | null>(null);
  /** Optional free-text steer the user can add before clicking the
   *  AI button. Empty by default; rendered in a small input above
   *  the textarea on the Commander's Intent card. */
  const [aiSteer, setAiSteer] = useState('');
  /** The mission maker's own narrative of the story — feeds the AI
   *  as the PRIMARY context for commander's intent (and future AI
   *  features). Lives in its own card above the AI button so the
   *  user understands "type story here → AI uses it". Not part of the
   *  WingBrief object — this is AI context, not brief content. The
   *  scenario card below remains the slide-displayed prose. Cleared
   *  on Rebuild from mission. */
  const [missionStory, setMissionStory] = useState('');

  // Inline preview pane state. Slides come from the server as base64 PNGs
  // rendered via LibreOffice → pypdfium2. Empty until user clicks Preview.
  // Edits don't auto-refresh — user clicks Refresh after a batch of edits
  // to avoid burning CPU on every keystroke.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSlides, setPreviewSlides] = useState<string[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Base template (.pptx) for the MAIN brief (v0.9.79). When set, the
  // auto-built brief renders ON this template — the template's own
  // slide(s) + theme become the cover/branding, content slides follow.
  // base64, no data: prefix. Threaded into preview/render calls.
  const [templateB64, setTemplateB64] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  // Content top-margin (inches) — pushes brief content below the
  // template's branded header band so section titles don't collide with
  // logos. Only relevant when a template is attached. (v0.9.81)
  const [templateTopMargin, setTemplateTopMargin] = useState(1.2);

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
    // notes + steer so the UI reflects the reset state honestly.
    setAiNote(null);
    setAiFullNote(null);
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
      const data = await res.json() as WingBrief;
      // Auto-fill the standard comm-card slots (GCI / AAR / Tower / Approach /
      // Guard) from the active SOP; slots with no SOP match show a clean dash
      // instead of the backend's literal "edit — ..." prompt. The planner can
      // still override any row in the editable Comms section below. (v0.9.99)
      const sopState = useSopStore.getState();
      const activeSop = sopState.activeId
        ? sopState.sops.find((x) => x.id === sopState.activeId) || null
        : null;
      setBrief({ ...data, comms: fillCommsFromSop(data.comms, activeSop) });
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
        body: JSON.stringify({ brief, dpi: 100, template: templateB64, top_margin: templateB64 ? templateTopMargin : undefined }),
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
      const route_overview_base64 = await buildOverviewMap();
      const res = await fetch('/api/brief/render-wing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: { ...brief, route_overview_base64 }, format, template: templateB64, top_margin: templateB64 ? templateTopMargin : undefined }),
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
      // Use the user's EDITED per-flight briefs if they loaded them; otherwise
      // the freshly-built ones. Either way `flights` is what we map + render.
      const flights: Record<string, any>[] = (flightBriefs && flightBriefs.length)
        ? flightBriefs : (pkg.flights || []);

      // Step 1b: render a per-flight route map (client-side OL snapshot) and
      // attach it so each flight brief gets a ROUTE MAP slide. Match each
      // flight back to its mission group by group_name (fallback: callsign).
      // Best-effort — a flight with no coords/group just skips its map.
      try {
        const groups = useMissionStore.getState().groups;
        for (const fl of flights) {
          const grp = groups.find((g) => g.groupName === fl.group_name)
            || groups.find((g) => (g.units?.[0]?.name || g.groupName) === fl.callsign);
          if (!grp) continue;
          try {
            const dataUrl = await captureRouteImage(grp);
            fl.route_map_base64 = dataUrl.split(',')[1] || '';
          } catch { /* no waypoints / capture failed — skip this flight's map */ }
        }
      } catch { /* maps are optional; never block the render */ }

      // Step 1c: wing/cover overview map (all flight tracks + threat rings).
      const route_overview_base64 = await buildOverviewMap();

      // Step 2: render the whole package as a ZIP
      const renderRes = await fetch('/api/brief/render-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wing: { ...pkg.wing, route_overview_base64 }, flights, format: pkgFormat, template: templateB64, top_margin: templateB64 ? templateTopMargin : undefined }),
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
        missionStory,
        threats: brief.threats,
        flights: brief.flights,
        // v1.16.x — "smarter intent": surface air picture + theatre overview so
        // the model has CAP/DCA context and the geographic framing.
        air_threats: brief.air_threats,
        theatre_overview: brief.theatre_overview,
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

  // AI: regenerate Threat Brief paragraph ------------------------------------
  // Short 2-4 sentence threat prose for the THREAT BRIEF slide (v1.15.x).
  const [aiThreatBusy, setAiThreatBusy] = useState(false);
  const [aiThreatNote, setAiThreatNote] = useState<string | null>(null);
  const handleAiThreatNarrative = async () => {
    if (!brief) return;
    if (!aiKey) { setAiOpen(true); return; }
    setAiThreatBusy(true); setError(null); setAiThreatNote(null);
    try {
      const result = await generateThreatNarrative(aiProvider, aiKey, aiModel, {
        mission_name: brief.mission_name,
        theater: brief.theater,
        flights: brief.flights as any,
        threats: brief.threats as any,
        air_threats: brief.air_threats as any,
        playerCoalition: brief.coalition,
      });
      setBrief((b) => (b ? { ...b, threat_narrative: result.text } : null));
      setAiThreatNote(`Generated via ${result.model} · ${result.usage.input_tokens} in / ${result.usage.output_tokens} out tokens.`);
    } catch (e: any) {
      setError(`AI threat narrative failed: ${e.message}`);
    } finally {
      setAiThreatBusy(false);
    }
  };

  // AI: write the WHOLE brief from the mission story -----------------------
  // Fills scenario + commander's intent + mission flow + notes in one call.
  // Structured tables (flights/threats/comms/timeline) come from the .miz
  // and are left untouched; the cover + theatre overview are left as-is.
  const handleAiFullBrief = async () => {
    if (!brief) return;
    if (!aiKey) {
      setAiOpen(true);
      return;
    }
    setAiFullBusy(true);
    setError(null);
    setAiFullNote(null);
    setAiNote(null);
    try {
      const result = await generateFullBrief(aiProvider, aiKey, aiModel, {
        mission_name: brief.mission_name,
        theater: brief.theater,
        date: brief.date,
        time_zulu: brief.time_zulu,
        scenario: brief.scenario,
        missionStory,
        threats: brief.threats,
        flights: brief.flights,
        userSteer: aiSteer,
      });
      const s = result.sections;
      setBrief((b) => (b ? {
        ...b,
        // Only overwrite a section if the model produced text for it,
        // so a sparse response can't blank out an existing field.
        ...(s.scenario ? { scenario: s.scenario } : {}),
        ...(s.commanders_intent ? { commanders_intent: s.commanders_intent } : {}),
        ...(s.mission_flow ? { mission_flow: s.mission_flow } : {}),
        ...(s.notes ? { notes: s.notes } : {}),
      } : null));
      const filled = [
        s.scenario && 'Scenario',
        s.commanders_intent && "Commander's Intent",
        s.mission_flow && 'Mission Flow',
        s.notes && 'Notes',
      ].filter(Boolean).join(', ');
      setAiFullNote(
        `Wrote ${filled || 'nothing'} via ${result.model} · ${result.usage.input_tokens} in / ${result.usage.output_tokens} out tokens.`,
      );
    } catch (e: any) {
      setError(`AI full-brief generation failed: ${e.message}`);
    } finally {
      setAiFullBusy(false);
    }
  };

  // Brief mutators ----------------------------------------------------------
  function set<K extends keyof WingBrief>(key: K, value: WingBrief[K]) {
    setBrief((b) => (b ? { ...b, [key]: value } : null));
  }
  function setRow<F extends 'timeline' | 'threats' | 'air_threats' | 'flights' | 'comms'>(
    field: F, idx: number, row: WingBrief[F][number],
  ) {
    setBrief((b) => {
      if (!b) return null;
      const arr = [...b[field]] as WingBrief[F];
      (arr as any)[idx] = row;
      return { ...b, [field]: arr };
    });
  }
  function addRow<F extends 'timeline' | 'threats' | 'air_threats' | 'flights' | 'comms'>(field: F, blank: WingBrief[F][number]) {
    setBrief((b) => (b ? { ...b, [field]: [...b[field], blank] as WingBrief[F] } : null));
  }
  function removeRow<F extends 'timeline' | 'threats' | 'air_threats' | 'flights' | 'comms'>(field: F, idx: number) {
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
                borderColor: previewOpen ? '#fbb941' : '#4a4a4a',
                color: previewOpen ? '#fbb941' : '#cccccc',
              }}
              title="Render the brief as PNGs and show inline (~5s)"
            >
              {previewLoading ? 'Rendering…' : previewOpen ? '↻ Refresh Preview' : 'Preview'}
            </button>
            <span style={{ flex: 1 }} />
            <button onClick={() => setBrief(null)} style={btnDanger}>Discard</button>
          </div>

          {/* Base-template row (v0.9.79) — attach your squadron .pptx and
              the auto-built brief renders ON it: your template's slide(s)
              + theme become the cover/branding, the auto content follows.
              Affects Preview, Wing Brief, and Wing + Flights. */}
          <div style={{
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
            padding: '8px 14px', marginBottom: 16,
            background: templateB64 ? '#2a2418' : '#1a1a1a',
            border: `1px solid ${templateB64 ? '#4a3f1a' : '#3a3a3a'}`,
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: templateB64 ? '#fbb941' : '#aaaaaa' }}>
              Brief template
            </span>
            <input
              type="file"
              accept=".pptx"
              id="brief-base-template-input"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!file.name.toLowerCase().endsWith('.pptx')) {
                  setError('Template must be a .pptx file');
                  return;
                }
                try {
                  const buf = await file.arrayBuffer();
                  // ArrayBuffer → base64 (chunked to avoid call-stack limits)
                  const bytes = new Uint8Array(buf);
                  let bin = '';
                  const CH = 0x8000;
                  for (let i = 0; i < bytes.length; i += CH) {
                    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
                  }
                  setTemplateB64(btoa(bin));
                  setTemplateName(file.name);
                  setError(null);
                } catch {
                  setError('Could not read template file');
                }
              }}
            />
            {templateB64 ? (
              <>
                <span style={{ fontSize: 12, color: '#e0e0e0', fontFamily: "'B612 Mono', monospace" }}>
                  {templateName}
                </span>
                <span style={{ fontSize: 11, color: '#cccccc' }}>
                  — built on your template: cover + branding + theme. Text color
                  auto-adapts to your background.
                </span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#aaaaaa' }}
                       title="How far down content starts, in inches — raise it until section titles clear your template's header band / logos.">
                  Content top
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="4"
                    value={templateTopMargin}
                    onChange={(e) => setTemplateTopMargin(Math.max(0, Math.min(4, Number(e.target.value) || 0)))}
                    style={{ ...inputStyle, width: 56, fontSize: 12, padding: '4px 6px' }}
                  />
                  in
                </label>
                <label htmlFor="brief-base-template-input" style={{ ...btnSecondary, display: 'inline-block' }}>
                  Replace
                </label>
                <button onClick={() => { setTemplateB64(null); setTemplateName(null); }} style={btnDanger}>
                  Remove
                </button>
              </>
            ) : (
              <>
                <label htmlFor="brief-base-template-input" style={{ ...btnSecondary, display: 'inline-block' }}>
                  Upload .pptx
                </label>
                <span style={{ fontSize: 11, color: '#888888' }}>
                  Optional — without one, the brief uses the built-in dark template.
                  With one, the whole brief renders on your template's background +
                  branding (text color auto-adapts to light/dark); your cover slide(s)
                  lead the deck.
                </span>
              </>
            )}
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
                <div style={{ fontSize: 11, color: '#fbb941', fontWeight: 600,
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

          {/* Mission Story — the maker's own narrative of what's going
              on. Not rendered onto a slide; feeds the AI as the canonical
              context. The "Generate Full Brief" button writes the whole
              narrative (scenario + intent + flow + notes) from it. */}
          <Card
            title="Mission Story"
            right={
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {missionStory && (
                  <button
                    onClick={() => set('scenario', missionStory)}
                    style={btnSmall}
                    title="Copy this prose into the Scenario card above so it also renders on the brief slides"
                  >
                    Copy to Scenario
                  </button>
                )}
                <button
                  onClick={handleAiFullBrief}
                  disabled={aiFullBusy || aiBusy}
                  style={{
                    ...btnSmall,
                    background: aiKey ? '#2a2418' : '#2a2a2a',
                    borderColor: aiKey ? '#fbb941' : '#4a4a4a',
                    color: aiKey ? '#fbb941' : '#cccccc',
                    fontWeight: 600,
                    opacity: aiFullBusy ? 0.6 : 1,
                  }}
                  title={
                    aiKey
                      ? `Write the whole brief (Scenario, Commander's Intent, Mission Flow, Notes) from the story via ${aiProvider} (${aiModel}).`
                      : 'No AI key configured. Click to open AI Settings.'
                  }
                >
                  {aiFullBusy ? 'Writing brief…' : aiKey ? '✨ Generate Full Brief' : '✨ Set up AI'}
                </button>
              </div>
            }
          >
            <div style={{ fontSize: 11, color: '#aaaaaa', marginBottom: 6, lineHeight: 1.5 }}>
              Write a paragraph or two about what's happening in this
              mission — the situation, what the enemy is doing, what's
              at stake, what success looks like. <strong style={{ color: '#cccccc' }}>This text is
              not rendered on the brief slides</strong> — it's the
              context the AI uses. Hit <strong style={{ color: '#fbb941' }}>Generate Full Brief</strong>{' '}
              and the AI fills the Scenario, Commander's Intent, Mission
              Flow, and Notes sections from it (the flight / threat / comms
              tables stay as pulled from the .miz).
            </div>
            <textarea
              style={textareaStyle}
              rows={8}
              value={missionStory}
              onChange={(e) => setMissionStory(e.target.value)}
              placeholder={
                'Example: A Russian motor-rifle brigade has pushed across the ' +
                'cease-fire line into the Kobuleti valley overnight. Friendly ' +
                'ground forces are pinned at FOB Sentinel. Our package is the ' +
                'first sortie of the morning push — we need to crack the SA-11 ' +
                'belt north of Kobuleti so the strike package behind us can hit ' +
                'the brigade command post before they consolidate.'
              }
            />
            {aiFullNote && (
              <div style={{
                marginTop: 6, fontSize: 11, color: '#fbb941',
                fontFamily: "'B612 Mono', monospace",
              }}>
                {aiFullNote}
              </div>
            )}
            {error && error.startsWith('AI ') && (
              <div style={{
                marginTop: 6, padding: '6px 8px', fontSize: 11, color: '#d95050',
                border: '1px solid #d95050', lineHeight: 1.4,
              }}>
                {error}
              </div>
            )}
            {!aiKey && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#888888' }}>
                Bring your own Anthropic or Gemini key (AI Settings) to
                auto-write the brief from your story.
              </div>
            )}
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
                    borderColor: aiKey ? '#fbb941' : '#4a4a4a',
                    color: aiKey ? '#fbb941' : '#cccccc',
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
            {/* Visible warning when AI is configured but Mission Story
                is empty — that's the failure mode that produces
                generic / hallucinated output. Skipped when the user
                has the .miz scenario filled OR has typed in the
                story; either way the AI has real context to work
                with. */}
            {aiKey && !missionStory.trim() && (
              <div style={{
                marginBottom: 10, padding: '8px 10px',
                background: '#3a2a18', border: '1px solid #d9a050',
                color: '#d9a050', fontSize: 11, lineHeight: 1.5,
              }}>
                <strong>Heads up:</strong> the Mission Story box above
                is empty. The AI will fall back to flight-role +
                threat-list inference, which tends to produce generic
                output. Write a paragraph up there describing what's
                actually happening in your mission for a tailored
                Commander's Intent.
              </div>
            )}
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
                marginTop: 6, fontSize: 11, color: '#fbb941',
                fontFamily: "'B612 Mono', monospace",
              }}>
                {aiNote}
              </div>
            )}
            {error && error.startsWith('AI ') && (
              <div style={{
                marginTop: 6, padding: '6px 8px', fontSize: 11, color: '#d95050',
                border: '1px solid #d95050', lineHeight: 1.4,
              }}>
                {error}
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

          <Card
            title="Threat Brief (AI)"
            right={
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  onClick={handleAiThreatNarrative}
                  disabled={aiThreatBusy}
                  style={{
                    ...btnSmall,
                    background: aiKey ? '#2a2418' : '#2a2a2a',
                    borderColor: aiKey ? '#fbb941' : '#4a4a4a',
                    color: aiKey ? '#fbb941' : '#cccccc',
                    opacity: aiThreatBusy ? 0.6 : 1,
                  }}
                  title={aiKey
                    ? `Generate via ${aiProvider} (${aiModel}). Uses your BYOK key.`
                    : 'No AI key configured. Click to open AI Settings.'}
                >
                  {aiThreatBusy ? 'Thinking…' : aiKey ? '✨ Generate with AI' : '✨ Set up AI'}
                </button>
              </div>
            }
          >
            <textarea
              value={brief.threat_narrative || ''}
              onChange={(e) => { set('threat_narrative', e.target.value); setAiThreatNote(null); }}
              placeholder="2-4 sentence summary of the threat picture — dominant threat type, where it sits in the AO, recommended counter, priority targets. Renders above the threats table on its own brief slide."
              rows={4}
              style={{
                width: '100%', background: '#1a1a1a', border: '1px solid #3a3a3a', borderRadius: 4,
                color: '#e0e0e0', fontSize: 13, padding: '8px', fontFamily: 'inherit',
                lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            {aiThreatNote && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#fbb941', fontFamily: "'B612 Mono', monospace" }}>
                {aiThreatNote}
              </div>
            )}
            {!aiKey && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#888888' }}>
                Bring your own Anthropic or Gemini key to auto-generate the threat paragraph.
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

          <Card title="Air Threats" right={
            <button onClick={() => addRow('air_threats', { composition: '', airframe_class: '', weapons: '', notes: '', coalition: 'red' })}
                    style={btnSmall}>+ Add</button>
          }>
            {brief.air_threats.length === 0 ? (
              <p style={emptyStyle}>No enemy aircraft detected. Add manually if needed.</p>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr><th style={th}>Type</th><th style={th}>Class</th>
                      <th style={th}>Weapons</th><th style={th}>Notes</th><th style={th}></th></tr>
                </thead>
                <tbody>
                  {brief.air_threats.map((a, i) => (
                    <tr key={i}>
                      <td style={td}><input style={cellInput} value={a.composition}
                          onChange={(e) => setRow('air_threats', i, { ...a, composition: e.target.value })} /></td>
                      <td style={td}><input style={cellInput} value={a.airframe_class}
                          onChange={(e) => setRow('air_threats', i, { ...a, airframe_class: e.target.value })} /></td>
                      <td style={td}><input style={cellInput} value={a.weapons}
                          onChange={(e) => setRow('air_threats', i, { ...a, weapons: e.target.value })} /></td>
                      <td style={td}><input style={cellInput} value={a.notes}
                          onChange={(e) => setRow('air_threats', i, { ...a, notes: e.target.value })} /></td>
                      <td style={td}><button style={btnIcon}
                          onClick={() => removeRow('air_threats', i)} title="Delete row">×</button></td>
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

          <Card title="Per-Flight Briefs" right={
            <button onClick={loadFlights} disabled={loadingFlights || !sessionId} style={btnSmall}>
              {loadingFlights ? 'Loading…' : flightBriefs ? 'Reload from mission' : 'Load from mission'}
            </button>
          }>
            {!flightBriefs ? (
              <div style={{ fontSize: 13, color: '#aaa', padding: '2px 0', lineHeight: 1.5 }}>
                Load the player flights to edit each one's <b>tasking</b>, <b>fuel</b> (joker/bingo/RTB) and
                <b> notes</b> before render. Edits feed the per-flight brief slides; route &amp; timeline stay
                auto from the .miz. (If you don't load them, flights are auto-built as before.)
              </div>
            ) : flightBriefs.length === 0 ? (
              <div style={{ fontSize: 13, color: '#aaa' }}>No player flights found in this mission.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {flightBriefs.map((f, i) => (
                  <div key={i} style={{ border: '1px solid #3a3a3a', borderRadius: 4, padding: 10, background: '#1d1d1d' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: '#e8833a' }}>{f.callsign || `Flight ${i + 1}`}</span>
                      <span style={{ color: '#aaa', fontSize: 12 }}>{f.aircraft} · ×{f.count}{f.role ? ` · ${f.role}` : ''}</span>
                    </div>
                    <Field label="Tasking">
                      <textarea value={f.tasking || ''} onChange={(e) => updateFlight(i, { tasking: e.target.value })}
                        rows={3} style={flTextarea} />
                    </Field>
                    <div style={{ display: 'flex', gap: 12, margin: '8px 0' }}>
                      {([['fuel_joker_lbs', 'Joker'], ['fuel_bingo_lbs', 'Bingo'], ['fuel_rtb_lbs', 'RTB']] as const).map(([k, lbl]) => (
                        <Field key={k} label={`${lbl} (lbs)`}>
                          <input type="number" value={f[k] ?? 0}
                            onChange={(e) => updateFlight(i, { [k]: Number(e.target.value) })}
                            style={{ ...cellInput, width: 90 }} />
                        </Field>
                      ))}
                    </div>
                    <Field label="Notes">
                      <textarea value={f.notes || ''} onChange={(e) => updateFlight(i, { notes: e.target.value })}
                        rows={2} style={flTextarea} />
                    </Field>
                  </div>
                ))}
              </div>
            )}
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
  // Inline preview pane — renders the token-filled TEMPLATE to PNG slides
  // (was previously missing; the only "Preview" was the auto-build one,
  // which showed the auto brief, not the uploaded template). (v0.9.77)
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSlides, setPreviewSlides] = useState<string[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
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

  const buildValues = (): Record<string, string> => {
    const values: Record<string, string> = {};
    for (const r of tokenRows) if (r.final !== '') values[r.token] = r.final;
    return values;
  };

  const handleRender = async () => {
    if (!scan) return;
    setRendering(true); setError(null);
    const values = buildValues();
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

  const handlePreview = async () => {
    if (!scan) return;
    setPreviewOpen(true); setPreviewLoading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', new Blob([scan.templateBytes]), scan.filename);
      fd.append('values', JSON.stringify(buildValues()));
      fd.append('dpi', '100');
      const res = await fetch('/api/brief/preview-template', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Preview failed' }));
        if (err.needs_libreoffice) {
          throw new Error('Preview requires LibreOffice on the server. ' +
            'Production has it via the Dockerfile; local dev needs it installed.');
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
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
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
            <button
              onClick={handlePreview}
              disabled={previewLoading}
              style={{
                ...btnSecondary,
                borderColor: previewOpen ? '#fbb941' : '#4a4a4a',
                color: previewOpen ? '#fbb941' : '#cccccc',
              }}
              title="Render your template with the values above and show it inline (~5s)"
            >
              {previewLoading ? 'Rendering…' : previewOpen ? '↻ Refresh Preview' : 'Preview'}
            </button>
          </div>

          {/* Inline preview of the filled template */}
          {previewOpen && (
            <div style={{ marginTop: 12, background: '#1a1a1a', border: '1px solid #3a3a3a' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', background: '#262626', borderBottom: '1px solid #3a3a3a',
              }}>
                <div style={{ fontSize: 11, color: '#fbb941', fontWeight: 600,
                              letterSpacing: 1, textTransform: 'uppercase' }}>
                  Template Preview
                </div>
                <span style={{ fontSize: 12, color: '#aaaaaa' }}>
                  {previewSlides.length > 0
                    ? `Slide ${previewIdx + 1} / ${previewSlides.length}`
                    : previewLoading ? 'Rendering…' : 'No slides'}
                </span>
                <span style={{ flex: 1 }} />
                <button onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))}
                        disabled={previewIdx === 0 || previewLoading}
                        style={{ ...btnSmall, opacity: previewIdx === 0 ? 0.4 : 1 }}>‹ Prev</button>
                <button onClick={() => setPreviewIdx((i) => Math.min(previewSlides.length - 1, i + 1))}
                        disabled={previewIdx >= previewSlides.length - 1 || previewLoading}
                        style={{ ...btnSmall, opacity: previewIdx >= previewSlides.length - 1 ? 0.4 : 1 }}>Next ›</button>
                <button onClick={() => setPreviewOpen(false)} style={btnSmall}>Close</button>
              </div>
              <div style={{ padding: 12, display: 'flex', justifyContent: 'center',
                            background: '#0f0f0f', minHeight: 320 }}>
                {previewLoading && previewSlides.length === 0 ? (
                  <div style={{ color: '#aaaaaa', fontSize: 14, padding: 60 }}>
                    Rendering template… (~5s)
                  </div>
                ) : previewSlides[previewIdx] ? (
                  <img
                    src={`data:image/png;base64,${previewSlides[previewIdx]}`}
                    alt={`slide ${previewIdx + 1}`}
                    style={{ maxWidth: '100%', maxHeight: 560, objectFit: 'contain',
                             boxShadow: '0 0 0 1px #3a3a3a' }}
                    onClick={() => setPreviewIdx((i) => i + 1 < previewSlides.length ? i + 1 : 0)}
                  />
                ) : (
                  <div style={{ color: '#888', fontSize: 13, padding: 60 }}>No slides to display.</div>
                )}
              </div>
            </div>
          )}
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
// SOP comm-slot auto-fill
// ---------------------------------------------------------------------------

/** Fill the standard comm-card slots (GCI / AAR Boom / BTW Tower / Approach /
 *  Guard) from the active SOP's comms where a role keyword matches. Slots with
 *  no SOP match get a clean dash instead of the backend's literal "edit — ..."
 *  prompt, so an unfilled brief still looks finished. The planner can override
 *  any row in the editable Comms section. (v0.9.99) */
function fillCommsFromSop(comms: CommsRow[], sop: SOP | null): CommsRow[] {
  if (!comms) return comms;
  const fmt = (f?: number, m?: string): string | null =>
    f && f > 0 ? `${f.toFixed(3)} ${m ?? 'AM'}` : null;
  const commFor = (re: RegExp): string | null => {
    const c = sop?.comms.find((x) => x.role && re.test(x.role) && x.frequency > 0);
    return c ? fmt(c.frequency, c.modulation) : null;
  };
  const firstTanker = sop?.tankers?.find((t) => t.frequency && t.frequency > 0);
  const SLOT: Record<string, () => string | null> = {
    'GCI':       () => commFor(/gci|\bcontrol\b|intercept/i),
    'AAR Boom':  () => commFor(/aar|tanker|boom|refuel/i)
                       ?? fmt(firstTanker?.frequency, firstTanker?.modulation),
    'BTW Tower': () => commFor(/tower/i),
    'Approach':  () => commFor(/approach|departure/i),
  };
  return comms.map((r) => {
    const label = (r.label || '').trim();
    const slot = SLOT[label];
    if (slot) return { ...r, value: slot() ?? '—' };
    if (/^guard$/i.test(label)) {
      const g = commFor(/guard/i);
      return g ? { ...r, value: g } : r;  // else keep backend's 243.000 (UHF)
    }
    return r;
  });
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
        <div style={{ fontSize: 12, fontWeight: 600, color: '#fbb941',
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
const flTextarea: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#1a1a1a', border: '1px solid #3a3a3a',
  color: '#e0e0e0', padding: '6px 8px', fontSize: 13, fontFamily: 'inherit',
  borderRadius: 4, resize: 'vertical', lineHeight: 1.4,
};
const btnPrimary: React.CSSProperties = {
  background: '#2a2a2a', border: '1px solid #fbb941', color: '#fbb941',
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
