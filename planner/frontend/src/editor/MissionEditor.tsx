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
import { TriggerTab } from './tabs/TriggerTab';

const TABS = [
  { id: 'map', label: 'Map', icon: '🗺' },
  { id: 'datalink', label: 'Datalink', icon: '📡' },
  { id: 'loadouts', label: 'Loadouts', icon: '💣' },
  { id: 'laser', label: 'Laser', icon: '🎯' },
  { id: 'livery', label: 'Livery', icon: '🎨' },
  { id: 'weather', label: 'Weather', icon: '🌤' },
  { id: 'rename', label: 'Rename', icon: '✏' },
  { id: 'batch', label: 'Batch', icon: '⚡' },
  { id: 'triggers', label: 'Triggers', icon: '⚙' },
  { id: 'kneeboard', label: 'Kneeboard', icon: '📋' },
  { id: 'dtc', label: 'DTC', icon: '💾' },
  { id: 'triggers', label: 'Triggers', icon: '🔔' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function MissionEditor() {
  const [activeTab, setActiveTab] = useState<TabId>('map');
  const sessionId = useMissionStore((s) => s.sessionId);
  const selectedGroupId = useMissionStore((s) => s.selectedGroupId);
  const filename = useMissionStore((s) => s.filename);
  const theater = useMissionStore((s) => s.theater);

  // Connect SSE for real-time sync (heartbeat keepalives prevent Cloudflare 524)
  useSessionStream(sessionId, true);

  const isMap = activeTab === 'map';

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
      {/* Left sidebar — always visible */}
      <div style={{
        width: isMap ? 280 : 140,
        minWidth: isMap ? 280 : 140,
        display: 'flex',
        flexDirection: 'column',
        background: '#0a1520',
        borderRight: '1px solid #1a2a3a',
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'width 0.15s',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #1a2a3a' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#ccdae8' }}>{theater}</div>
          {isMap && <div style={{ fontSize: 12, color: '#5a7a8a', marginTop: 2 }}>{filename}</div>}
        </div>

        {/* Tab buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 4, borderBottom: '1px solid #1a2a3a' }}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: isActive ? 'rgba(74, 143, 212, 0.08)' : 'transparent',
                  border: 'none',
                  borderLeft: isActive ? '3px solid #4a8fd4' : '3px solid transparent',
                  color: isActive ? '#ccdae8' : '#5a7a8a',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: isMap ? '9px 14px' : '11px 14px',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <span style={{ fontSize: 16 }}>{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Flights + export (only on map tab) */}
        {isMap && (
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
            {activeTab === 'triggers' && <TriggerTab />}
            {activeTab === 'kneeboard' && <KneeboardTab />}
            {activeTab === 'dtc' && <DtcTab />}
            {activeTab === 'triggers' && <TriggerTab />}
          </div>
        )}
      </div>
    </div>
  );
}
