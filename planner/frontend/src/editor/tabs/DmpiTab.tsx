/**
 * DMPI Tab — Designated Mean Points of Impact.
 *
 * Target designation points with coordinates, elevation, description,
 * and weapon delivery method. Session-only (not written to .miz).
 */

import { useState, useCallback } from 'react';
import { forward as toMGRS } from 'mgrs';

interface Dmpi {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevation: number;
  description: string;
  weaponDelivery: string;
  notes: string;
}

function makeId() {
  return `dmpi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function fmtMgrs(lat: number, lon: number): string {
  try { return toMGRS([lon, lat], 4); } catch { return '—'; }
}

export function DmpiTab() {
  const [dmpis, setDmpis] = useState<Dmpi[]>([]);

  const addDmpi = useCallback(() => {
    setDmpis((prev) => [...prev, {
      id: makeId(), name: `DMPI ${prev.length + 1}`,
      lat: 0, lon: 0, elevation: 0,
      description: '', weaponDelivery: '', notes: '',
    }]);
  }, []);

  const updateDmpi = useCallback((id: string, patch: Partial<Dmpi>) => {
    setDmpis((prev) => prev.map((d) => d.id === id ? { ...d, ...patch } : d));
  }, []);

  const removeDmpi = useCallback((id: string) => {
    setDmpis((prev) => prev.filter((d) => d.id !== id));
  }, []);

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
            DMPI — Designated Mean Points of Impact
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#aaaaaa' }}>
            Define target designation points for strike missions. Data is session-only (not saved to .miz).
          </p>
        </div>
        <button onClick={addDmpi} style={addBtn}>+ Add DMPI</button>
      </div>

      {dmpis.length === 0 ? (
        <div style={{
          padding: '40px 20px', textAlign: 'center',
          background: 'rgba(74, 143, 212, 0.04)',
          border: '1px solid #4a4a4a', borderRadius: 6,
          color: '#aaaaaa', fontSize: 13,
        }}>
          No DMPIs defined. Click "+ Add DMPI" to create target designation points for your kneeboard.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #3a3a3a' }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>NAME</th>
              <th style={{ ...thStyle, width: 100 }}>LAT</th>
              <th style={{ ...thStyle, width: 100 }}>LON</th>
              <th style={{ ...thStyle, width: 70 }}>ELEV (ft)</th>
              <th style={{ ...thStyle, width: 130 }}>MGRS</th>
              <th style={thStyle}>DESCRIPTION</th>
              <th style={{ ...thStyle, width: 110 }}>WPN DELIVERY</th>
              <th style={{ ...thStyle, width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {dmpis.map((d, i) => (
              <tr key={d.id} style={{ borderBottom: '1px solid #262626' }}>
                <td style={{ ...tdStyle, textAlign: 'center', color: '#d29922', fontWeight: 700 }}>
                  {i + 1}
                </td>
                <td style={tdStyle}>
                  <input value={d.name} onChange={(e) => updateDmpi(d.id, { name: e.target.value })}
                    style={{ ...inputStyle, width: '95%', fontWeight: 600, color: '#e0e0e0' }} />
                </td>
                <td style={tdStyle}>
                  <input type="number" step="0.0001" value={d.lat || ''}
                    onChange={(e) => updateDmpi(d.id, { lat: parseFloat(e.target.value) || 0 })}
                    style={{ ...inputStyle, width: '95%', fontFamily: "'B612 Mono', monospace" }} placeholder="N 00.0000" />
                </td>
                <td style={tdStyle}>
                  <input type="number" step="0.0001" value={d.lon || ''}
                    onChange={(e) => updateDmpi(d.id, { lon: parseFloat(e.target.value) || 0 })}
                    style={{ ...inputStyle, width: '95%', fontFamily: "'B612 Mono', monospace" }} placeholder="E 00.0000" />
                </td>
                <td style={tdStyle}>
                  <input type="number" value={d.elevation || ''}
                    onChange={(e) => updateDmpi(d.id, { elevation: parseInt(e.target.value, 10) || 0 })}
                    style={{ ...inputStyle, width: '95%', fontFamily: "'B612 Mono', monospace" }} />
                </td>
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", fontSize: 11, color: '#cccccc' }}>
                  {d.lat && d.lon ? fmtMgrs(d.lat, d.lon) : '—'}
                </td>
                <td style={tdStyle}>
                  <input value={d.description} onChange={(e) => updateDmpi(d.id, { description: e.target.value })}
                    style={{ ...inputStyle, width: '95%' }} placeholder="Target description" />
                </td>
                <td style={tdStyle}>
                  <select value={d.weaponDelivery} onChange={(e) => updateDmpi(d.id, { weaponDelivery: e.target.value })}
                    style={{ ...inputStyle, width: '95%' }}>
                    <option value="">—</option>
                    <option value="CCRP">CCRP</option>
                    <option value="CCIP">CCIP</option>
                    <option value="Dive Toss">Dive Toss</option>
                    <option value="Loft">Loft</option>
                    <option value="Level">Level</option>
                    <option value="LGB/Laser">LGB/Laser</option>
                    <option value="GPS/JDAM">GPS/JDAM</option>
                    <option value="Maverick">Maverick</option>
                    <option value="Strafe">Strafe</option>
                    <option value="Rockets">Rockets</option>
                  </select>
                </td>
                <td style={tdStyle}>
                  <button onClick={() => removeDmpi(d.id)} style={xBtn}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '6px 8px',
  color: '#aaaaaa', fontSize: 11, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 0.5,
};
const tdStyle: React.CSSProperties = {
  padding: '4px 6px', verticalAlign: 'top',
};
const inputStyle: React.CSSProperties = {
  background: '#262626', border: '1px solid #3a3a3a', borderRadius: 3,
  color: '#cccccc', fontSize: 12, padding: '3px 6px', fontFamily: 'inherit',
};
const addBtn: React.CSSProperties = {
  background: '#4a4a4a', border: '1px solid #4a8fd4', borderRadius: 4,
  color: '#4a8fd4', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  padding: '6px 14px', fontFamily: 'inherit',
};
const xBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#aaaaaa',
  cursor: 'pointer', fontSize: 16, padding: '0 4px',
};
