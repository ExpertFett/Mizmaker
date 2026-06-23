import { useState, useMemo } from 'react';
import {
  MapIcon, SopIcon, CoalitionsIcon, MissionIcon, GoalsIcon, WeatherIcon,
  ScriptsIcon, TriggersIcon,
  ThreatsIcon, DmpiIcon,
  RosterIcon, LoadoutIcon, RadioIcon, DtcIcon, LiveryIcon,
  KneeboardIcon, BriefIcon,
  VisibilityIcon,
  DebugIcon, ToolsIcon, UploadIcon,
} from '../icons/TabIcons';
import { useMissionStore } from '../store/missionStore';
import { useSopStore } from '../sop/sopStore';
import { useSessionStream } from '../session/useSessionStream';
import { ParticipantBar } from '../session/ParticipantBar';
import { InviteManager } from '../session/InviteManager';
import { MapContainer } from '../map/MapContainer';
import { FloatingFlightPanel } from '../panels/FloatingFlightPanel';
import { ExportPanel } from '../panels/ExportPanel';
import { MissionDataStrip } from '../panels/MissionDataStrip';
import { SessionToasts } from '../panels/SessionToasts';
import { PlayerGroupsButton } from '../panels/PlayerGroupsModal';
// v1.19.74 PREVIEW — DatalinkTab is now a sub-tab inside RadioTab;
// don't mount it as a top-level tab anymore.
import { TargetsTab } from './tabs/TargetsTab';
import { DtcTab } from './tabs/DtcTab';
import { WeaponsTab } from './tabs/WeaponsTab';
import { RadioTab } from './tabs/RadioTab';
import { KneeboardTab } from './tabs/KneeboardTab';
import { WeatherTab } from './tabs/WeatherTab';
import { LiveryTab } from './tabs/LiveryTab';
import { MissionEditTab } from './tabs/MissionEditTab';
import { ToolsTab } from './tabs/ToolsTab';
import { ThreatLibraryTab } from './tabs/ThreatLibraryTab';
import { CoalitionsTab } from './tabs/CoalitionsTab';
import { MissionDebugTab } from './tabs/MissionDebugTab';
// v1.19.57 — SopTab + SopCheckTab live behind SopTabContainer now (sub-
// tab toggle). One sidebar entry, two sub-tabs (SOPs / Check). Apply
// button lives on the Check sub-tab.
import { SopTabContainer } from './tabs/SopTabContainer';
// v1.19.74 PREVIEW — EditsTab moved to a drawer beside the Download
// button (see ExportPanel). DmpiTab + JtacSetupPanel now mounted via
// the new TargetsTab container.
import { GoalsTab } from './tabs/GoalsTab';
import { AutoSetupButton } from './AutoSetupButton';
import { VisibilityTab } from './tabs/VisibilityTab';
import { BriefGenTab } from './tabs/BriefGenTab';
import { ScriptsTab } from './tabs/ScriptsTab';
import { RosterTab } from './tabs/RosterTab';
import { TriggerTab } from './tabs/TriggerTab';
import { UploadPanel } from '../panels/UploadPanel';
import { MetarReadout } from '../panels/MetarReadout';
import { LiveTerminal } from './live/LiveTerminal';
import { LiveErrorBoundary } from './live/LiveErrorBoundary';
import { LOCK_TO_PLANNING, loadInitialMode, saveMode, tabsForMode, type AppMode } from '../plannerMode';

// Sidebar layout — workflow phases. Each tab is a top-level destination;
// section headers ('SETUP', 'ENTITIES', etc.) act as visual dividers
// only, not clickable. Order is start-of-mission → finish-of-mission.
//
// Carriers and Scripts are top-level (promoted from the v0.6 Tools→Rename
// collapsibles). Old "Weapons" → "Loadout", old "Miz Edit" → "Mission".
type TabDef = { id: string; label: string; icon: React.ReactNode };
type SidebarItem = { kind: 'section'; label: string } | (TabDef & { kind: 'tab' });

// v1.19.74 PREVIEW — emoji glyphs swapped for monochrome stroke SVGs.
// The Fable design review (2026-06-09) flagged the 24 colored emoji as
// the #1 "looks AI-generated" tell; this is the replacement set defined
// in src/icons/TabIcons.tsx. Same visual slot, same flex layout, just
// monochrome 16px stroke icons inheriting currentColor.
const SIDEBAR: SidebarItem[] = [
  { kind: 'section', label: 'SETUP' },
  { kind: 'tab', id: 'map',         label: 'Map',         icon: <MapIcon /> },
  // SOP comes early because callsigns, freqs, TACAN channels, ICLS
  // assignments etc. defined here drive defaults all over the rest of
  // the planner (CommCardTab auto-deconflict, carrier setup, kneeboards).
  // Loading the right SOP first means the downstream tabs start
  // pre-configured for the squadron / era you're flying.
  { kind: 'tab', id: 'sop',         label: 'SOP',         icon: <SopIcon /> },
  // v1.19.57 — SOP Check folded under SOP as a sub-tab.
  { kind: 'tab', id: 'coalitions',  label: 'Coalitions',  icon: <CoalitionsIcon /> },
  { kind: 'tab', id: 'missionEdit', label: 'Mission',     icon: <MissionIcon /> },
  // Mission Goals — squadron-style objective list. Sits next to
  // Mission because that's where the briefing-adjacent settings
  // live. Tokens flow into Brief tab via {goals.*}.
  { kind: 'tab', id: 'goals',       label: 'Goals',       icon: <GoalsIcon /> },
  { kind: 'tab', id: 'weather',     label: 'Weather',     icon: <WeatherIcon /> },

  { kind: 'section', label: 'ENTITIES' },
  // v1.19.54 — Carriers moved INTO Scripts as a sub-tab (along with
  // AEGIS / TIC / JTAC). All four are "auto-setup the mission for a
  // scripting framework" panels — keeping them together cuts the
  // sidebar by 1 row and makes the conceptual grouping obvious.
  { kind: 'tab', id: 'scripts',     label: 'Scripts',     icon: <ScriptsIcon /> },
  // Triggers comes AFTER Scripts because Scripts panels auto-append
  // trigger rules (Carrier Control + 13 TIC rules from Carriers,
  // framework load triggers from AEGIS/TIC apply). By the time the
  // user opens this tab the rules are already there — they're
  // verifying / tweaking, not authoring from scratch.
  { kind: 'tab', id: 'triggers',    label: 'Triggers',    icon: <TriggersIcon /> },

  // PLANNING comes BEFORE flights — threat picture, target list, and
  // range/fuel constraints all drive the loadout / radio / DTC choices
  // for each player flight. Doing FLIGHTS first means you'd commit to a
  // loadout, then go look at threats and realize you brought the wrong
  // weapons.
  // v1.19.54 — Airfields removed from sidebar entirely (the editor-side
  // tab "doesn't add anything", per Fett; the planner-side reference
  // surface lives elsewhere). Range plan removed too. Visibility moved
  // to its own MISSION MAKER section near the bottom — it's a
  // mission-maker intel filter, not a planning-time decision.
  { kind: 'section', label: 'PLANNING' },
  { kind: 'tab', id: 'threats',     label: 'Threats',     icon: <ThreatsIcon /> },
  // v1.19.74 PREVIEW — DMPI + JTAC merged into one "Targets" tab.
  // Both were target-tool surfaces; the old code comment for JTAC's
  // placement already said "lives next to DMPI because both are target
  // tools" — this finishes the thought.
  { kind: 'tab', id: 'dmpi',        label: 'Targets',     icon: <DmpiIcon /> },

  { kind: 'section', label: 'FLIGHTS' },
  { kind: 'tab', id: 'roster',      label: 'Roster',      icon: <RosterIcon /> },
  { kind: 'tab', id: 'weapons',     label: 'Loadout',     icon: <LoadoutIcon /> },
  // v1.19.74 PREVIEW — Datalink folded into Radio as a sub-tab; the
  // outer tab is renamed "Comms" since all three sub-tabs (Comms /
  // TACAN / Datalink) are net/channel assignments feeding DTC.
  { kind: 'tab', id: 'radio',       label: 'Comms',       icon: <RadioIcon /> },
  { kind: 'tab', id: 'dtc',         label: 'DTC',         icon: <DtcIcon /> },
  { kind: 'tab', id: 'livery',      label: 'Livery',      icon: <LiveryIcon /> },

  { kind: 'section', label: 'OUTPUT' },
  { kind: 'tab', id: 'kneeboard',   label: 'Kneeboard',   icon: <KneeboardIcon /> },
  { kind: 'tab', id: 'briefGen',    label: 'Brief',       icon: <BriefIcon /> },
  // v1.19.74 PREVIEW — Edits dropped from the sidebar. It's a
  // staged-diff review sibling of the Download action, so it now
  // lives as a drawer that opens from a chip beside Download .miz.

  // MISSION MAKER — tools the mission AUTHOR uses to control what
  // joining players see / can do. Distinct from PLANNING (which is what
  // a flight lead does WITHIN the constraints the mission already sets).
  // Visibility was previously under PLANNING but Fett moved it here
  // because it's an authoring decision, not a planning one. (v1.19.54)
  { kind: 'section', label: 'MISSION MAKER' },
  { kind: 'tab', id: 'visibility',  label: 'Visibility',  icon: <VisibilityIcon /> },

  { kind: 'section', label: 'UTIL' },
  { kind: 'tab', id: 'debug',       label: 'Debug',       icon: <DebugIcon /> },
  { kind: 'tab', id: 'tools',       label: 'Tools',       icon: <ToolsIcon /> },
  { kind: 'tab', id: 'upload',      label: 'Upload',      icon: <UploadIcon /> },
];

const TABS = SIDEBAR.filter((s): s is TabDef & { kind: 'tab' } => s.kind === 'tab');

type TabId = (typeof TABS)[number]['id'];

// The app runs in one of three modes (see plannerMode.ts): Editing (the full
// editor — original behaviour), Planning (a curated planning/reference/output
// subset), and Live (Olympus bridge — stub for now). The sidebar shows only
// the tabs for the active mode; section headers left with no tabs are dropped.
// Editing returns SIDEBAR unchanged — zero behaviour change.
function sidebarForMode(mode: AppMode): SidebarItem[] {
  const allow = tabsForMode(mode);
  if (allow === 'all') return SIDEBAR;
  const out: SidebarItem[] = [];
  for (const item of SIDEBAR) {
    if (item.kind === 'section') out.push(item); // provisional; pruned below
    else if (allow.has(item.id)) out.push(item);
  }
  // Drop section headers not immediately followed by a tab.
  return out.filter((item, i) => {
    if (item.kind !== 'section') return true;
    const next = out[i + 1];
    return next != null && next.kind === 'tab';
  });
}

export function MissionEditor() {
  const [activeTab, setActiveTab] = useState<TabId>('map');
  // App mode (Planning / Editing / Live) — drives which sidebar tabs show and
  // whether the .miz download is offered. Remembered across reloads; locked to
  // Planning when the build sets VITE_PLANNER_MODE.
  const [mode, setModeState] = useState<AppMode>(loadInitialMode);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Track which editor tabs have been opened. Once mounted, we keep them in
  // the DOM (hidden with display:none) so local useState edits survive tab
  // switches — the previous pattern (`{activeTab === 'x' && <Tab />}`) unmounted
  // the tab on switch and discarded any in-progress edits.
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(() => new Set(['map']));
  // When the user clicks an airbase marker on the map, this stores the
  // name so the AirfieldsTab snaps its detail card to that field. The
  // tick increments on every pick so re-clicking the same field still
  // triggers the focus effect downstream. (v1.19.34)
  // v1.19.54 — AirfieldsTab removed from editor; the map's airbase click
  // handler is now a no-op (airfield reference lives in planner mode only).
  const sessionId = useMissionStore((s) => s.sessionId);
  const selectedGroupId = useMissionStore((s) => s.selectedGroupId);
  const filename = useMissionStore((s) => s.filename);
  const theater = useMissionStore((s) => s.theater);
  // Detect unmapped theater: a mission loaded successfully (has groups) but
  // the airbase loader returned nothing — usually means the theatre name
  // from the .miz didn't match a known map. Surfaced as a sidebar banner
  // so the planner knows the map won't show airfields. (v1.19.20 audit #2)
  const airbaseCount = useMissionStore((s) => s.airbases.length);
  const groupCount = useMissionStore((s) => s.groups.length);
  const showUnmappedTheaterBanner = groupCount > 0 && airbaseCount === 0;

  // Active SOP — shown as a green indicator on the SOP tab + the SOP
  // name under theater/filename in the sidebar header. Visible from any
  // tab so "is an SOP active?" is answerable at a glance. Read scalars
  // (React 19 / useSyncExternalStore won't tolerate object selectors).
  const sops = useSopStore((s) => s.sops);
  const activeSopId = useSopStore((s) => s.activeId);
  const activeSop = useMemo(
    () => (activeSopId ? sops.find((s) => s.id === activeSopId) ?? null : null),
    [activeSopId, sops],
  );

  const selectTab = (tab: TabId) => {
    setActiveTab(tab);
    setVisitedTabs((prev) => prev.has(tab) ? prev : new Set(prev).add(tab));
  };

  // Sidebar tabs for the active mode (Editing = full SIDEBAR).
  const visibleSidebar = useMemo(() => sidebarForMode(mode), [mode]);

  const switchMode = (m: AppMode) => {
    setModeState(m);
    saveMode(m);
    if (m === 'live') return; // Live renders its own placeholder, no tabs
    // If the current tab isn't available in the new mode, fall back to Map.
    const allow = tabsForMode(m);
    if (allow !== 'all' && !allow.has(activeTab)) selectTab('map');
  };

  // Connect SSE for real-time sync (heartbeat keepalives prevent Cloudflare 524)
  useSessionStream(sessionId, true);

  // Live mode shows a placeholder (not the map), so treat it as non-map for
  // sidebar width / flight-picker / map-content gating.
  const isMap = activeTab === 'map' && mode !== 'live';
  // Only allow collapse on map page
  const isCollapsed = isMap && sidebarCollapsed;
  const sidebarWidth = isCollapsed ? 44 : isMap ? 280 : 140;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#1a1a1a',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'B612', 'IBM Plex Sans', 'Inter', system-ui, sans-serif",
      color: '#e0e0e0',
      overflow: 'hidden',
    }}>
      {/* v1.19.74 PREVIEW — fixed mission-data strip across every tab.
          Replaces the floating WeatherPanel's role of being the only
          place that surfaces date/time/wind. Zulu-first to match the
          kneeboards. */}
      <MissionDataStrip
        mode={LOCK_TO_PLANNING ? undefined : mode}
        onModeChange={LOCK_TO_PLANNING ? undefined : switchMode}
      />
      {/* v1.19.74 — session activity toasts (bottom-left). Fires when
          another participant edits a route, changes a unit, joins, or
          highlights the map. Renders across all three modes. */}
      <SessionToasts />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Left sidebar */}
      <div style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        display: 'flex',
        flexDirection: 'column',
        background: '#222222',
        borderRight: '1px solid #3a3a3a',
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'width 0.15s, min-width 0.15s',
      }}>
        {/* Header */}
        <div style={{
          padding: isCollapsed ? '10px 6px' : '12px 14px',
          borderBottom: '1px solid #3a3a3a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          minHeight: 42,
        }}>
          {!isCollapsed && (
            <div style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#e0e0e0', whiteSpace: 'nowrap' }}>{theater}</div>
                {LOCK_TO_PLANNING && (
                  <span
                    title="Planning-only mode — mission editing and .miz download are disabled"
                    style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: 0.6,
                      color: '#9cd0ff', background: 'rgba(74,143,212,0.15)',
                      border: '1px solid #4a8fd4', borderRadius: 3,
                      padding: '1px 5px', whiteSpace: 'nowrap', flexShrink: 0,
                    }}
                  >
                    PLANNER
                  </span>
                )}
              </div>
              {isMap && <div style={{ fontSize: 12, color: '#aaaaaa', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{filename}</div>}
              {activeSop && (
                <div
                  title={`Active SOP: ${activeSop.name}`}
                  style={{
                    fontSize: 11,
                    color: '#3fb950',
                    marginTop: 4,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: '#3fb950',
                      flexShrink: 0,
                      boxShadow: '0 0 4px #3fb950',
                    }}
                  />
                  SOP: {activeSop.name}
                </div>
              )}
              {showUnmappedTheaterBanner && (
                <div
                  title={`No airfield data shipped for theater "${theater}". The map won't show airbases, and brief slides that reference airfields will read "—". You can still plan routes manually; this only affects auto-populated airfield references.`}
                  style={{
                    fontSize: 11,
                    color: '#d29922',
                    marginTop: 4,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span style={{ flexShrink: 0 }}>⚠</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    No airfields for "{theater}"
                  </span>
                </div>
              )}
            </div>
          )}
          {isMap && (
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#aaaaaa',
                cursor: 'pointer',
                fontSize: 14,
                padding: '2px 4px',
                flexShrink: 0,
              }}
            >
              {isCollapsed ? '▶' : '◀'}
            </button>
          )}
        </div>

        {/* v1.19.74 PREVIEW — Editor/Plan/Live mode switcher promoted to
            the global header strip (MissionDataStrip). It swaps the
            entire shell so it belonged at top-bar weight, not
            sub-tab weight inside the sidebar that the switch destroys. */}

        {/* Tab buttons + section dividers.
            v0.9.60 — tab list can scroll when the sidebar gets too tall
            for the viewport.
            v0.9.68 — flex behaviour reworked. Previously the tab list
            had no flex declaration, so it took its full natural height
            (~800px for 22 tabs) and the flight picker below got squashed
            to near-zero on short viewports. Now we give it
            `flex: '0 1 auto'` so it CAN shrink, plus the flight-picker
            section below got a hard `minHeight` so flex shrink is forced
            onto the tabs (which then scroll properly).
            Collapsed mode (icons only) still uses overflow:hidden to
            keep horizontal ellipsis behaviour. */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 4,
          borderBottom: '1px solid #3a3a3a',
          flex: '0 1 auto',
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: isCollapsed ? 'hidden' : 'auto',
        }}>
          {visibleSidebar.map((item, idx) => {
            if (item.kind === 'section') {
              if (isCollapsed) {
                // Collapsed sidebar: render a thin divider line instead of the label
                return (
                  <div key={`sec-${idx}`} style={{
                    height: 1, background: '#3a3a3a', margin: '6px 8px',
                  }} />
                );
              }
              return (
                <div
                  key={`sec-${idx}`}
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: '#5a6878',
                    letterSpacing: 1.5,
                    padding: '10px 14px 4px',
                    textTransform: 'uppercase',
                  }}
                >
                  {item.label}
                </div>
              );
            }
            const isActive = activeTab === item.id;
            // SOP-aware tab indicators — small green dot on the SOP and
            // SOP Check tabs when an SOP is active, so "is an SOP
            // loaded?" reads at a glance from any tab. Picked these two
            // because they're the SOP-domain tabs; other tabs still
            // show their inline SOP badges in their own headers.
            // v1.19.57 — sopCheck no longer a top-level tab; the dot
            // only needs to render on 'sop' now.
            const showSopDot = activeSop != null && item.id === 'sop';
            // v1.19.74 PREVIEW — the Edits tab left the sidebar (it's a
            // drawer beside Download now), so the count badge moved to
            // the ExportPanel "Edits (N)" chip.
            // In Planning mode the Weather tab is a read-only METAR readout.
            const displayLabel = (mode === 'planning' && item.id === 'weather') ? 'METAR' : item.label;
            return (
              <button
                key={item.id}
                onClick={() => selectTab(item.id as TabId)}
                title={isCollapsed
                  ? (showSopDot ? `${displayLabel} — SOP: ${activeSop!.name}` : displayLabel)
                  : (showSopDot ? `Active SOP: ${activeSop!.name}` : undefined)}
                style={{
                  background: isActive ? 'rgba(74, 143, 212, 0.08)' : 'transparent',
                  border: 'none',
                  borderLeft: isActive ? '3px solid #4a8fd4' : '3px solid transparent',
                  color: isActive ? '#e0e0e0' : '#aaaaaa',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: isCollapsed ? 'center' : 'flex-start',
                  gap: isCollapsed ? 0 : 8,
                  padding: isCollapsed ? '8px 0' : isMap ? '7px 14px' : '8px 14px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  width: '100%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <span style={{ display: 'inline-flex', flexShrink: 0, width: 18, justifyContent: 'center', color: 'currentColor' }}>{item.icon}</span>
                {!isCollapsed && displayLabel}
                {showSopDot && (
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: '#3fb950',
                      boxShadow: '0 0 4px #3fb950',
                      flexShrink: 0,
                      marginLeft: isCollapsed ? 0 : 'auto',
                      marginRight: isCollapsed ? 0 : 4,
                      // Collapsed sidebar: pin the dot to the corner so
                      // it sits at the edge of the icon-only button
                      // rather than overlapping the icon.
                      ...(isCollapsed
                        ? {
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            marginLeft: 0,
                            marginRight: 0,
                          }
                        : {}),
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Flights + export (only on map tab, not collapsed)
            v0.9.68 — added `minHeight: 200` so the picker is always
            visibly tall, even on short viewports. Without this the
            tabs list above ate all the space and this section
            collapsed to near-zero (Fett's "barely visible flight
            picker" complaint). The minHeight forces flex shrink onto
            the tabs list, which then scrolls within its own area. */}
        {isMap && !isCollapsed && (
          <>
            <div style={{
              flex: '1 1 auto',
              minHeight: 200,
              overflow: 'auto',
              padding: '8px 12px',
            }}>
              <PlayerGroupsButton />
              <InviteManager />
            </div>
            {mode === 'editing' && <AutoSetupButton onNavigate={(id) => selectTab(id as TabId)} collapsed={isCollapsed} />}
            <ExportPanel mode={mode} />
          </>
        )}

        {/* Export at bottom for non-map tabs */}
        {!isMap && (
          <div style={{ marginTop: 'auto' }}>
            {mode === 'editing' && <AutoSetupButton onNavigate={(id) => selectTab(id as TabId)} collapsed={isCollapsed} />}
            <ExportPanel mode={mode} />
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Live mode — the multi-tenant DM terminal (login → group → server
            profile → terminal). Self-contained; doesn't touch Editor/Plan. */}
        {mode === 'live' && <LiveErrorBoundary><LiveTerminal /></LiveErrorBoundary>}
        {mode !== 'live' && (
        <>
        {/* Map tab — map + floating panel */}
        {isMap && (
          <>
            <ParticipantBar />
            <MapContainer
              onDmpiPicked={() => selectTab('dmpi')}
              onAirfieldPicked={undefined}
            />
            {selectedGroupId && <FloatingFlightPanel />}
          </>
        )}

        {/* Editor tabs — scrollable content.
            Keep each tab mounted once it's been visited so local state
            (textareas, toggles, etc.) isn't wiped on tab switch. Inactive
            tabs are hidden via display:none instead of unmounted.

            This whole container also stays MOUNTED while the Map is showing
            (display:none rather than `{!isMap && …}`). Previously a trip to the
            Map unmounted the entire container, wiping every tab's local state
            (e.g. unsaved Brief text) — going Brief → Map → Brief lost work.
            Now the Map renders alongside the hidden container and tab state
            survives the round-trip. */}
        <div style={{ height: '100%', overflow: 'auto', padding: 24, display: isMap ? 'none' : 'block' }}>
            {visitedTabs.has('coalitions') && (
              <div style={{ display: activeTab === 'coalitions' ? 'block' : 'none' }}>
                <CoalitionsTab />
              </div>
            )}
            {visitedTabs.has('threats') && (
              <div style={{ display: activeTab === 'threats' ? 'block' : 'none' }}>
                <ThreatLibraryTab onGoToMap={() => selectTab('map')} />
              </div>
            )}
            {/* v1.19.74 PREVIEW — DatalinkTab mounted as a sub-tab inside RadioTab. */}
            {visitedTabs.has('dtc') && (
              <div style={{ display: activeTab === 'dtc' ? 'block' : 'none' }}>
                <DtcTab />
              </div>
            )}
            {visitedTabs.has('roster') && (
              <div style={{ display: activeTab === 'roster' ? 'block' : 'none' }}>
                <RosterTab />
              </div>
            )}
            {visitedTabs.has('weapons') && (
              <div style={{ display: activeTab === 'weapons' ? 'block' : 'none' }}>
                <WeaponsTab />
              </div>
            )}
            {visitedTabs.has('radio') && (
              <div style={{ display: activeTab === 'radio' ? 'block' : 'none' }}>
                <RadioTab />
              </div>
            )}
            {visitedTabs.has('kneeboard') && (
              <div style={{ display: activeTab === 'kneeboard' ? 'block' : 'none' }}>
                <KneeboardTab />
              </div>
            )}
            {visitedTabs.has('weather') && (
              <div style={{ display: activeTab === 'weather' ? 'block' : 'none' }}>
                {mode === 'planning' ? <MetarReadout /> : <WeatherTab />}
              </div>
            )}
            {visitedTabs.has('livery') && (
              <div style={{ display: activeTab === 'livery' ? 'block' : 'none' }}>
                <LiveryTab />
              </div>
            )}
            {visitedTabs.has('missionEdit') && (
              <div style={{ display: activeTab === 'missionEdit' ? 'block' : 'none' }}>
                <MissionEditTab />
              </div>
            )}
            {visitedTabs.has('goals') && (
              <div style={{ display: activeTab === 'goals' ? 'block' : 'none' }}>
                <GoalsTab />
              </div>
            )}
            {visitedTabs.has('debug') && (
              <div style={{ display: activeTab === 'debug' ? 'block' : 'none' }}>
                <MissionDebugTab />
              </div>
            )}
            {/* v1.19.74 PREVIEW — DMPI + JTAC merged into TargetsTab. */}
            {visitedTabs.has('dmpi') && (
              <div style={{ display: activeTab === 'dmpi' ? 'block' : 'none' }}>
                <TargetsTab />
              </div>
            )}
            {visitedTabs.has('visibility') && (
              <div style={{ display: activeTab === 'visibility' ? 'block' : 'none' }}>
                <VisibilityTab />
              </div>
            )}
            {visitedTabs.has('tools') && (
              <div style={{ display: activeTab === 'tools' ? 'block' : 'none' }}>
                <ToolsTab />
              </div>
            )}
            {visitedTabs.has('scripts') && (
              <div style={{ display: activeTab === 'scripts' ? 'block' : 'none' }}>
                <ScriptsTab />
              </div>
            )}
            {visitedTabs.has('triggers') && (
              <div style={{ display: activeTab === 'triggers' ? 'block' : 'none', height: '100%' }}>
                <TriggerTab />
              </div>
            )}
            {visitedTabs.has('sop') && (
              <div style={{ display: activeTab === 'sop' ? 'block' : 'none' }}>
                <SopTabContainer />
              </div>
            )}
            {visitedTabs.has('briefGen') && (
              <div style={{ display: activeTab === 'briefGen' ? 'block' : 'none', height: '100%' }}>
                <BriefGenTab />
              </div>
            )}
            {/* v1.19.74 PREVIEW — Edits now lives as a drawer beside the
                Download .miz button (see ExportPanel changes). */}
            {visitedTabs.has('upload') && (
              <div style={{ display: activeTab === 'upload' ? 'block' : 'none' }}>
                <UploadPanel onLoaded={() => selectTab('map')} />
              </div>
            )}
        </div>
        </>
        )}
      </div>
      </div>
    </div>
  );
}
