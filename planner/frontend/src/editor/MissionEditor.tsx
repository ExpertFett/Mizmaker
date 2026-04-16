import { useState } from 'react';
import { useMissionStore } from '../store/missionStore';
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
import { DmpiTab } from './tabs/DmpiTab';
import { RangePlanTab } from './tabs/RangePlanTab';
import { UploadPanel } from '../panels/UploadPanel';

const TABS = [
  { id: 'map', label: 'Map', icon: '🗺' },
  { id: 'coalitions', label: 'Coalitions', icon: '⚔' },
  { id: 'threats', label: 'Threats', icon: '⚠' },
  { id: 'datalink', label: 'Datalink', icon: '📡' },
  { id: 'dtc', label: 'DTC', icon: '💾' },
  { id: 'weapons', label: 'Weapons', icon: '💣' },
  { id: 'radio', label: 'Radio', icon: '📻' },
  { id: 'kneeboard', label: 'Kneeboard', icon: '📋' },
  { id: 'weather', label: 'Weather', icon: '🌤' },
  { id: 'livery', label: 'Livery', icon: '🎨' },
  { id: 'missionEdit', label: 'Miz Edit', icon: '🔔' },
  { id: 'debug', label: 'Debug', icon: '🔍' },
  { id: 'dmpi', label: 'DMPI', icon: '🎯' },
  { id: 'rangePlan', label: 'Range', icon: '📐' },
  { id: 'tools', label: 'Tools', icon: '🔧' },
  { id: 'sop', label: 'SOP', icon: '📘' },
  { id: 'upload', label: 'Upload', icon: '📁' },
] as const;

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
      background: '#080f1c',
      display: 'flex',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#ccdae8',
      overflow: 'hidden',
    }}>
      {/* Left sidebar */}
      <div style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        display: 'flex',
        flexDirection: 'column',
        background: '#0a1520',
        borderRight: '1px solid #1a2a3a',
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'width 0.15s, min-width 0.15s',
      }}>
        {/* Header */}
        <div style={{
          padding: isCollapsed ? '10px 6px' : '12px 14px',
          borderBottom: '1px solid #1a2a3a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          minHeight: 42,
        }}>
          {!isCollapsed && (
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#ccdae8', whiteSpace: 'nowrap' }}>{theater}</div>
              {isMap && <div style={{ fontSize: 12, color: '#5a7a8a', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{filename}</div>}
            </div>
          )}
          {isMap && (
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#5a7a8a',
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

        {/* Tab buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 4, borderBottom: '1px solid #1a2a3a', overflow: isCollapsed ? 'hidden' : undefined }}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                title={isCollapsed ? tab.label : undefined}
                style={{
                  background: isActive ? 'rgba(74, 143, 212, 0.08)' : 'transparent',
                  border: 'none',
                  borderLeft: isActive ? '3px solid #4a8fd4' : '3px solid transparent',
                  color: isActive ? '#ccdae8' : '#5a7a8a',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: isCollapsed ? 'center' : 'flex-start',
                  gap: isCollapsed ? 0 : 8,
                  padding: isCollapsed ? '10px 0' : isMap ? '9px 14px' : '11px 14px',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  width: '100%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>{tab.icon}</span>
                {!isCollapsed && tab.label}
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
            <ExportPanel />
          </>
        )}

        {/* Export at bottom for non-map tabs */}
        {!isMap && (
          <div style={{ marginTop: 'auto' }}>
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
            {visitedTabs.has('sop') && (
              <div style={{ display: activeTab === 'sop' ? 'block' : 'none' }}>
                <SopTab />
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
