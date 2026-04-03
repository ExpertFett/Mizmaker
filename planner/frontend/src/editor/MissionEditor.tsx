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
import { LoadoutTab } from './tabs/LoadoutTab';
import { LaserTab } from './tabs/LaserTab';
import { DtcTab } from './tabs/DtcTab';
import { LiveryTab } from './tabs/LiveryTab';
import { WeatherTab } from './tabs/WeatherTab';
import { RenamerTab } from './tabs/RenamerTab';
import { BatchEditTab } from './tabs/BatchEditTab';
import { TriggerTab } from './tabs/TriggerTab';
import { KneeboardTab } from './tabs/KneeboardTab';
import { DrawingsTab } from './tabs/DrawingsTab';
import { UploadPanel } from '../panels/UploadPanel';

const TABS = [
  { id: 'map', label: 'Map', icon: '🗺' },
  { id: 'datalink', label: 'Datalink', icon: '📡' },
  { id: 'loadouts', label: 'Loadouts', icon: '💣' },
  { id: 'laser', label: 'Laser', icon: '🎯' },
  { id: 'livery', label: 'Livery', icon: '🎨' },
  { id: 'weather', label: 'Weather', icon: '🌤' },
  { id: 'rename', label: 'Rename', icon: '✏' },
  { id: 'batch', label: 'Batch', icon: '⚡' },
  { id: 'kneeboard', label: 'Kneeboard', icon: '📋' },
  { id: 'dtc', label: 'DTC', icon: '💾' },
  { id: 'triggers', label: 'Triggers', icon: '🔔' },
  { id: 'drawings', label: 'Drawings', icon: '📐' },
  { id: 'upload', label: 'Upload', icon: '📁' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function MissionEditor() {
  const [activeTab, setActiveTab] = useState<TabId>('map');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sessionId = useMissionStore((s) => s.sessionId);
  const selectedGroupId = useMissionStore((s) => s.selectedGroupId);
  const filename = useMissionStore((s) => s.filename);
  const theater = useMissionStore((s) => s.theater);

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
                onClick={() => setActiveTab(tab.id)}
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

        {/* Editor tabs — scrollable content */}
        {!isMap && (
          <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
            {activeTab === 'datalink' && <DatalinkTab />}
            {activeTab === 'loadouts' && <LoadoutTab />}
            {activeTab === 'laser' && <LaserTab />}
            {activeTab === 'livery' && <LiveryTab />}
            {activeTab === 'weather' && <WeatherTab />}
            {activeTab === 'rename' && <RenamerTab />}
            {activeTab === 'batch' && <BatchEditTab />}
            {activeTab === 'kneeboard' && <KneeboardTab />}
            {activeTab === 'dtc' && <DtcTab />}
            {activeTab === 'triggers' && <TriggerTab />}
            {activeTab === 'drawings' && <DrawingsTab />}
            {activeTab === 'upload' && <UploadPanel />}
          </div>
        )}
      </div>
    </div>
  );
}
