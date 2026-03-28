import { useState, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import type { MissionUnit } from '../../types/mission';

const SKILL_LEVELS = ['Client', 'Excellent', 'High', 'Good', 'Average', 'Low'];

export function BatchEditTab() {
  const countries = useMissionStore((s) => s.countries);
  const units = useMissionStore((s) => s.units);
  const addEdit = useEditStore((s) => s.addEdit);

  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<number>>(new Set());

  // Bulk edit values
  const [skillValue, setSkillValue] = useState<string>('');
  const [freqMhz, setFreqMhz] = useState<string>('');
  const [liveryValue, setLiveryValue] = useState<string>('');

  // Applied tracking for green border
  const [appliedUnitIds, setAppliedUnitIds] = useState<Set<number>>(new Set());

  // Get unit types for selected country
  const countryInfo = useMemo(
    () => countries.find((c) => c.name === selectedCountry),
    [countries, selectedCountry],
  );

  // Filter units by country and optionally type
  const matchingUnits = useMemo(() => {
    if (!selectedCountry) return [];
    return units.filter((u) => {
      if (u.country !== selectedCountry) return false;
      if (selectedType && u.type !== selectedType) return false;
      return true;
    });
  }, [units, selectedCountry, selectedType]);

  const handleCountryChange = useCallback((country: string) => {
    setSelectedCountry(country);
    setSelectedType('');
    setSelectedUnitIds(new Set());
    setAppliedUnitIds(new Set());
  }, []);

  const handleTypeChange = useCallback((type: string) => {
    setSelectedType(type);
    setSelectedUnitIds(new Set());
    setAppliedUnitIds(new Set());
  }, []);

  const toggleUnit = useCallback((unitId: number) => {
    setSelectedUnitIds((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedUnitIds(new Set(matchingUnits.map((u) => u.unitId)));
  }, [matchingUnits]);

  const deselectAll = useCallback(() => {
    setSelectedUnitIds(new Set());
  }, []);

  const applySkill = useCallback(() => {
    if (!skillValue) return;
    for (const unitId of selectedUnitIds) {
      addEdit({ unitId, field: 'skill', value: skillValue });
    }
    // Optimistic update
    const { units: storeUnits } = useMissionStore.getState();
    const updated = storeUnits.map((u) =>
      selectedUnitIds.has(u.unitId) ? { ...u, skill: skillValue } : u,
    );
    useMissionStore.setState({ units: updated });
    setAppliedUnitIds((prev) => new Set([...prev, ...selectedUnitIds]));
  }, [skillValue, selectedUnitIds, addEdit]);

  const applyRadio = useCallback(() => {
    const mhz = parseFloat(freqMhz);
    if (isNaN(mhz)) return;
    const freqHz = mhz * 1e6;
    for (const unitId of selectedUnitIds) {
      addEdit({ unitId, field: 'radioFrequency', value: freqHz });
    }
    setAppliedUnitIds((prev) => new Set([...prev, ...selectedUnitIds]));
  }, [freqMhz, selectedUnitIds, addEdit]);

  const applyLivery = useCallback(() => {
    if (!liveryValue) return;
    for (const unitId of selectedUnitIds) {
      addEdit({ unitId, field: 'livery', value: liveryValue });
    }
    setAppliedUnitIds((prev) => new Set([...prev, ...selectedUnitIds]));
  }, [liveryValue, selectedUnitIds, addEdit]);

  if (countries.length === 0) {
    return (
      <div style={{ color: '#5a7a8a', fontSize: 14, padding: 20 }}>
        No country data available in this mission.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#ccdae8' }}>
          Batch Edit
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#5a7a8a' }}>
          Bulk edit skill, radio frequency, and livery for multiple units at once.
        </p>
      </div>

      {/* Step 1: Select scope */}
      <div style={sectionStyle}>
        <h3 style={sectionHeadingStyle}>1. Select Scope</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={labelStyle}>
            Country
            <select
              value={selectedCountry}
              onChange={(e) => handleCountryChange(e.target.value)}
              style={selectStyle}
            >
              <option value="">-- Select country --</option>
              {countries.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.coalition}, {c.unitCount} units)
                </option>
              ))}
            </select>
          </label>

          {countryInfo && countryInfo.unitTypes.length > 0 && (
            <label style={labelStyle}>
              Unit Type
              <select
                value={selectedType}
                onChange={(e) => handleTypeChange(e.target.value)}
                style={selectStyle}
              >
                <option value="">All types</option>
                {countryInfo.unitTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {/* Step 2: Select targets */}
      {selectedCountry && (
        <div style={sectionStyle}>
          <h3 style={sectionHeadingStyle}>2. Select Units</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button onClick={selectAll} style={btnStyle}>Select All</button>
            <button onClick={deselectAll} style={btnStyle}>Deselect All</button>
            <span style={{ color: '#5a7a8a', fontSize: 12, marginLeft: 8 }}>
              {selectedUnitIds.size} of {matchingUnits.length} selected
            </span>
          </div>

          {matchingUnits.length === 0 ? (
            <div style={{ color: '#5a7a8a', fontSize: 12, padding: '8px 0' }}>
              No units match the current filter.
            </div>
          ) : (
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#ccdae8' }}>
                <thead>
                  <tr style={{
                    color: '#5a7a8a',
                    borderBottom: '1px solid #1a2a3a',
                    background: '#080f1c',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}>
                    <th style={thStyle}></th>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Group</th>
                    <th style={thStyle}>Skill</th>
                  </tr>
                </thead>
                <tbody>
                  {matchingUnits.map((unit) => (
                    <UnitRow
                      key={unit.unitId}
                      unit={unit}
                      selected={selectedUnitIds.has(unit.unitId)}
                      applied={appliedUnitIds.has(unit.unitId)}
                      onToggle={toggleUnit}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Apply changes */}
      {selectedUnitIds.size > 0 && (
        <div style={sectionStyle}>
          <h3 style={sectionHeadingStyle}>3. Apply Changes</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Skill */}
            <div style={actionRowStyle}>
              <label style={labelStyle}>
                Skill
                <select
                  value={skillValue}
                  onChange={(e) => setSkillValue(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">-- Select --</option>
                  {SKILL_LEVELS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={applySkill}
                disabled={!skillValue}
                style={applyBtnStyle}
              >
                Apply to Selected
              </button>
            </div>

            {/* Radio frequency */}
            <div style={actionRowStyle}>
              <label style={labelStyle}>
                Radio Frequency (MHz)
                <input
                  type="number"
                  step="0.001"
                  value={freqMhz}
                  onChange={(e) => setFreqMhz(e.target.value)}
                  placeholder="e.g. 251.000"
                  style={inputStyle}
                />
              </label>
              <button
                onClick={applyRadio}
                disabled={!freqMhz || isNaN(parseFloat(freqMhz))}
                style={applyBtnStyle}
              >
                Apply to Selected
              </button>
            </div>

            {/* Livery */}
            <div style={actionRowStyle}>
              <label style={labelStyle}>
                Livery
                <input
                  type="text"
                  value={liveryValue}
                  onChange={(e) => setLiveryValue(e.target.value)}
                  placeholder="Livery ID"
                  style={inputStyle}
                />
              </label>
              <button
                onClick={applyLivery}
                disabled={!liveryValue}
                style={applyBtnStyle}
              >
                Apply to Selected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface UnitRowProps {
  unit: MissionUnit;
  selected: boolean;
  applied: boolean;
  onToggle: (unitId: number) => void;
}

function UnitRow({ unit, selected, applied, onToggle }: UnitRowProps) {
  return (
    <tr
      style={{
        borderBottom: '1px solid #0f1a28',
        borderLeft: applied ? '3px solid #3fb950' : '3px solid transparent',
      }}
    >
      <td style={tdStyle}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(unit.unitId)}
          style={{ cursor: 'pointer' }}
        />
      </td>
      <td style={tdStyle}>
        <span style={{ color: '#8fa8c0' }}>{unit.name}</span>
      </td>
      <td style={{ ...tdStyle, color: '#5a7a8a', fontSize: 12 }}>{unit.type}</td>
      <td style={{ ...tdStyle, color: '#5a7a8a', fontSize: 12 }}>{unit.groupName}</td>
      <td style={{ ...tdStyle, color: '#5a7a8a', fontSize: 12 }}>{unit.skill}</td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

const sectionStyle: React.CSSProperties = {
  marginBottom: 20,
  padding: 16,
  background: '#0a1520',
  border: '1px solid #1a2a3a',
  borderRadius: 6,
};

const sectionHeadingStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 14,
  fontWeight: 600,
  color: '#8fa8c0',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: '#5a7a8a',
};

const selectStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontSize: 13,
  padding: '5px 8px',
  fontFamily: 'inherit',
  minWidth: 180,
};

const inputStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontSize: 13,
  padding: '5px 8px',
  fontFamily: 'inherit',
  minWidth: 180,
};

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 12,
  padding: '4px 10px',
  fontFamily: 'inherit',
};

const applyBtnStyle: React.CSSProperties = {
  background: '#1a3a5a',
  border: '1px solid #2a5a8a',
  borderRadius: 3,
  color: '#ccdae8',
  cursor: 'pointer',
  fontSize: 12,
  padding: '6px 14px',
  fontFamily: 'inherit',
  alignSelf: 'flex-end',
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'flex-end',
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
