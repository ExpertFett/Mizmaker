import { useMissionStore } from '../store/missionStore';
import { useEditStore } from '../store/editStore';
import { downloadMiz, exportJson, closeSession } from '../api/client';
import { PlayerGroupsButton } from './PlayerGroupsModal';

export function ExportPanel() {
  const { sessionId, filename, clear } = useMissionStore();
  const { edits, isDirty, clearEdits } = useEditStore();

  const handleDownload = async () => {
    if (!sessionId) return;
    try {
      const blob = await downloadMiz(sessionId, edits);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'edited.miz';
      a.click();
      URL.revokeObjectURL(url);
      clearEdits();
    } catch (e) {
      console.error('Download failed:', e);
    }
  };

  const handleExportJson = async () => {
    if (!sessionId) return;
    try {
      const data = await exportJson(sessionId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (filename || 'mission').replace('.miz', '') + '_planning.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  const handleNewFile = async () => {
    if (sessionId) {
      await closeSession(sessionId);
    }
    clearEdits();
    clear();
  };

  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid #1a2a3a' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <PlayerGroupsButton />
        <button onClick={handleDownload} style={btnStyle}>
          Download .miz {isDirty && '*'}
        </button>
        <button onClick={handleExportJson} style={{ ...btnStyle, background: '#1a3a2a' }}>
          Export JSON
        </button>
        <button onClick={handleNewFile} style={{ ...btnStyle, background: '#2a1a1a', color: '#d95050' }}>
          New File
        </button>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#0f2a4a',
  border: '1px solid #1a3a5a',
  borderRadius: 4,
  color: '#ccdae8',
  padding: '8px 12px',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
};
