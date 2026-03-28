import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';

interface LiveryUnit {
  unitId: number;
  name: string;
  groupName: string;
  livery_id: string;
}

interface LiveryEntry {
  type: string;
  coalition: string;
  category: string;
  units: LiveryUnit[];
  liveries: string[];
}

export function LiveryTab() {
  const liveryData = useMissionStore((s) => s.liveryData) as LiveryEntry[];
  const addEdit = useEditStore((s) => s.addEdit);
  const [filter, setFilter] = useState('');

  // Track changed liveries: unitId -> new livery_id
  const [changes, setChanges] = useState<Map<number, string>>(new Map());

  const originals = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    const map = new Map<number, string>();
    for (const entry of liveryData) {
      for (const u of entry.units) {
        map.set(u.unitId, u.livery_id);
      }
    }
    originals.current = map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return liveryData;
    const q = filter.toLowerCase();
    return liveryData.filter((e) => e.type.toLowerCase().includes(q));
  }, [liveryData, filter]);

  const handleLiveryChange = useCallback((unitId: number, value: string) => {
    setChanges((prev) => {
      const next = new Map(prev);
      next.set(unitId, value);
      return next;
    });
    addEdit({ unitId, field: 'livery', value } as any);
  }, [addEdit]);

  const handleBulkApply = useCallback((entry: LiveryEntry, liveryId: string) => {
    for (const u of entry.units) {
      handleLiveryChange(u.unitId, liveryId);
    }
  }, [handleLiveryChange]);

  const isChanged = (unitId: number): boolean => {
    const current = changes.get(unitId);
    if (current === undefined) return false;
    return current !== originals.current.get(unitId);
  };

  if (liveryData.length === 0) {
    return (
      <div style={{ color: '#5a7a8a', fontSize: 14, padding: 20 }}>
        No livery data available for this mission.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#ccdae8' }}>
          Livery Editor
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#5a7a8a' }}>
          Change unit liveries per aircraft type. Use bulk apply to set all units of a type at once.
        </p>
      </div>

      {/* Filter */}
      <div style={{ marginBottom: 16 }}>
        <input
          placeholder="Filter by aircraft type..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={filterInputStyle}
        />
      </div>

      {filtered.map((entry) => (
        <LiverySection
          key={entry.type}
          entry={entry}
          changes={changes}
          isChanged={isChanged}
          onLiveryChange={handleLiveryChange}
          onBulkApply={handleBulkApply}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface LiverySectionProps {
  entry: LiveryEntry;
  changes: Map<number, string>;
  isChanged: (unitId: number) => boolean;
  onLiveryChange: (unitId: number, value: string) => void;
  onBulkApply: (entry: LiveryEntry, liveryId: string) => void;
}

function LiverySection({ entry, changes, isChanged, onLiveryChange, onBulkApply }: LiverySectionProps) {
  const [bulkLivery, setBulkLivery] = useState(entry.liveries[0] || '');
  const coalitionColor = entry.coalition === 'blue' ? '#4a8fd4' : entry.coalition === 'red' ? '#d95050' : '#8a8a5a';

  return (
    <div style={{ marginBottom: 20, border: '1px solid #1a2a3a', borderRadius: 4, background: '#0a1520' }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #1a2a3a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: coalitionColor, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
            {entry.coalition}
          </span>
          <span style={{ color: '#ccdae8', fontWeight: 600, fontSize: 14 }}>{entry.type}</span>
          <span style={{ color: '#5a7a8a', fontSize: 12 }}>
            ({entry.units.length} unit{entry.units.length !== 1 ? 's' : ''})
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={bulkLivery}
            onChange={(e) => setBulkLivery(e.target.value)}
            style={selectStyle}
          >
            {entry.liveries.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <button
            onClick={() => onBulkApply(entry, bulkLivery)}
            style={applyBtnStyle}
          >
            Apply All
          </button>
        </div>
      </div>

      {/* Units table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#ccdae8' }}>
        <thead>
          <tr style={{ color: '#5a7a8a', borderBottom: '1px solid #1a2a3a', background: '#080f1c' }}>
            <th style={thStyle}>Unit Name</th>
            <th style={thStyle}>Group</th>
            <th style={thStyle}>Current Livery</th>
            <th style={thStyle}>New Livery</th>
          </tr>
        </thead>
        <tbody>
          {entry.units.map((unit) => {
            const currentValue = changes.get(unit.unitId) ?? unit.livery_id;
            const changed = isChanged(unit.unitId);
            return (
              <tr key={unit.unitId} style={{ borderBottom: '1px solid #0f1a28' }}>
                <td style={tdStyle}>
                  <span style={{ color: '#8fa8c0' }}>{unit.name}</span>
                </td>
                <td style={{ ...tdStyle, color: '#5a7a8a', fontSize: 12 }}>
                  {unit.groupName}
                </td>
                <td style={{ ...tdStyle, color: '#5a7a8a', fontSize: 12 }}>
                  {unit.livery_id}
                </td>
                <td style={tdStyle}>
                  <select
                    value={currentValue}
                    onChange={(e) => onLiveryChange(unit.unitId, e.target.value)}
                    style={{
                      ...selectStyle,
                      ...(changed ? { borderLeft: '3px solid #3fb950' } : {}),
                    }}
                  >
                    {entry.liveries.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

const filterInputStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  color: '#ccdae8',
  fontSize: 13,
  padding: '8px 12px',
  width: 300,
  outline: 'none',
  fontFamily: 'inherit',
};

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 12,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  verticalAlign: 'middle',
};

const selectStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontSize: 12,
  padding: '4px 6px',
  outline: 'none',
  fontFamily: 'inherit',
  maxWidth: 260,
};

const applyBtnStyle: React.CSSProperties = {
  background: '#1a2a3a',
  border: '1px solid #2a3a4a',
  borderRadius: 3,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 12,
  padding: '4px 10px',
  fontFamily: 'inherit',
};
