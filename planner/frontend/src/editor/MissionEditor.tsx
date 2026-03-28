import { useState } from 'react';
import { useMapStore } from '../store/mapStore';
import { DatalinkTab } from './tabs/DatalinkTab';
import { LoadoutTab } from './tabs/LoadoutTab';
import { LaserTab } from './tabs/LaserTab';
import { DtcTab } from './tabs/DtcTab';
import { LiveryTab } from './tabs/LiveryTab';
import { WeatherTab } from './tabs/WeatherTab';
import { RenamerTab } from './tabs/RenamerTab';
import { BatchEditTab } from './tabs/BatchEditTab';

const TABS = [
  { id: 'datalink', label: 'Datalink', icon: '📡' },
  { id: 'loadouts', label: 'Loadouts', icon: '💣' },
  { id: 'laser', label: 'Laser', icon: '🎯' },
  { id: 'livery', label: 'Livery', icon: '🎨' },
  { id: 'weather', label: 'Weather', icon: '🌤' },
  { id: 'rename', label: 'Rename', icon: '✏' },
  { id: 'dtc', label: 'DTC', icon: '💾' },
  { id: 'batch', label: 'Batch Edit', icon: '⚡' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function MissionEditor() {
  const [activeTab, setActiveTab] = useState<TabId>('datalink');
  const setEditorMode = useMapStore((s) => s.setEditorMode);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#080f1c',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#ccdae8',
      zIndex: 500,
    }}>
      {/* Top bar */}
      <div style={{
        height: 48,
        background: '#0a1520',
        borderBottom: '1px solid #1a2a3a',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 16,
        flexShrink: 0,
      }}>
        <button
          onClick={() => setEditorMode(false)}
          style={{
            background: 'transparent',
            border: '1px solid #1a2a3a',
            borderRadius: 4,
            color: '#8fa8c0',
            cursor: 'pointer',
            fontSize: 13,
            padding: '5px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          ← Back to Map
        </button>
        <span style={{ fontWeight: 600, fontSize: 16, color: '#ccdae8' }}>Mission Editor</span>
      </div>

      {/* Body: sidebar + content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left sidebar tabs */}
        <div style={{
          width: 140,
          background: '#0a1520',
          borderRight: '1px solid #1a2a3a',
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 8,
          flexShrink: 0,
        }}>
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
                  padding: '10px 14px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                <span style={{ fontSize: 16 }}>{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {activeTab === 'datalink' && <DatalinkTab />}
          {activeTab === 'loadouts' && <LoadoutTab />}
          {activeTab === 'laser' && <LaserTab />}
          {activeTab === 'livery' && <LiveryTab />}
          {activeTab === 'weather' && <WeatherTab />}
          {activeTab === 'rename' && <RenamerTab />}
          {activeTab === 'dtc' && <DtcTab />}
          {activeTab === 'batch' && <BatchEditTab />}
        </div>
      </div>
    </div>
  );
}

