import { useMissionStore } from './store/missionStore';
import { UploadPanel } from './panels/UploadPanel';
import { MissionOverview } from './panels/MissionOverview';
import { GroupList } from './panels/GroupList';
import { WaypointPanel } from './panels/WaypointPanel';
import { ExportPanel } from './panels/ExportPanel';
import { MapContainer } from './map/MapContainer';

export default function App() {
  const sessionId = useMissionStore((s) => s.sessionId);
  const selectedGroupId = useMissionStore((s) => s.selectedGroupId);

  if (!sessionId) {
    return <UploadPanel />;
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        background: '#080f1c',
        color: '#ccdae8',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Left sidebar */}
      <div
        style={{
          width: 300,
          minWidth: 300,
          display: 'flex',
          flexDirection: 'column',
          background: '#0a1520',
          borderRight: '1px solid #1a2a3a',
          overflow: 'hidden',
        }}
      >
        <MissionOverview />
        <GroupList />
        <ExportPanel />
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer />
      </div>

      {/* Right panel — waypoints */}
      {selectedGroupId && (
        <div
          style={{
            width: 380,
            minWidth: 380,
            display: 'flex',
            flexDirection: 'column',
            background: '#0a1520',
            borderLeft: '1px solid #1a2a3a',
            overflow: 'hidden',
          }}
        >
          <WaypointPanel />
        </div>
      )}
    </div>
  );
}
