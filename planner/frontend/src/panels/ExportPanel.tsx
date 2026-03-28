import { useMissionStore } from '../store/missionStore';
import { useEditStore } from '../store/editStore';
import { downloadMiz, exportJson, closeSession } from '../api/client';

export function ExportPanel() {
  const { sessionId, filename, clear, groups } = useMissionStore();
  const { edits, isDirty, clearEdits } = useEditStore();

  const handleDownload = async () => {
    if (!sessionId) return;
    try {
      // Build modifiedGroups: send final waypoint state for any group that was edited
      const editedGroupIds = new Set<number>();
      for (const e of edits) {
        const gid = (e as any).groupId;
        if (gid != null) editedGroupIds.add(gid);
      }

      const modifiedGroups: Record<string, { waypoints: unknown[] }> = {};
      for (const gid of editedGroupIds) {
        const group = groups.find((g) => g.groupId === gid);
        if (group) {
          modifiedGroups[group.groupName] = {
            waypoints: group.waypoints,
          };
        }
      }

      const blob = await downloadMiz(sessionId, edits, modifiedGroups);
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
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a2a3a' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={handleDownload} style={{ ...btnStyle, flex: 1 }}>
          {isDirty ? 'Download .miz *' : 'Download .miz'}
        </button>
        <button onClick={handleExportJson} style={{ ...btnStyle, background: '#1a3a2a' }}>
          JSON
        </button>
        <button onClick={handleNewFile} style={{ ...btnStyle, background: '#2a1a1a', color: '#d95050' }}>
          New
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
  padding: '7px 10px',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
};
