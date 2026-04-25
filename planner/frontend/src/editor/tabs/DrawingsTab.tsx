import { useEffect, useState } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useDrawingStore } from '../../store/drawingStore';
import { generateDrawings } from '../../utils/autoDrawings';
import { savePlannerDrawings, getPlannerDrawings } from '../../api/client';
import type { PlannerDrawingType } from '../../types/mission';

// ── Styles ────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #3a3a3a', borderRadius: 8, padding: 14, marginBottom: 12,
};
const label: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#888888', marginBottom: 6,
};
const input: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #3a3a3a', borderRadius: 4, color: '#e0e0e0',
  padding: '5px 8px', fontSize: 14, width: '100%', boxSizing: 'border-box',
};
const btn: React.CSSProperties = {
  background: '#3a3a3a', border: '1px solid #3a3a3a', borderRadius: 4, color: '#cccccc',
  padding: '5px 12px', fontSize: 13, cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = { ...btn, background: '#4a4a4a', color: '#6ab4f0', borderColor: '#2a5a8a' };
const btnDanger: React.CSSProperties = { ...btn, background: '#3a1a1a', color: '#e06060', borderColor: '#5a2a2a' };
const btnSuccess: React.CSSProperties = { ...btn, background: '#1a3a2a', color: '#60c080', borderColor: '#2a5a3a' };

const TYPE_LABELS: Record<PlannerDrawingType, string> = {
  corridor: 'Corridor',
  threatRing: 'Threat Ring',
  referenceLine: 'Ref Line',
  racetrack: 'Racetrack',
};

const TYPE_ICONS: Record<PlannerDrawingType, string> = {
  corridor: '\u2550',
  threatRing: '\u25CB',
  referenceLine: '\u2500',
  racetrack: '\u2B2D',
};

export function DrawingsTab() {
  const sessionId = useMissionStore((s) => s.sessionId);
  const groups = useMissionStore((s) => s.groups);
  const { drawings, selectedDrawingId, isDirty, selectDrawing, updateDrawing, deleteDrawing, toggleVisibility, loadDrawings, markClean } = useDrawingStore();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  // On mount: try to load saved drawings from server, or auto-generate
  useEffect(() => {
    if (!sessionId || loaded) return;
    getPlannerDrawings(sessionId)
      .then((saved) => {
        if (saved.length > 0) {
          loadDrawings(saved);
        } else {
          // No saved drawings — auto-generate from mission data
          const auto = generateDrawings(groups);
          loadDrawings(auto);
        }
        setLoaded(true);
      })
      .catch(() => {
        // Fallback: auto-generate
        const auto = generateDrawings(groups);
        loadDrawings(auto);
        setLoaded(true);
      });
  }, [sessionId, loaded]);

  const handleRegenerate = () => {
    const auto = generateDrawings(groups);
    loadDrawings(auto);
  };

  const handleSave = async () => {
    if (!sessionId) return;
    setSaving(true);
    try {
      await savePlannerDrawings(sessionId, drawings);
      markClean();
      setStatus('Saved');
      setTimeout(() => setStatus(''), 2000);
    } catch {
      setStatus('Save failed');
    }
    setSaving(false);
  };

  // Count by type
  const racetracks = drawings.filter((d) => d.type === 'racetrack');
  const corridors = drawings.filter((d) => d.type === 'corridor');

  return (
    <div style={{ maxWidth: 700 }}>
      {/* Under Construction banner */}
      <div style={{
        background: 'rgba(210, 153, 34, 0.1)', border: '1px solid #d29922', borderRadius: 6,
        padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10,
        color: '#d29922', fontSize: 13, fontWeight: 500,
      }}>
        <span style={{ fontSize: 18 }}>&#x1F6A7;</span>
        Under Construction — This feature is still being developed.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#e0e0e0' }}>Mission Overlays</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {status && <span style={{ fontSize: 12, color: status === 'Saved' ? '#60c080' : '#e06060' }}>{status}</span>}
          <button onClick={handleRegenerate} style={btnPrimary} title="Scan mission data and generate overlays">
            Generate
          </button>
          <button onClick={handleSave} disabled={saving || !isDirty} style={{
            ...btnSuccess, opacity: isDirty ? 1 : 0.5,
          }}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>

      <div style={{ ...card, background: '#222222', fontSize: 12, color: '#aaaaaa', lineHeight: 1.6 }}>
        Scans mission data for tanker, AWACS, and CAP groups to create racetrack orbits, and player flights for route corridors.
        Click <strong style={{ color: '#6ab4f0' }}>Generate</strong> to create overlays, then toggle visibility, adjust properties, or delete as needed.
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ ...card, flex: 1, textAlign: 'center', marginBottom: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#d29922' }}>{racetracks.length}</div>
          <div style={{ fontSize: 11, color: '#aaaaaa' }}>Racetracks</div>
        </div>
        <div style={{ ...card, flex: 1, textAlign: 'center', marginBottom: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#4a8fd4' }}>{corridors.length}</div>
          <div style={{ fontSize: 11, color: '#aaaaaa' }}>Corridors</div>
        </div>
        <div style={{ ...card, flex: 1, textAlign: 'center', marginBottom: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#e0e0e0' }}>{drawings.filter((d) => d.visible).length}</div>
          <div style={{ fontSize: 11, color: '#aaaaaa' }}>Visible</div>
        </div>
      </div>

      {/* Drawing list */}
      {drawings.length === 0 && (
        <div style={{ ...card, color: '#aaaaaa', textAlign: 'center', fontSize: 13 }}>
          No overlays yet. Click <strong style={{ color: '#6ab4f0' }}>Generate</strong> above to scan the mission.
        </div>
      )}

      {drawings.map((d) => {
        const isSelected = d.id === selectedDrawingId;
        return (
          <div key={d.id} style={{
            ...card,
            border: isSelected ? `1px solid ${d.color}` : '1px solid #3a3a3a',
            cursor: 'pointer',
            opacity: d.visible ? 1 : 0.5,
          }} onClick={() => selectDrawing(isSelected ? null : d.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Visibility toggle */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleVisibility(d.id); }}
                title={d.visible ? 'Hide' : 'Show'}
                style={{
                  ...btn, padding: '2px 6px', fontSize: 16,
                  color: d.visible ? '#e0e0e0' : '#4a4a4a',
                  background: 'transparent', border: 'none',
                }}
              >
                {d.visible ? '\u25C9' : '\u25CB'}
              </button>

              {/* Color swatch */}
              <input
                type="color"
                value={d.color}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => updateDrawing(d.id, { color: e.target.value })}
                style={{ width: 24, height: 24, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
              />

              {/* Type icon + name */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: d.color }}>
                  <span style={{ marginRight: 6, fontSize: 12, opacity: 0.7 }}>{TYPE_ICONS[d.type]}</span>
                  {d.name}
                </div>
                <div style={{ fontSize: 11, color: '#aaaaaa' }}>
                  {TYPE_LABELS[d.type]}
                  {(d.type === 'corridor' || d.type === 'racetrack') && ` \u00b7 ${d.widthNm ?? 5} NM wide`}
                  {d.type === 'threatRing' && ` \u00b7 ${d.radiusNm ?? 20} NM radius`}
                  {d.type === 'referenceLine' && ` \u00b7 ${d.lineStyle ?? 'dashed'}`}
                  {` \u00b7 ${d.coords.length} pt${d.coords.length !== 1 ? 's' : ''}`}
                </div>
              </div>

              {/* Delete */}
              <button
                onClick={(e) => { e.stopPropagation(); deleteDrawing(d.id); }}
                style={{ ...btnDanger, padding: '2px 8px', fontSize: 12 }}
              >\u2715</button>
            </div>

            {/* Expanded edit panel */}
            {isSelected && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #3a3a3a' }}
                onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={label}>Name</div>
                    <input
                      value={d.name}
                      onChange={(e) => updateDrawing(d.id, { name: e.target.value })}
                      style={input}
                    />
                  </div>
                </div>

                {(d.type === 'corridor' || d.type === 'racetrack') && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={label}>Width (NM)</div>
                    <input
                      type="number" min={1} max={100} step={1}
                      value={d.widthNm ?? 5}
                      onChange={(e) => updateDrawing(d.id, { widthNm: Number(e.target.value) || 5 })}
                      style={{ ...input, width: 100 }}
                    />
                  </div>
                )}

                {d.type === 'threatRing' && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={label}>Radius (NM)</div>
                    <input
                      type="number" min={1} max={500} step={1}
                      value={d.radiusNm ?? 20}
                      onChange={(e) => updateDrawing(d.id, { radiusNm: Number(e.target.value) || 20 })}
                      style={{ ...input, width: 100 }}
                    />
                  </div>
                )}

                {d.type === 'referenceLine' && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={label}>Line Style</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['dashed', 'solid'] as const).map((ls) => (
                        <button key={ls} onClick={() => updateDrawing(d.id, { lineStyle: ls })} style={{
                          ...btn,
                          background: d.lineStyle === ls ? '#4a4a4a' : '#262626',
                          border: `1px solid ${d.lineStyle === ls ? '#4a8fd4' : '#3a3a3a'}`,
                          color: d.lineStyle === ls ? '#e0e0e0' : '#aaaaaa',
                          textTransform: 'capitalize',
                        }}>{ls}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
