/**
 * DMPI Tab — Designated Mean Points of Impact.
 *
 * Target designation points with coordinates, elevation, description,
 * and weapon delivery method. Session-only (not written to .miz).
 *
 * Coordinates can be entered manually OR picked on the map: hit the
 * 📍 button per row, the editor switches to the map tab and arms
 * pick-mode, you click anywhere → coords land in the row + the map
 * returns you here automatically.
 */

import { forward as toMGRS } from 'mgrs';
import { useDmpiStore, type Dmpi } from '../../store/dmpiStore';
import { TextInput } from '../../components/TextInput';
import { Select } from '../../components/Select';

interface Props {
  /** Map-tab navigator. Set when the user starts picking on map so we
   *  can flip the editor to the map tab automatically. */
  onPickOnMap?: () => void;
}

function fmtMgrs(lat: number, lon: number): string {
  try {
    return toMGRS([lon, lat], 4);
  } catch {
    return '—';
  }
}

export function DmpiTab({ onPickOnMap }: Props = {}) {
  const dmpis = useDmpiStore((s) => s.dmpis);
  const pickingForId = useDmpiStore((s) => s.pickingForId);
  const add = useDmpiStore((s) => s.add);
  const update = useDmpiStore((s) => s.update);
  const remove = useDmpiStore((s) => s.remove);
  const startPicking = useDmpiStore((s) => s.startPicking);
  const cancelPicking = useDmpiStore((s) => s.cancelPicking);

  const handlePickOnMap = (id: string) => {
    startPicking(id);
    onPickOnMap?.();
  };

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#1a1f25' }}>
            DMPI — Designated Mean Points of Impact
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#3a4248' }}>
            Define target designation points for strike missions. Use the 📍
            button to pick coordinates on the map. Data is session-only (not
            saved to .miz).
          </p>
        </div>
        <button onClick={add} style={addBtn}>+ Add DMPI</button>
      </div>

      {/* Picking-mode banner — only shows when a row is armed for map pick.
          Lets the user cancel from the DMPI tab too in case they want to
          back out without going to the map. */}
      {pickingForId && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '8px 12px', marginBottom: 12,
            background: '#6e7c83',
            border: '1px solid #2a5a8a',
            borderLeft: '3px solid #d49a30',
            borderRadius: 4,
          }}
        >
          <span style={{ color: '#d49a30', fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>
            PICKING ON MAP
          </span>
          <span style={{ color: '#1a1f25', fontSize: 13, flex: 1 }}>
            Click anywhere on the map to set coordinates for{' '}
            <strong style={{ color: '#1a1f25' }}>
              {dmpis.find((d) => d.id === pickingForId)?.name ?? '—'}
            </strong>.
          </span>
          <button
            onClick={cancelPicking}
            style={{
              background: '#6e7c83', border: '1px solid #4a5258', borderRadius: 3,
              color: '#3a4248', cursor: 'pointer', fontSize: 12, padding: '4px 10px',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {dmpis.length === 0 ? (
        <div style={{
          padding: '40px 20px', textAlign: 'center',
          background: 'rgba(74, 143, 212, 0.04)',
          border: '1px solid #4a5258', borderRadius: 6,
          color: '#3a4248', fontSize: 13,
        }}>
          No DMPIs defined. Click "+ Add DMPI" to create target designation points for your kneeboard.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #4a5258' }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>NAME</th>
              <th style={{ ...thStyle, width: 100 }}>LAT</th>
              <th style={{ ...thStyle, width: 100 }}>LON</th>
              <th style={{ ...thStyle, width: 70 }}>ELEV (ft)</th>
              <th style={{ ...thStyle, width: 130 }}>MGRS</th>
              <th style={thStyle}>DESCRIPTION</th>
              <th style={{ ...thStyle, width: 110 }}>WPN DELIVERY</th>
              <th style={{ ...thStyle, width: 40 }}></th>
              <th style={{ ...thStyle, width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {dmpis.map((d: Dmpi, i: number) => (
              <tr key={d.id} style={{
                borderBottom: '1px solid #6e7c83',
                background: pickingForId === d.id ? 'rgba(74, 143, 212, 0.08)' : 'transparent',
              }}>
                <td style={{ ...tdStyle, textAlign: 'center', color: '#d29922', fontWeight: 700 }}>
                  {i + 1}
                </td>
                <td style={tdStyle}>
                  <TextInput size="sm" value={d.name}
                    onChange={(e) => update(d.id, { name: e.target.value })}
                    style={{ width: '95%', fontWeight: 600, color: '#1a1f25' }} />
                </td>
                <td style={tdStyle}>
                  <TextInput size="sm" type="number" step="0.0001" value={d.lat || ''}
                    onChange={(e) => update(d.id, { lat: parseFloat(e.target.value) || 0 })}
                    style={{ width: '95%', fontFamily: "'B612 Mono', monospace" }} placeholder="N 00.0000" />
                </td>
                <td style={tdStyle}>
                  <TextInput size="sm" type="number" step="0.0001" value={d.lon || ''}
                    onChange={(e) => update(d.id, { lon: parseFloat(e.target.value) || 0 })}
                    style={{ width: '95%', fontFamily: "'B612 Mono', monospace" }} placeholder="E 00.0000" />
                </td>
                <td style={tdStyle}>
                  <TextInput size="sm" type="number" value={d.elevation || ''}
                    onChange={(e) => update(d.id, { elevation: parseInt(e.target.value, 10) || 0 })}
                    style={{ width: '95%', fontFamily: "'B612 Mono', monospace" }} />
                </td>
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", fontSize: 11, color: '#1a1f25' }}>
                  {d.lat && d.lon ? fmtMgrs(d.lat, d.lon) : '—'}
                </td>
                <td style={tdStyle}>
                  <TextInput size="sm" value={d.description}
                    onChange={(e) => update(d.id, { description: e.target.value })}
                    style={{ width: '95%' }} placeholder="Target description" />
                </td>
                <td style={tdStyle}>
                  <Select size="sm" value={d.weaponDelivery}
                    onChange={(e) => update(d.id, { weaponDelivery: e.target.value })}
                    style={{ width: '95%' }}>
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
                  </Select>
                </td>
                <td style={tdStyle}>
                  <button
                    onClick={() => handlePickOnMap(d.id)}
                    title="Pick coordinates on the map"
                    style={{
                      ...pickBtn,
                      ...(pickingForId === d.id
                        ? { background: '#1a3050', borderColor: '#d49a30', color: '#d49a30' }
                        : {}),
                    }}
                  >
                    📍
                  </button>
                </td>
                <td style={tdStyle}>
                  <button onClick={() => remove(d.id)} style={xBtn}>×</button>
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
  color: '#3a4248', fontSize: 11, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 0.5,
};
const tdStyle: React.CSSProperties = {
  padding: '4px 6px', verticalAlign: 'top',
};
const addBtn: React.CSSProperties = {
  background: '#4a5258', border: '1px solid #d49a30', borderRadius: 4,
  color: '#d49a30', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  padding: '6px 14px', fontFamily: 'inherit',
};
const xBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#3a4248',
  cursor: 'pointer', fontSize: 16, padding: '0 4px',
};
const pickBtn: React.CSSProperties = {
  background: '#6e7c83', border: '1px solid #4a5258', borderRadius: 3,
  color: '#3a4248', cursor: 'pointer', fontSize: 14, padding: '2px 6px',
  fontFamily: 'inherit',
};
