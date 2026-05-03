import { useState, useMemo } from 'react';
import { useMissionStore } from '../store/missionStore';
import { useEditStore } from '../store/editStore';
import { useSopStore } from '../sop/sopStore';
import { useSessionStream } from '../session/useSessionStream';
import { ParticipantBar } from '../session/ParticipantBar';
import { InviteManager } from '../session/InviteManager';
import { MapContainer } from '../map/MapContainer';
import { FloatingFlightPanel } from '../panels/FloatingFlightPanel';
import { ExportPanel } from '../panels/ExportPanel';
import { PlayerGroupsButton } from '../panels/PlayerGroupsModal';
import { DatalinkTab } from './tabs/DatalinkTab';
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
import { SopTab } from './tabs/SopTab';
import { SopCheckTab } from './tabs/SopCheckTab';
import { EditsTab } from './tabs/EditsTab';
import { AutoSetupButton } from './AutoSetupButton';
import { DmpiTab } from './tabs/DmpiTab';
import { RangePlanTab } from './tabs/RangePlanTab';
import { BriefGenTab } from './tabs/BriefGenTab';
import { CarriersTab } from './tabs/CarriersTab';
import { ScriptsTab } from './tabs/ScriptsTab';
import { TriggerTab } from './tabs/TriggerTab';
import { UploadPanel } from '../panels/UploadPanel';

// Sidebar layout — workflow phases. Each tab is a top-level destination;
// section headers ('SETUP', 'ENTITIES', etc.) act as visual dividers
// only, not clickable. Order is start-of-mission → finish-of-mission.
//
// Carriers and Scripts are top-level (promoted from the v0.6 Tools→Rename
// collapsibles). Old "Weapons" → "Loadout", old "Miz Edit" → "Mission".
type TabDef = { id: string; label: string; icon: string };
type SidebarItem = { kind: 'section'; label: string } | (TabDef & { kind: 'tab' });

const SIDEBAR: SidebarItem[] = [
  { kind: 'section', label: 'SETUP' },
  { kind: 'tab', id: 'map',         label: 'Map',         icon: '🗺' },
  // SOP comes early because callsigns, freqs, TACAN channels, ICLS
  // assignments etc. defined here drive defaults all over the rest of
  // the planner (CommCardTab auto-deconflict, carrier setup, kneeboards).
  // Loading the right SOP first means the downstream tabs start
  // pre-configured for the squadron / era you're flying.
  { kind: 'tab', id: 'sop',         label: 'SOP',         icon: '📘' },
  // SOP Check sits next to SOP — read-only comparison panel that flags
  // where the loaded mission disagrees with the active SOP. Empty
  // state when no SOP active or no mission loaded.
  { kind: 'tab', id: 'sopCheck',    label: 'SOP Check',   icon: '✓' },
  { kind: 'tab', id: 'coalitions',  label: 'Coalitions',  icon: '⚔' },
  { kind: 'tab', id: 'missionEdit', label: 'Mission',     icon: '🔔' },
  { kind: 'tab', id: 'weather',     label: 'Weather',     icon: '🌤' },

  { kind: 'section', label: 'ENTITIES' },
  { kind: 'tab', id: 'carriers',    label: 'Carriers',    icon: '⚓' },
  { kind: 'tab', id: 'scripts',     label: 'Scripts',     icon: '📜' },
  // Triggers comes AFTER Carriers + Scripts because both of those
  // panels auto-append trigger rules (Carrier Control + 13 TIC rules
  // from Carriers, framework load triggers from Scripts). By the time
  // the user opens this tab the rules are already there — they're
  // verifying / tweaking, not authoring from scratch.
  { kind: 'tab', id: 'triggers',    label: 'Triggers',    icon: '⚡' },

  // PLANNING comes BEFORE flights — threat picture, target list, and
  // range/fuel constraints all drive the loadout / radio / DTC choices
  // for each player flight. Doing FLIGHTS first means you'd commit to a
  // loadout, then go look at threats and realize you brought the wrong
  // weapons.
  { kind: 'section', label: 'PLANNING' },
  { kind: 'tab', id: 'threats',     label: 'Threats',     icon: '⚠' },
  { kind: 'tab', id: 'dmpi',        label: 'DMPI',        icon: '🎯' },
  { kind: 'tab', id: 'rangePlan',   label: 'Range',       icon: '📐' },

  { kind: 'section', label: 'FLIGHTS' },
  { kind: 'tab', id: 'weapons',     label: 'Loadout',     icon: '💣' },
  { kind: 'tab', id: 'datalink',    label: 'Datalink',    icon: '📡' },
  { kind: 'tab', id: 'radio',       label: 'Radio',       icon: '📻' },
  { kind: 'tab', id: 'dtc',         label: 'DTC',         icon: '💾' },
  { kind: 'tab', id: 'livery',      label: 'Livery',      icon: '🎨' },

  { kind: 'section', label: 'OUTPUT' },
  { kind: 'tab', id: 'kneeboard',   label: 'Kneeboard',   icon: '📋' },
  { kind: 'tab', id: 'briefGen',    label: 'Brief',       icon: '📝' },
  // Edits preview — read-only inventory of every edit currently
  // queued for the next download. Lives in OUTPUT because it's a
  // pre-download summary view, same as Kneeboard / Brief.
  { kind: 'tab', id: 'edits',       label: 'Edits',       icon: '✎' },

  { kind: 'section', label: 'UTIL' },
  { kind: 'tab', id: 'debug',       label: 'Debug',       icon: '🔍' },
  { kind: 'tab', id: 'tools',       label: 'Tools',       icon: '🔧' },
  { kind: 'tab', id: 'upload',      label: 'Upload',      icon: '📁' },
];

const TABS = SIDEBAR.filter((s): s is TabDef & { kind: 'tab' } => s.kind === 'tab');

type TabId = (typeof TABS)[number]['id'];

export function MissionEditor() {
  const [activeTab, setActiveTab] = useState<TabId>('map');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Track which editor tabs have been opened. Once mounted, we keep them in
  // the DOM (hidden with display:none) so local useState edits survive tab
  // switches — the previous pattern (`{activeTab === 'x' && <Tab />}`) unmounted
  // the tab on switch and discarded any in-progress edits.
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(() => new Set(['map']));
  const sessionId = useMissionStore((s) => s.sessionId);
  const selectedGroupId = useMissionStore((s) => s.selectedGroupId);
  const filename = useMissionStore((s) => s.filename);
  const theater = useMissionStore((s) => s.theater);

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

  // Pending-edit count, rendered as a small badge on the Edits tab so
  // the queue size is visible without leaving the current tab.
  const pendingEditCount = useEditStore((s) => s.edits.length);

  const selectTab = (tab: TabId) => {
    setActiveTab(tab);
    setVisitedTabs((prev) => prev.has(tab) ? prev : new Set(prev).add(tab));
  };

  // Connect SSE for real-time sync (heartbeat keepalives prevent Cloudflare 524)
  useSessionStream(sessionId, true);

  const isMap = activeTab === 'map';
  // Only allow collapse on map page
  const isCollapsed = isMap && sidebarCollapsed;
  const sidebarWidth = isCollapsed ? 44 : isMap ? 280 : 140;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#1a1a1a',
      display: 'flex',
      // Inherit from body (B612). Set explicitly so any portal-mounted
      // children that escape the body cascade still get the right stack.
      fontFamily: "'B612', 'IBM Plex Sans', 'Inter', system-ui, sans-serif",
      color: '#e0e0e0',
      overflow: 'hidden',
    }}>
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
              <div style={{ fontSize: 15, fontWeight: 600, color: '#e0e0e0', whiteSpace: 'nowrap' }}>{theater}</div>
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

        {/* Tab buttons + section dividers */}
        <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 4, borderBottom: '1px solid #3a3a3a', overflow: isCollapsed ? 'hidden' : undefined }}>
          {SIDEBAR.map((item, idx) => {
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
            const showSopDot = activeSop != null && (item.id === 'sop' || item.id === 'sopCheck');
            // Edits-tab count badge — same spirit as the SOP dot but
            // shows a number so you can see at a glance how many edits
            // are queued without switching tabs.
            const showEditsCount = item.id === 'edits' && pendingEditCount > 0;
            return (
              <button
                key={item.id}
                onClick={() => selectTab(item.id as TabId)}
                title={isCollapsed
                  ? (showSopDot ? `${item.label} — SOP: ${activeSop!.name}` : item.label)
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
                <span style={{ fontSize: 15, flexShrink: 0 }}>{item.icon}</span>
                {!isCollapsed && item.label}
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
                {showEditsCount && (
                  <span
                    title={`${pendingEditCount} edit${pendingEditCount !== 1 ? 's' : ''} queued`}
                    style={{
                      // Style the count as a compact pill. Blue (not
                      // red) because queued edits are normal flow, not
                      // a problem. Red would be alarming.
                      background: '#1a3050',
                      border: '1px solid #2a5a8a',
                      color: '#6ab4f0',
                      borderRadius: 10,
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '1px 6px',
                      letterSpacing: 0.3,
                      flexShrink: 0,
                      marginLeft: isCollapsed ? 0 : 'auto',
                      ...(isCollapsed
                        ? {
                            position: 'absolute',
                            top: 2,
                            right: 2,
                            padding: '1px 4px',
                            fontSize: 9,
                            marginLeft: 0,
                          }
                        : {}),
                    }}
                  >
                    {pendingEditCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Flights + export (only on map tab, not collapsed) */}
        {isMap && !isCollapsed && (
          <>
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
              <PlayerGroupsButton />
              <InviteManager />
            </div>
            <AutoSetupButton onNavigate={(id) => selectTab(id as TabId)} collapsed={isCollapsed} />
            <ExportPanel />
          </>
        )}

        {/* Export at bottom for non-map tabs */}
        {!isMap && (
          <div style={{ marginTop: 'auto' }}>
            <AutoSetupButton onNavigate={(id) => selectTab(id as TabId)} collapsed={isCollapsed} />
            <ExportPanel />
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Map tab — map + floating panel */}
        {isMap && (
          <>
            <ParticipantBar />
            <MapContainer />
            {selectedGroupId && <FloatingFlightPanel />}
          </>
        )}

        {/* Editor tabs — scrollable content.
            Keep each tab mounted once it's been visited so local state
            (textareas, toggles, etc.) isn't wiped on tab switch. Inactive
            tabs are hidden via display:none instead of unmounted. */}
        {!isMap && (
          <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
            {visitedTabs.has('coalitions') && (
              <div style={{ display: activeTab === 'coalitions' ? 'block' : 'none' }}>
                <CoalitionsTab />
              </div>
            )}
            {visitedTabs.has('threats') && (
              <div style={{ display: activeTab === 'threats' ? 'block' : 'none' }}>
                <ThreatLibraryTab />
              </div>
            )}
            {visitedTabs.has('datalink') && (
              <div style={{ display: activeTab === 'datalink' ? 'block' : 'none' }}>
                <DatalinkTab />
              </div>
            )}
            {visitedTabs.has('dtc') && (
              <div style={{ display: activeTab === 'dtc' ? 'block' : 'none' }}>
                <DtcTab />
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
                <WeatherTab />
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
            {visitedTabs.has('debug') && (
              <div style={{ display: activeTab === 'debug' ? 'block' : 'none' }}>
                <MissionDebugTab />
              </div>
            )}
            {visitedTabs.has('dmpi') && (
              <div style={{ display: activeTab === 'dmpi' ? 'block' : 'none' }}>
                <DmpiTab />
              </div>
            )}
            {visitedTabs.has('rangePlan') && (
              <div style={{ display: activeTab === 'rangePlan' ? 'block' : 'none' }}>
                <RangePlanTab />
              </div>
            )}
            {visitedTabs.has('tools') && (
              <div style={{ display: activeTab === 'tools' ? 'block' : 'none' }}>
                <ToolsTab />
              </div>
            )}
            {visitedTabs.has('carriers') && (
              <div style={{ display: activeTab === 'carriers' ? 'block' : 'none' }}>
                <CarriersTab />
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
                <SopTab />
              </div>
            )}
            {visitedTabs.has('sopCheck') && (
              <div style={{ display: activeTab === 'sopCheck' ? 'block' : 'none' }}>
                <SopCheckTab />
              </div>
            )}
            {visitedTabs.has('briefGen') && (
              <div style={{ display: activeTab === 'briefGen' ? 'block' : 'none', height: '100%' }}>
                <BriefGenTab />
              </div>
            )}
            {visitedTabs.has('edits') && (
              <div style={{ display: activeTab === 'edits' ? 'block' : 'none' }}>
                <EditsTab />
              </div>
            )}
            {visitedTabs.has('upload') && (
              <div style={{ display: activeTab === 'upload' ? 'block' : 'none' }}>
                <UploadPanel onLoaded={() => selectTab('map')} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
