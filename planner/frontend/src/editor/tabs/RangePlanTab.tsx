/**
 * Range Plan Tab — training range information.
 *
 * Manually entered range details: name, coordinates, frequencies,
 * restrictions, hot/cold times. Session-only.
 */

import { useState, useCallback } from 'react';

interface Range {
  id: string;
  name: string;
  frequency: string;
  altitudeMin: string;
  altitudeMax: string;
  hotTime: string;
  coldTime: string;
  restrictions: string;
  notes: string;
}

function makeId() {
  return `rng_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function RangePlanTab() {
  const [ranges, setRanges] = useState<Range[]>([]);

  const addRange = useCallback(() => {
    setRanges((prev) => [...prev, {
      id: makeId(), name: `Range ${prev.length + 1}`,
      frequency: '', altitudeMin: '', altitudeMax: '',
      hotTime: '', coldTime: '', restrictions: '', notes: '',
    }]);
  }, []);

  const updateRange = useCallback((id: string, patch: Partial<Range>) => {
    setRanges((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  }, []);

  const removeRange = useCallback((id: string) => {
    setRanges((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#ccdae8' }}>
            Range Plan
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#5a7a8a' }}>
            Training range information — names, frequencies, restrictions, hot/cold times.
          </p>
        </div>
        <button onClick={addRange} style={addBtn}>+ Add Range</button>
      </div>

      {ranges.length === 0 ? (
        <div style={{
          padding: '40px 20px', textAlign: 'center',
          background: 'rgba(74, 143, 212, 0.04)',
          border: '1px solid #1a3a5a', borderRadius: 6,
          color: '#5a7a8a', fontSize: 13,
        }}>
          No ranges defined. Click "+ Add Range" to add training range information.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ranges.map((r, i) => (
            <div key={r.id} style={{
              background: '#0a1520', border: '1px solid #1a2a3a',
              borderRadius: 6, padding: 14,
              borderLeft: '3px solid #d29922',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ color: '#d29922', fontWeight: 700, fontSize: 14 }}>#{i + 1}</span>
                <input value={r.name} onChange={(e) => updateRange(r.id, { name: e.target.value })}
                  style={{ ...inputStyle, flex: 1, fontSize: 15, fontWeight: 600, color: '#ccdae8' }}
                  placeholder="Range Name" />
                <button onClick={() => removeRange(r.id)} style={xBtn}>×</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={lblStyle}>Frequency</label>
                  <input value={r.frequency} onChange={(e) => updateRange(r.id, { frequency: e.target.value })}
                    style={{ ...inputStyle, width: '100%' }} placeholder="e.g. 275.800 AM" />
                </div>
                <div>
                  <label style={lblStyle}>Min Altitude</label>
                  <input value={r.altitudeMin} onChange={(e) => updateRange(r.id, { altitudeMin: e.target.value })}
                    style={{ ...inputStyle, width: '100%' }} placeholder="e.g. 500 AGL" />
                </div>
                <div>
                  <label style={lblStyle}>Max Altitude</label>
                  <input value={r.altitudeMax} onChange={(e) => updateRange(r.id, { altitudeMax: e.target.value })}
                    style={{ ...inputStyle, width: '100%' }} placeholder="e.g. FL250" />
                </div>
                <div>
                  <label style={lblStyle}>Hot Time</label>
                  <input value={r.hotTime} onChange={(e) => updateRange(r.id, { hotTime: e.target.value })}
                    style={{ ...inputStyle, width: '100%' }} placeholder="e.g. 0800-1200Z" />
                </div>
                <div>
                  <label style={lblStyle}>Cold Time</label>
                  <input value={r.coldTime} onChange={(e) => updateRange(r.id, { coldTime: e.target.value })}
                    style={{ ...inputStyle, width: '100%' }} placeholder="e.g. 1200-1300Z" />
                </div>
                <div>
                  <label style={lblStyle}>Restrictions</label>
                  <input value={r.restrictions} onChange={(e) => updateRange(r.id, { restrictions: e.target.value })}
                    style={{ ...inputStyle, width: '100%' }} placeholder="e.g. No live ordnance" />
                </div>
              </div>

              <div style={{ marginTop: 8 }}>
                <label style={lblStyle}>Notes</label>
                <textarea value={r.notes} onChange={(e) => updateRange(r.id, { notes: e.target.value })}
                  rows={2}
                  style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
                  placeholder="Additional range information..." />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 3,
  color: '#8fa8c0', fontSize: 13, padding: '5px 8px', fontFamily: 'inherit',
  boxSizing: 'border-box',
};
const lblStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, color: '#5a7a8a',
  fontWeight: 600, marginBottom: 3, textTransform: 'uppercase',
  letterSpacing: 0.5,
};
const addBtn: React.CSSProperties = {
  background: '#1a3a5a', border: '1px solid #4a8fd4', borderRadius: 4,
  color: '#4a8fd4', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  padding: '6px 14px', fontFamily: 'inherit',
};
const xBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#5a7a8a',
  cursor: 'pointer', fontSize: 18, padding: '0 4px',
};
