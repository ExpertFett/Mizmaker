import { useMissionStore } from './store/missionStore';
import { useMapStore } from './store/mapStore';
import { UploadPanel } from './panels/UploadPanel';
import { ExportPanel } from './panels/ExportPanel';
import { PlayerGroupsButton } from './panels/PlayerGroupsModal';
import { MapContainer } from './map/MapContainer';
import { FloatingFlightPanel } from './panels/FloatingFlightPanel';
import { MissionEditor } from './editor/MissionEditor';

export default function App() {
  const sessionId = useMissionStore((s) => s.sessionId);
  const selectedGroupId = useMissionStore((s) => s.selectedGroupId);
  const filename = useMissionStore((s) => s.filename);
  const theater = useMissionStore((s) => s.theater);
  const editorMode = useMapStore((s) => s.editorMode);
  const setEditorMode = useMapStore((s) => s.setEditorMode);

  if (!sessionId) {
    return <UploadPanel />;
  }

  if (editorMode) {
    return <MissionEditor />;
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
      {/* Left sidebar — flights + export */}
      <div
        style={{
          width: 280,
          minWidth: 280,
          display: 'flex',
          flexDirection: 'column',
          background: '#0a1520',
          borderRight: '1px solid #1a2a3a',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #1a2a3a' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#ccdae8' }}>{theater}</div>
          <div style={{ fontSize: 11, color: '#5a7a8a', marginTop: 2 }}>{filename}</div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
          <PlayerGroupsButton />
          <button
            onClick={() => setEditorMode(true)}
            style={{
              width: '100%',
              marginTop: 8,
              background: '#0f2a4a',
              border: '1px solid #1a3a5a',
              borderRadius: 4,
              color: '#ccdae8',
              padding: '7px 10px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            Mission Editor
          </button>
        </div>
        <ExportPanel />
      </div>

      {/* Map area */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer />
        {selectedGroupId && <FloatingFlightPanel />}
      </div>
    </div>
  );
}
