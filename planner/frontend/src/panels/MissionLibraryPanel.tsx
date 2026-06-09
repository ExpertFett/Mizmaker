/**
 * Mission Library panel (v1.19.73, task #56 Phase B).
 *
 * Renders on the upload screen above the drop zone. Lists the most-
 * recently-opened saved missions and lets the user open one (which
 * re-hydrates the editor state from the IndexedDB snapshot) or
 * delete an old row.
 *
 * Hides entirely when the library is empty so first-time users
 * don't see an empty panel with no explanation — the drop zone
 * stays the primary action until they've saved at least one.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  deleteMission,
  listMissions,
  MISSION_LIBRARY_MAX,
  type MissionLibraryEntry,
} from '../store/missionLibrary';
import { loadLibraryEntry } from '../store/missionLibraryActions';

const PANEL_BG = 'rgba(15, 25, 40, 0.6)';
const ROW_BG = '#1a2030';
const ROW_BORDER = '#2a3a52';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtAgo(ts: number): string {
  const dt = Math.max(0, Date.now() - ts);
  const sec = Math.floor(dt / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function MissionLibraryPanel() {
  const [entries, setEntries] = useState<MissionLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await listMissions());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Failed to read library: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleOpen = useCallback(async (entry: MissionLibraryEntry) => {
    setOpeningId(entry.id);
    setError(null);
    try {
      const ok = await loadLibraryEntry(entry.id);
      if (!ok) {
        setError(`Failed to open "${entry.name}". The entry may be from an older or newer version.`);
      }
      // On success the editor mounts via the missionStore subscription
      // in App.tsx — nothing else to do here.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Open failed: ${msg}`);
    } finally {
      setOpeningId(null);
    }
  }, []);

  const handleDelete = useCallback(async (entry: MissionLibraryEntry) => {
    if (!window.confirm(`Remove "${entry.name}" from your library?\n\nThis only deletes the saved copy in your browser. It does not affect the original .miz file.`)) {
      return;
    }
    try {
      await deleteMission(entry.id);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Delete failed: ${msg}`);
    }
  }, [refresh]);

  // While loading the first time, render nothing so we don't flash
  // an empty panel and then immediately fill it.
  if (loading && entries.length === 0) return null;
  // No saved missions yet — hide entirely so the upload drop zone
  // is the sole call-to-action.
  if (!loading && entries.length === 0 && !error) return null;

  return (
    <div style={{
      background: PANEL_BG,
      border: '1px solid #2a3a52',
      borderRadius: 8,
      padding: '14px 18px',
      marginBottom: 18,
      color: '#e0e0e0',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#4a8fd4', letterSpacing: 0.5 }}>
          ⏱ RECENT MISSIONS
        </div>
        <div style={{ fontSize: 11, color: '#888' }}>
          {entries.length}/{MISSION_LIBRARY_MAX} · saved in this browser only
        </div>
      </div>
      {error && (
        <div style={{
          background: 'rgba(217, 80, 80, 0.10)',
          border: '1px solid rgba(217, 80, 80, 0.45)',
          color: '#ff8080',
          fontSize: 12,
          padding: '6px 10px',
          borderRadius: 4,
          marginBottom: 8,
        }}>{error}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.map((e) => {
          const isOpening = openingId === e.id;
          const edits = Array.isArray(e.snapshot?.edits) ? e.snapshot.edits.length : 0;
          return (
            <div key={e.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: ROW_BG, border: `1px solid ${ROW_BORDER}`,
              borderRadius: 4, padding: '8px 12px',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 500, color: '#e0e0e0',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }} title={e.name}>
                  {e.name}
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {fmtAgo(e.lastOpenedAt)} · {fmtBytes(e.size)}
                  {edits > 0 && (
                    <span style={{ color: '#d29922' }}> · {edits} staged edit{edits !== 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleOpen(e)}
                disabled={isOpening}
                style={{
                  background: isOpening ? '#2a3a52' : 'rgba(74, 143, 212, 0.18)',
                  border: '1px solid rgba(74, 143, 212, 0.55)',
                  color: '#4a8fd4',
                  cursor: isOpening ? 'wait' : 'pointer',
                  fontSize: 12, fontWeight: 600, padding: '5px 14px',
                  borderRadius: 4,
                }}
                title={`Re-open "${e.name}" with all queued edits restored`}
              >
                {isOpening ? 'Opening…' : 'Open'}
              </button>
              <button
                onClick={() => handleDelete(e)}
                title="Remove from library (does not delete the original .miz)"
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(217, 80, 80, 0.4)',
                  color: '#d95050',
                  cursor: 'pointer',
                  fontSize: 12, padding: '5px 10px',
                  borderRadius: 4,
                }}
              >
                🗑
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
