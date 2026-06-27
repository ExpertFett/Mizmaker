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

import { useState, useRef, useEffect, useMemo, useCallback, useContext, createContext } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { getEffectiveGroupsSnapshot } from '../../store/effectiveGroups';
import { useSopStore } from '../../sop/sopStore';
import type { SOP } from '../../sop/types';
import { useGoalsStore, type GoalSide } from '../../store/goalsStore';
import { useDmpiStore } from '../../store/dmpiStore';
import { useEditStore } from '../../store/editStore';
import { computePopupAttack, ATTACK_TYPE_LABEL, type PopupAttackInput } from '../../utils/popupAttack';
import { SampleCoversGallery } from '../../panels/SampleCoversGallery';
import { formatLatLon } from '../../utils/conversions';
import { isPlayerGroup } from '../../utils/groups';
import { captureRouteImage, captureOverviewImage } from '../../kneeboard/captureRoute';
import { useAiStore } from '../../ai/aiStore';
import { generateCommandersIntent } from '../../ai/commandersIntent';
import { generateThreatNarrative } from '../../ai/threatNarrative';
import { generateFullBrief } from '../../ai/briefWriter';
import { generateSpeakerNotes, speakerNotesToBriefMap } from '../../ai/speakerNotes';
import { generateTemplateMapping } from '../../ai/templateMapper';
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
  // v1.19.x BYOK extra: AI-generated speaker notes keyed by slide id
  // (cover, theatre, scenario, intent, threats, flights, comms,
  // mission_flow, timeline, notes, popup). Empty string for a key means
  // "no note" — the backend renderer skips empties.
  speaker_notes?: Record<string, string>;
  // v1.19.59 — Brief theme colours (squadron palette override). Hex
  // strings; missing keys fall through to renderer defaults.
  // Roles: bg / text / bright / accent / dim / border / header_bg / cell_bg.
  theme_colors?: Record<string, string>;
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

/** Slugify a card title into a stable DOM id (for collapse state + nav). */
function cardSlug(title: string): string {
  return title.toLowerCase().replace(/\(.*?\)/g, '').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Collapse state shared with the Card component without prop-drilling
 *  every <Card> usage (v1.19.84). */
const BriefCardCtx = createContext<{ collapsed: Set<string>; toggle: (id: string) => void } | null>(null);

/** Editor cards in render order — drives the jump-to-section nav rail.
 *  `title` must match each <Card>'s title so the slug ids line up. */
const NAV_SECTIONS: { title: string; short: string }[] = [
  { title: 'Slides (order & visibility)', short: 'Slides' },
  { title: 'Cover', short: 'Cover' },
  { title: 'Brief Colors (optional)', short: 'Colors' },
  { title: 'Theatre Overview', short: 'Theatre' },
  { title: 'Scenario', short: 'Scenario' },
  { title: 'Mission Story', short: 'Story' },
  { title: "Commander's Intent", short: 'Intent' },
  { title: 'Threat Brief (AI)', short: 'Threat Brief' },
  { title: 'Threats', short: 'Threats' },
  { title: 'Air Threats', short: 'Air' },
  { title: 'Friendly Forces', short: 'Forces' },
  { title: 'Per-Flight Briefs', short: 'Flights' },
  { title: 'Comms', short: 'Comms' },
  { title: 'Mission Flow', short: 'Flow' },
  { title: 'Timeline', short: 'Timeline' },
  { title: 'Special Instructions / Notes', short: 'Notes' },
];

/** Controllable wing-brief slide sections, in the renderer's DEFAULT emit
 *  order (must match brief_renderer.render_wing_brief so disabling one
 *  section never surprise-reorders the rest). The cover is always first
 *  and isn't listed. ids match the backend _SECTION_LABEL_PREFIXES keys. */
const SLIDE_SECTIONS: { id: string; label: string }[] = [
  { id: 'theatre', label: 'Theatre Overview' },
  { id: 'scenario', label: 'Scenario' },
  { id: 'intent', label: "Commander's Intent" },
  { id: 'route_overview', label: 'Route Overview (map)' },
  { id: 'threat_brief', label: 'Threat Brief (AI)' },
  { id: 'threats', label: 'Surface Threats' },
  { id: 'air_threats', label: 'Air Threats' },
  { id: 'flights', label: 'Friendly Forces' },
  { id: 'comms', label: 'Comms' },
  { id: 'mission_flow', label: 'Mission Flow' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'notes', label: 'Special Instructions / Notes' },
  { id: 'popup', label: 'Popup Attack' },
];
const DEFAULT_SLIDE_ORDER = SLIDE_SECTIONS.map((s) => s.id);
const SLIDE_LABEL: Record<string, string> = Object.fromEntries(SLIDE_SECTIONS.map((s) => [s.id, s.label]));

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
        body: JSON.stringify({
          sessionId,
          popupAttacks: useEditStore.getState().kneeboardSettings.popupAttacks ?? [],
        }),
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
  // Speaker notes — separate busy/note state so users can run the full-brief
  // and the speaker-notes calls independently. (v1.19.x)
  const [aiSpeakerBusy, setAiSpeakerBusy] = useState(false);
  const [aiSpeakerNote, setAiSpeakerNote] = useState<string | null>(null);
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
   *  scenario card below remains the slide-displayed prose. PRESERVED
   *  across Rebuild — it's your authored context, not derived from the
   *  .miz, so a rebuild keeps it (only the AI notes + steer reset). */
  const [missionStory, setMissionStory] = useState('');

  // Persist the user-authored free text (mission story + AI steer) per session
  // so a full browser refresh doesn't wipe it (navigation loss is already handled
  // by keeping the tab mounted). Keyed by sessionId, which survives refresh like
  // the editStore edits. One effect: load once per session, then save on change —
  // the per-session ref stops the mount-time save from clobbering the draft we
  // just loaded.
  const briefDraftSidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    const key = `opt.briefDraft.${sessionId}`;
    if (briefDraftSidRef.current !== sessionId) {
      briefDraftSidRef.current = sessionId;
      try {
        const d = JSON.parse(localStorage.getItem(key) || '{}');
        if (typeof d.missionStory === 'string') setMissionStory(d.missionStory);
        if (typeof d.aiSteer === 'string') setAiSteer(d.aiSteer);
      } catch { /* ignore corrupt draft */ }
      return;
    }
    try { localStorage.setItem(key, JSON.stringify({ missionStory, aiSteer })); } catch { /* quota */ }
  }, [sessionId, missionStory, aiSteer]);

  // Inline preview pane state. Slides come from the server as base64 PNGs
  // rendered via LibreOffice → pypdfium2. Empty until user clicks Preview.
  // Edits don't auto-refresh — user clicks Refresh after a batch of edits
  // to avoid burning CPU on every keystroke.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSlides, setPreviewSlides] = useState<string[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Live auto-refresh (v1.19.84): a request token so a slow render can't
  // clobber a newer one, a "stale" flag for the pending-changes indicator,
  // and a ref mirror of previewOpen so the debounce effect can gate
  // without re-running when the pane merely opens.
  const previewReq = useRef(0);
  const [previewStale, setPreviewStale] = useState(false);
  const previewOpenRef = useRef(false);
  useEffect(() => { previewOpenRef.current = previewOpen; }, [previewOpen]);

  // Base template (.pptx) for the MAIN brief (v0.9.79). When set, the
  // auto-built brief renders ON this template — the template's own
  // slide(s) + theme become the cover/branding, content slides follow.
  // base64, no data: prefix. Threaded into preview/render calls.
  const [templateB64, setTemplateB64] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  // v1.19.86 — the template can be a .pptx (built ON it) or an image
  // (PNG/JPEG used as the full-bleed background on every slide). One slot,
  // two kinds; the send path routes to `template` vs `bg_image`.
  const [templateKind, setTemplateKind] = useState<'pptx' | 'image' | null>(null);
  // Content top-margin (inches) — pushes brief content below the
  // template's branded header band so section titles don't collide with
  // logos. Only relevant when a template is attached. (v0.9.81)
  const [templateTopMargin, setTemplateTopMargin] = useState(1.2);
  // Route the single template slot to the right render param.
  const tmplBody = templateKind === 'pptx' ? (templateB64 || undefined) : undefined;
  const bgImageBody = templateKind === 'image' ? (templateB64 || undefined) : undefined;
  const topMarginBody = templateB64 ? templateTopMargin : undefined;

  // Collapsible cards (v1.19.84) — set of collapsed card slug-ids. Lives
  // in component state, which survives tab switches (tabs stay mounted
  // via the visitedTabs display:none pattern), so the collapsed layout
  // persists across the session.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCard = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  // Jump-to-section nav: ensure the card is expanded, then scroll to it.
  const jumpToCard = useCallback((title: string) => {
    const id = cardSlug(title);
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev); next.delete(id); return next;
    });
    requestAnimationFrame(() => {
      document.getElementById(`bc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // Slide layout (v1.19.84) — show/hide + reorder the wing-brief slides.
  // `slideOrder` is the section id order; `slidesOff` are disabled ids.
  // We only send `sections` to the backend when the layout differs from
  // the default, so an untouched brief renders in the natural order.
  const [slideOrder, setSlideOrder] = useState<string[]>(DEFAULT_SLIDE_ORDER);
  const [slidesOff, setSlidesOff] = useState<Set<string>>(new Set());
  const slidesDirty = useMemo(
    () => slidesOff.size > 0 || slideOrder.some((id, i) => id !== DEFAULT_SLIDE_ORDER[i]),
    [slideOrder, slidesOff],
  );
  const slideSections = useMemo(
    () => slideOrder.map((id) => ({ id, enabled: !slidesOff.has(id) })),
    [slideOrder, slidesOff],
  );
  // The payload to thread into preview/render bodies — undefined when the
  // layout is untouched so the backend keeps its default order.
  const sectionsPayload = slidesDirty ? slideSections : undefined;
  const moveSlide = useCallback((idx: number, dir: -1 | 1) => {
    setSlideOrder((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }, []);
  const toggleSlide = useCallback((id: string) => {
    setSlidesOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

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
        body: JSON.stringify({
          sessionId,
          popupAttacks: useEditStore.getState().kneeboardSettings.popupAttacks ?? [],
        }),
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

  const runPreview = useCallback(async (auto: boolean) => {
    if (!brief) return;
    if (!auto) setPreviewOpen(true);
    const reqId = ++previewReq.current;
    setPreviewLoading(true);
    if (!auto) setError(null);
    try {
      const res = await fetch('/api/brief/preview-wing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, dpi: 100, template: tmplBody, bg_image: bgImageBody, top_margin: topMarginBody, sections: sectionsPayload }),
      });
      if (reqId !== previewReq.current) return; // superseded by a newer render
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
      if (reqId !== previewReq.current) return;
      const slides: string[] = data.slides || [];
      setPreviewSlides(slides);
      // Manual open jumps to slide 1; auto-refresh keeps the user's place.
      setPreviewIdx((i) => (auto ? Math.min(i, Math.max(0, slides.length - 1)) : 0));
      setPreviewStale(false);
    } catch (e: any) {
      if (reqId !== previewReq.current) return;
      setError(e.message);
      if (!auto) setPreviewOpen(false); // manual failure closes the pane; auto keeps it
    } finally {
      if (reqId === previewReq.current) setPreviewLoading(false);
    }
  }, [brief, templateB64, templateTopMargin, sectionsPayload]);

  const handlePreview = () => runPreview(false);

  // Debounced live auto-refresh: when the preview pane is open, re-render
  // ~1.8s after the last edit so slides track the form without burning a
  // render on every keystroke. runPreview's identity changes whenever the
  // brief/template/margin change, so this effect re-arms on each edit.
  useEffect(() => {
    if (!previewOpenRef.current || !brief) return;
    setPreviewStale(true);
    const t = setTimeout(() => { runPreview(true); }, 1800);
    return () => clearTimeout(t);
  }, [runPreview, brief]);

  const handleRender = async () => {
    if (!brief) return;
    setRendering(true); setError(null);
    try {
      const route_overview_base64 = await buildOverviewMap();
      const res = await fetch('/api/brief/render-wing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: { ...brief, route_overview_base64 }, format, template: tmplBody, bg_image: bgImageBody, top_margin: topMarginBody, sections: sectionsPayload }),
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
        body: JSON.stringify({
          sessionId,
          popupAttacks: useEditStore.getState().kneeboardSettings.popupAttacks ?? [],
        }),
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
        // v1.19.66 — snapshot effective groups so per-flight maps
        // use the user's queued TACAN/freq edits, not the original .miz.
        const groups = getEffectiveGroupsSnapshot();
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
        body: JSON.stringify({ wing: { ...pkg.wing, route_overview_base64 }, flights, format: pkgFormat, template: tmplBody, bg_image: bgImageBody, top_margin: topMarginBody, sections: sectionsPayload }),
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

  // AI: speaker notes for the brief presenter (v1.19.x) -----------------------
  // Generates 1-4 plain-prose sentences per slide and stuffs them into the
  // brief's speaker_notes map. The backend renderer writes them into each
  // slide's PPTX notes_text_frame so the presenter sees them during the
  // brief. Independent of the full-brief call — runs against the same
  // structured input + mission story.
  const handleAiSpeakerNotes = async () => {
    if (!brief) return;
    if (!aiKey) { setAiOpen(true); return; }
    setAiSpeakerBusy(true);
    setError(null);
    setAiSpeakerNote(null);
    try {
      const result = await generateSpeakerNotes(aiProvider, aiKey, aiModel, {
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
      const map = speakerNotesToBriefMap(result.notes);
      setBrief((b) => (b ? { ...b, speaker_notes: map } : null));
      const slides = Object.keys(map).length;
      setAiSpeakerNote(
        `Wrote notes for ${slides} slide${slides === 1 ? '' : 's'} via ${result.model} · ${result.usage.input_tokens} in / ${result.usage.output_tokens} out tokens.`,
      );
    } catch (e: any) {
      setError(`AI speaker-notes generation failed: ${e.message}`);
    } finally {
      setAiSpeakerBusy(false);
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
        <BriefCardCtx.Provider value={{ collapsed, toggle: toggleCard }}>
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

          {/* Jump-to-section nav rail (v1.19.84) — sticky chip bar; click a
              chip to expand + scroll to that card. Collapse-/expand-all on
              the right tames the long form. */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 5,
            display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
            padding: '8px 12px', marginBottom: 14,
            background: '#1d1d1d', border: '1px solid #3a3a3a', borderRadius: 4,
          }}>
            <span style={{ fontSize: 10, color: '#777', textTransform: 'uppercase', letterSpacing: 1, marginRight: 2 }}>Jump</span>
            {NAV_SECTIONS.map((s) => (
              <button key={s.title} onClick={() => jumpToCard(s.title)} style={{
                background: collapsed.has(cardSlug(s.title)) ? '#262626' : '#2c2c2c',
                border: '1px solid #3a3a3a', borderRadius: 12,
                color: collapsed.has(cardSlug(s.title)) ? '#888' : '#ccc',
                fontSize: 11, padding: '2px 9px', cursor: 'pointer', fontFamily: 'inherit',
              }} title={collapsed.has(cardSlug(s.title)) ? 'Collapsed — click to expand + jump' : `Jump to ${s.title}`}>
                {s.short}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button
              onClick={() => setCollapsed(new Set(NAV_SECTIONS.map((s) => cardSlug(s.title))))}
              style={{ ...btnSmall, fontSize: 10 }} title="Collapse every section"
            >Collapse all</button>
            <button
              onClick={() => setCollapsed(new Set())}
              style={{ ...btnSmall, fontSize: 10 }} title="Expand every section"
            >Expand all</button>
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
              accept=".pptx,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              id="brief-base-template-input"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const lname = file.name.toLowerCase();
                const isPptx = lname.endsWith('.pptx');
                const isImage = /\.(png|jpe?g|webp)$/.test(lname) || file.type.startsWith('image/');
                if (!isPptx && !isImage) {
                  setError('Template must be a .pptx or an image (PNG / JPEG / WEBP)');
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
                  setTemplateKind(isPptx ? 'pptx' : 'image');
                  // .pptx defaults to a 1.2" header-clear inset; an image
                  // backdrop starts content at the top (raise if it has a band).
                  setTemplateTopMargin(isPptx ? 1.2 : 0);
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
                  {templateKind === 'image'
                    ? '— image backdrop behind every slide; text colour auto-contrasts to it.'
                    : '— built on your template: cover + branding + theme. Text color auto-adapts to your background.'}
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
                <button onClick={() => { setTemplateB64(null); setTemplateName(null); setTemplateKind(null); }} style={btnDanger}>
                  Remove
                </button>
              </>
            ) : (
              <>
                <label htmlFor="brief-base-template-input" style={{ ...btnSecondary, display: 'inline-block' }}>
                  Upload .pptx or image
                </label>
                <span style={{ fontSize: 11, color: '#888888' }}>
                  Optional — without one, the brief uses the built-in dark template.
                  A <strong>.pptx</strong> renders the brief on its slides + theme (your
                  cover leads the deck). A <strong>PNG / JPEG</strong> is used as the
                  full-bleed background on every slide; text colour auto-contrasts.
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
                {/* Live indicator (v1.19.84): auto-refresh status */}
                {previewLoading && previewSlides.length > 0 ? (
                  <span style={{ fontSize: 11, color: '#fbb941' }}>● updating…</span>
                ) : previewStale ? (
                  <span style={{ fontSize: 11, color: '#888' }}>○ edits pending</span>
                ) : (
                  <span style={{ fontSize: 11, color: '#3fb950' }}>● live</span>
                )}
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
                  <div style={{ position: 'relative', display: 'inline-block', maxHeight: 600, maxWidth: '100%' }}>
                    <img
                      src={`data:image/png;base64,${previewSlides[previewIdx]}`}
                      alt={`slide ${previewIdx + 1}`}
                      style={{
                        maxWidth: '100%', maxHeight: 600,
                        objectFit: 'contain',
                        boxShadow: '0 0 0 1px #3a3a3a',
                        display: 'block',
                      }}
                      onClick={() => setPreviewIdx((i) =>
                        i + 1 < previewSlides.length ? i + 1 : 0)}
                    />
                    {/* Template content-top guide (v1.19.84): only with a
                        template loaded — shows where auto content starts
                        (slide is 7.5in tall) so the margin slider isn't
                        trial-and-error. */}
                    {templateB64 && (
                      <div style={{
                        position: 'absolute', left: 0, right: 0,
                        top: `${Math.min(100, (templateTopMargin / 7.5) * 100)}%`,
                        borderTop: '2px dashed rgba(251,185,65,0.55)',
                        pointerEvents: 'none',
                      }}>
                        <span style={{
                          position: 'absolute', right: 2, top: -15, fontSize: 9,
                          color: '#fbb941', background: 'rgba(15,15,15,0.85)', padding: '0 3px',
                        }}>content top · {templateTopMargin}″</span>
                      </div>
                    )}
                  </div>
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
          <Card title="Slides (order & visibility)" right={
            slidesDirty
              ? <button onClick={() => { setSlideOrder(DEFAULT_SLIDE_ORDER); setSlidesOff(new Set()); }} style={btnSmall}>Reset order</button>
              : <span style={{ fontSize: 10, color: '#666' }}>default order</span>
          }>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
              Uncheck to drop a slide; ▲▼ to reorder. The cover is always first.
              Slides with no data (e.g. route map, popup) are skipped automatically.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {slideOrder.map((id, i) => {
                const off = slidesOff.has(id);
                return (
                  <div key={id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '3px 6px', background: '#1d1d1d', border: '1px solid #2e2e2e', borderRadius: 3,
                    opacity: off ? 0.5 : 1,
                  }}>
                    <input type="checkbox" checked={!off} onChange={() => toggleSlide(id)} style={{ accentColor: '#fbb941' }} />
                    <span style={{ flex: 1, fontSize: 13, color: '#e0e0e0', textDecoration: off ? 'line-through' : 'none' }}>
                      {i + 1}. {SLIDE_LABEL[id] || id}
                    </span>
                    <button onClick={() => moveSlide(i, -1)} disabled={i === 0}
                      style={{ ...btnSmall, padding: '0 7px', opacity: i === 0 ? 0.3 : 1 }} title="Move up">▲</button>
                    <button onClick={() => moveSlide(i, 1)} disabled={i === slideOrder.length - 1}
                      style={{ ...btnSmall, padding: '0 7px', opacity: i === slideOrder.length - 1 ? 0.3 : 1 }} title="Move down">▼</button>
                  </div>
                );
              })}
            </div>
          </Card>

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
            {/* Public-domain sample picker (v1.19.35) — fed from
                /api/sample_covers. Operator-curated, attribution shown
                per tile. No tiles render until the manifest at
                data/sample_covers.json gets verified entries; the
                gallery prints a clear "no samples available yet"
                line in that state so callers don't see a dead UI. */}
            <details style={{ marginTop: 10, padding: '6px 12px', background: '#1a1a1a', border: '1px solid #3a3a3a', borderRadius: 4 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#cfe6ff', fontWeight: 600 }}>
                Or pick a sample cover (public-domain library)
              </summary>
              {/* v1.19.59 — was: no overflow constraint + 140px min-tile,
                  so a narrow form column squeezed the gallery into 2
                  visible tiles with no scroll. Now: 420px max-height +
                  scroll, 110px min-tile width fits 3 per column on a
                  typical brief-form layout. */}
              <div style={{
                marginTop: 8,
                maxHeight: 420,
                overflowY: 'auto',
                overflowX: 'hidden',
                paddingRight: 4,
              }}>
                <SampleCoversGallery
                  onPick={async (blob, title) => {
                    // Convert Blob → base64 data URL for the brief
                    // store, which round-trips through PPTX rendering.
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = String(reader.result || '');
                      set('cover_image_base64', result);
                    };
                    reader.onerror = () => setError(`Couldn't load ${title}: read failed`);
                    reader.readAsDataURL(blob);
                  }}
                />
              </div>
            </details>
          </Card>

          {/* v1.19.59 — Brief Colors. Squadron palette override for the
              auto-rendered slides. Each picker maps to a renderer role
              (BG / Text / Accent / Border / etc.). Blank = renderer
              default (auto dark/light). Saved into brief.theme_colors. */}
          <Card title="Brief Colors (optional)">
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#aaaaaa', lineHeight: 1.5 }}>
              Override the auto-dark / auto-light palette with your squadron colours.
              Leave any field blank to fall back to the renderer's default. Affects
              auto-built slides only; custom-template renders keep their template theme.
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 10,
            }}>
              {([
                ['bg',        'Background',     '#1a1a1a', 'Slide background'],
                ['text',      'Body text',      '#e0e0e0', 'Paragraph + table cells'],
                ['bright',    'Headings',       '#ffffff', 'Section headers / titles'],
                ['accent',    'Accent',         '#ffa500', 'Underline bar + tag chips'],
                ['dim',       'Subtext',        '#aaaaaa', 'Attribution + metadata'],
                ['border',    'Borders',        '#555555', 'Cell + chip outlines'],
                ['header_bg', 'Table header',   '#333333', 'Table header row fill'],
                ['cell_bg',   'Table cell',     '#1a1a1a', 'Table body cell fill'],
              ] as const).map(([role, label, defHex, hint]) => {
                const current = brief.theme_colors?.[role] ?? '';
                return (
                  <label key={role} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#cccccc' }}>
                    <span style={{ fontWeight: 600 }}>{label}</span>
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="color"
                        value={current || defHex}
                        onChange={(e) => set('theme_colors', {
                          ...(brief.theme_colors ?? {}),
                          [role]: e.target.value,
                        })}
                        style={{ width: 32, height: 28, padding: 0, border: '1px solid #3a3a3a', borderRadius: 3, background: 'transparent', cursor: 'pointer' }}
                      />
                      <input
                        type="text"
                        value={current}
                        placeholder={defHex}
                        onChange={(e) => set('theme_colors', {
                          ...(brief.theme_colors ?? {}),
                          [role]: e.target.value,
                        })}
                        style={{ flex: 1, fontFamily: "'B612 Mono', monospace", fontSize: 11, background: '#0a1218', color: '#e0e0e0', border: '1px solid #3a3a3a', borderRadius: 3, padding: '3px 6px' }}
                      />
                      {current && (
                        <button
                          onClick={() => {
                            const next = { ...(brief.theme_colors ?? {}) };
                            delete next[role];
                            set('theme_colors', next);
                          }}
                          title="Clear — fall back to renderer default"
                          style={{ background: 'transparent', border: '1px solid #3a3a3a', color: '#aaa', padding: '3px 6px', fontSize: 11, cursor: 'pointer', borderRadius: 3 }}
                        >
                          ×
                        </button>
                      )}
                    </span>
                    <span style={{ color: '#666', fontSize: 10 }}>{hint}</span>
                  </label>
                );
              })}
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button
                onClick={() => set('theme_colors', {})}
                disabled={!brief.theme_colors || Object.keys(brief.theme_colors).length === 0}
                style={{
                  fontFamily: 'inherit', fontSize: 11,
                  padding: '5px 12px',
                  background: '#262626', border: '1px solid #3a3a3a',
                  color: '#aaaaaa', borderRadius: 3,
                  cursor: 'pointer',
                  opacity: (!brief.theme_colors || Object.keys(brief.theme_colors).length === 0) ? 0.5 : 1,
                }}
              >
                Reset all to defaults
              </button>
              <button
                onClick={() => set('theme_colors', {
                  bg: '#1a1a1a', text: '#e0e0e0', bright: '#ffffff',
                  accent: '#ffa500', dim: '#aaaaaa', border: '#555555',
                  header_bg: '#333333', cell_bg: '#1a1a1a',
                })}
                style={{ fontFamily: 'inherit', fontSize: 11, padding: '5px 12px', background: '#1a1f28', border: '1px solid #3a3a3a', color: '#cccccc', borderRadius: 3, cursor: 'pointer' }}
              >
                🌑 Dark preset
              </button>
              <button
                onClick={() => set('theme_colors', {
                  bg: '#ffffff', text: '#1a1a1a', bright: '#000000',
                  accent: '#b8740c', dim: '#555555', border: '#999999',
                  header_bg: '#d8d8d8', cell_bg: '#f3f3f3',
                })}
                style={{ fontFamily: 'inherit', fontSize: 11, padding: '5px 12px', background: '#262626', border: '1px solid #3a3a3a', color: '#cccccc', borderRadius: 3, cursor: 'pointer' }}
              >
                ☀ Light preset
              </button>
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
                  disabled={aiFullBusy || aiBusy || aiSpeakerBusy}
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
                {aiKey && (
                  <button
                    onClick={handleAiSpeakerNotes}
                    disabled={aiFullBusy || aiBusy || aiSpeakerBusy}
                    style={{
                      ...btnSmall,
                      background: '#1f2a18',
                      borderColor: '#7cc66f',
                      color: '#7cc66f',
                      fontWeight: 600,
                      opacity: aiSpeakerBusy ? 0.6 : 1,
                      marginLeft: 6,
                    }}
                    title={`Write 1-4 sentences of speaker notes per slide and embed them in the PPTX notes pane (via ${aiProvider} ${aiModel}). Independent of Generate Full Brief.`}
                  >
                    {aiSpeakerBusy ? 'Writing notes…' : '🎤 Speaker notes'}
                  </button>
                )}
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
            {aiSpeakerNote && (
              <div style={{
                marginTop: 4, fontSize: 11, color: '#7cc66f',
                fontFamily: "'B612 Mono', monospace",
              }}>
                {aiSpeakerNote}
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
                      <th style={th}>Weapons</th><th style={th}>Notes</th>
                      <th style={th}>Side</th><th style={th}></th></tr>
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
                      <td style={td}><select style={{ ...cellInput, width: 70 }} value={a.coalition || 'red'}
                          onChange={(e) => setRow('air_threats', i, { ...a, coalition: e.target.value })}>
                          <option value="red">Red</option>
                          <option value="blue">Blue</option>
                          <option value="neutral">Neut</option>
                        </select></td>
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
                        placeholder="— enter freq / set in SOP"
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
        </BriefCardCtx.Provider>
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
  // v1.19.x BYOK: AI-suggest mapping for unresolved tokens. Reads aiStore
  // directly — same pattern as the parent BriefGenTab.
  const aiProvider = useAiStore((s) => s.provider);
  const aiKey = useAiStore((s) =>
    s.provider === 'anthropic' ? s.anthropicKey : s.geminiKey,
  );
  const aiModel = useAiStore((s) =>
    s.provider === 'anthropic' ? s.anthropicModel : s.geminiModel,
  );
  const [aiMapBusy, setAiMapBusy] = useState(false);
  const [aiMapNote, setAiMapNote] = useState<string | null>(null);
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
    setError(null); setOverrides({}); setAiMapNote(null);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch('/api/brief/scan', { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Scan failed');
      const data = await res.json();
      setScan({ filename: data.filename, tokens: data.tokens, templateBytes: await file.arrayBuffer() });
    } catch (e: any) { setError(e.message); }
  };

  // v1.19.x: AI-suggest mappings for tokens the auto-resolver couldn't
  // figure out. Takes the snapshot of brief-relevant mission data + the
  // unresolved tokens, asks Claude for a best-guess mapping. Result lands
  // in `overrides` so the user can review + edit before render.
  const handleAiSuggestMapping = async () => {
    if (!scan) return;
    if (!aiKey) { setError('No AI key configured. Open the brief tab\'s AI Settings to add one.'); return; }
    setAiMapBusy(true);
    setError(null);
    setAiMapNote(null);
    try {
      // Build the brief snapshot from the missionStore. Reuse the same
      // shape the tokenMapper module expects.
      const st = store;
      const overview = st.overview as any;
      const briefSnapshot = {
        mission_name: overview?.name || '',
        theater: overview?.theater || '',
        date: overview?.date || '',
        time_zulu: overview?.start_time_zulu || '',
        coalition: 'blue',
        scenario: overview?.description || '',
        commanders_intent: '',
        threats: ((st as any).threats || []).map((t: any) => ({
          name: t.name, type: t.type || '', coalition: t.coalition || 'red',
          range_km: t.range_km, location: t.location,
        })),
        flights: ((st as any).groups || [])
          .filter((g: any) => g.is_player || (g.units || []).some((u: any) => u.client))
          .map((g: any) => ({
            callsign: g.groupName || '',
            aircraft: g.units?.[0]?.type || '',
            count: (g.units || []).length,
            role: g.task || '',
            frequency: g.frequency ? String(g.frequency) : '',
          })),
      };
      // Only ask the AI about tokens we couldn't auto-resolve and the user
      // hasn't already overridden — don't waste tokens re-confirming wins.
      const unresolved = tokenRows
        .filter((r) => !r.isAutoResolved && !r.isOverridden)
        .map((r) => r.token);
      if (unresolved.length === 0) {
        setAiMapNote('Nothing to suggest — every token is either auto-resolved or already overridden.');
        return;
      }
      const result = await generateTemplateMapping(aiProvider, aiKey, aiModel, {
        unresolvedTokens: unresolved,
        brief: briefSnapshot,
      });
      // Apply only non-empty suggestions — empty strings would clobber the
      // existing auto-resolution if the AI was uncertain.
      setOverrides((prev) => {
        const next = { ...prev };
        for (const [tok, val] of Object.entries(result.mapping)) {
          if (val) next[tok] = val;
        }
        return next;
      });
      setAiMapNote(
        `AI suggested ${result.filled}/${unresolved.length} (${result.blank} blank) via ${result.model} · ${result.usage.input_tokens} in / ${result.usage.output_tokens} out tokens.`,
      );
    } catch (e: any) {
      setError(`AI template mapping failed: ${e.message}`);
    } finally {
      setAiMapBusy(false);
    }
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
            {aiKey && (
              <button
                onClick={handleAiSuggestMapping}
                disabled={aiMapBusy || rendering}
                style={{
                  ...btnSecondary,
                  marginLeft: 'auto',
                  background: '#2a2418',
                  borderColor: '#fbb941',
                  color: '#fbb941',
                  opacity: aiMapBusy ? 0.6 : 1,
                }}
                title="Ask AI to fill in any unmapped tokens by guessing from mission data. Review + edit the values before render."
              >
                {aiMapBusy ? '✨ Thinking…' : '✨ AI-suggest mapping'}
              </button>
            )}
            <button
              onClick={() => setRebuildAt(Date.now())}
              style={{ ...btnSecondary, marginLeft: aiKey ? 0 : 'auto' }}
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
          {aiMapNote && (
            <div style={{
              marginBottom: 8, fontSize: 11, color: '#fbb941',
              fontFamily: "'B612 Mono', monospace",
            }}>
              {aiMapNote}
            </div>
          )}
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

/** Format one popup-attack profile as a compact multi-line summary for the
 *  `popup_attacks.list` and per-profile `summary` tokens. Kept here (not in
 *  utils/popupAttack.ts) because it shapes for a brief slide, not the
 *  kneeboard card. */
function formatPopupSummary(p: PopupAttackInput): string {
  const prof = computePopupAttack(p);
  const head = `${p.name || 'Attack'} (${ATTACK_TYPE_LABEL[p.attackType]})`;
  const lines = [
    head,
    `  TGT elev: ${p.targetElevationFt.toLocaleString()} ft MSL · VIP: ${p.vipDistanceNm} NM · TTT ~${Math.round(prof.totals.timeToTargetSec)}s`,
  ];
  if (p.attackType === 'laydown') {
    lines.push(`  Release ${p.releaseAltitudeFtAgl.toLocaleString()} ft AGL @ ${p.releaseSpeedKts} kt level · ingress ${p.ingressAltitudeFtAgl.toLocaleString()} AGL @ ${p.ingressSpeedKts} kt`);
  } else if (p.attackType === 'loft') {
    lines.push(`  Pull ${p.popupAngleDeg}° at AP → release climbing @ ${p.popupAltitudeFtMsl.toLocaleString()} ft MSL · ${p.releaseSpeedKts} kt`);
  } else if (p.attackType === 'dive') {
    lines.push(`  Ingress ${p.ingressAltitudeFtAgl.toLocaleString()} ft AGL → ${p.diveAngleDeg}° dive → release ${p.releaseAltitudeFtAgl.toLocaleString()} ft AGL @ ${p.releaseSpeedKts} kt`);
  } else {
    // type1/2/3 popup
    lines.push(`  Pull ${p.popupAngleDeg}° to ${p.popupAltitudeFtMsl.toLocaleString()} ft MSL → ${p.diveAngleDeg}° dive → release ${p.releaseAltitudeFtAgl.toLocaleString()} ft AGL @ ${p.releaseSpeedKts} kt`);
  }
  lines.push(`  Offset: ${p.angleOffsetDeg}° from target axis`);
  return lines.join('\n');
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

  // Popup-attack profiles — read from editStore via getState() so the
  // resolver stays cheap and doesn't subscribe to the store. Empty
  // arrays render the tokens as null so the template designer can spot
  // when no profiles are defined.
  const popupAttacks: PopupAttackInput[] = useEditStore.getState().kneeboardSettings.popupAttacks ?? [];

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
    // Popup-attack profile tokens (v1.17.5). Aerial-delivery profiles defined
    // in the Kneeboard tab — typically 0–3 per mission. `list` produces a
    // headed multi-line summary suitable for a "Popup Attack" slide; per-
    // profile tokens (popup_attack[N].field) hand back individual fields
    // for templates that prefer a structured layout.
    'popup_attacks.count':  () => popupAttacks.length > 0 ? String(popupAttacks.length) : null,
    'popup_attacks.list':   () => popupAttacks.length === 0 ? null : popupAttacks.map(formatPopupSummary).join('\n\n'),
    'popup_attacks.names':  () => popupAttacks.length === 0 ? null : popupAttacks.map((p, i) => p.name || `Attack ${i + 1}`).join(', '),
    'popup_attacks.types':  () => popupAttacks.length === 0 ? null : popupAttacks.map((p) => ATTACK_TYPE_LABEL[p.attackType]).join(', '),
  };
  if (direct[token]) return direct[token]!();

  // Per-profile popup-attack tokens: popup_attack[N].field
  const pa = token.match(/^popup_attack\[(\d+)\]\.(.+)$/);
  if (pa) {
    const p = popupAttacks[parseInt(pa[1], 10)];
    if (!p) return null;
    const prof = computePopupAttack(p);
    switch (pa[2]) {
      case 'name':           return p.name || `Attack ${parseInt(pa[1], 10) + 1}`;
      case 'type':           return ATTACK_TYPE_LABEL[p.attackType];
      case 'type_code':      return p.attackType;
      case 'tgt_elev':       return `${p.targetElevationFt.toLocaleString()} ft MSL`;
      case 'vip_dist':       return `${p.vipDistanceNm} NM`;
      case 'popup_alt':      return `${p.popupAltitudeFtMsl.toLocaleString()} ft MSL`;
      case 'popup_angle':    return `${p.popupAngleDeg}°`;
      case 'dive_angle':     return `${p.diveAngleDeg}°`;
      case 'offset':         return `${p.angleOffsetDeg}°`;
      case 'release_alt':    return `${p.releaseAltitudeFtAgl.toLocaleString()} ft AGL`;
      case 'release_speed':  return `${p.releaseSpeedKts} kt`;
      case 'ingress_alt':    return `${p.ingressAltitudeFtAgl.toLocaleString()} ft AGL`;
      case 'ingress_speed':  return `${p.ingressSpeedKts} kt`;
      case 'ttt':            return `${Math.round(prof.totals.timeToTargetSec)}s`;
      case 'summary':        return formatPopupSummary(p);
      default: return null;
    }
  }

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
    // Leave unmatched SOP slots EMPTY (not a literal "—") so the cell
    // reads as an editable blank with a placeholder, not a filled value.
    if (slot) return { ...r, value: slot() ?? '' };
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
  // v1.19.84 — collapsible via the shared context (click the title to
  // fold the card). The body uses display:none rather than unmounting so
  // textareas keep their scroll/selection while folded. Nav rail jumps
  // here by the slug id.
  const ctx = useContext(BriefCardCtx);
  const id = cardSlug(title);
  const collapsed = ctx?.collapsed.has(id) ?? false;
  return (
    <div id={`bc-${id}`} style={{ marginBottom: 14, background: '#222222', border: '1px solid #3a3a3a', scrollMarginTop: 8 }}>
      <div style={{
        padding: '8px 14px', borderBottom: collapsed ? 'none' : '1px solid #3a3a3a',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#262626',
      }}>
        <button
          type="button"
          onClick={() => ctx?.toggle(id)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
            cursor: 'pointer', padding: 0, fontFamily: 'inherit',
            fontSize: 12, fontWeight: 600, color: '#fbb941', letterSpacing: 1, textTransform: 'uppercase',
          }}
        >
          <span style={{ fontSize: 10, color: '#888', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.12s' }}>▼</span>
          {title}
        </button>
        {right}
      </div>
      <div style={{ padding: 12, display: collapsed ? 'none' : 'block' }}>{children}</div>
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
