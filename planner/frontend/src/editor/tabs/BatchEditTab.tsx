import { useState, useMemo, useCallback, useEffect } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';

const SKILL_OPTIONS = ['', 'Average', 'Good', 'High', 'Excellent', 'Random'];
const CAT_ICONS: Record<string, string> = { plane: '✈', helicopter: '🚁', vehicle: '🚗', ship: '⚓', static: '●' };

export function BatchEditTab() {
  const countries = useMissionStore((s) => s.countries);
  const units = useMissionStore((s) => s.units);
  const addEdit = useEditStore((s) => s.addEdit);

  const [country, setCountry] = useState('');
  const [checkedTypes, setCheckedTypes] = useState<Set<string>>(new Set());
  const [skill, setSkill] = useState('');
  const [radioMhz, setRadioMhz] = useState('');
  const [livery, setLivery] = useState('');
  const [result, setResult] = useState('');
  const [availableLiveries, setAvailableLiveries] = useState<{ id: string; name: string }[]>([]);

  // Build type list for selected country with counts and categories
  const typeMeta = useMemo(() => {
    if (!country) return [];
    const meta = new Map<string, { count: number; category: string }>();
    for (const u of units) {
      if (u.country !== country) continue;
      const existing = meta.get(u.type);
      if (existing) existing.count++;
      else meta.set(u.type, { count: 1, category: u.category });
    }
    return Array.from(meta.entries())
      .map(([type, m]) => ({ type, count: m.count, category: m.category }))
      .sort((a, b) => b.count - a.count);
  }, [units, country]);

  // Affected unit count
  const affected = useMemo(() => {
    if (!country) return 0;
    return units.filter((u) =>
      u.country === country && (checkedTypes.size === 0 || checkedTypes.has(u.type))
    ).length;
  }, [units, country, checkedTypes]);

  // Fetch liveries for checked types
  useEffect(() => {
    if (checkedTypes.size === 0) { setAvailableLiveries([]); return; }
    const firstType = Array.from(checkedTypes)[0];
    fetch(`/api/liveries/${encodeURIComponent(firstType)}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAvailableLiveries(data);
        else setAvailableLiveries([]);
      })
      .catch(() => setAvailableLiveries([]));
  }, [checkedTypes]);

  const toggleType = (type: string) => {
    setCheckedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const selectCategory = (cat: string) => {
    setCheckedTypes(new Set(typeMeta.filter((t) => t.category === cat).map((t) => t.type)));
  };

  const selectAllTypes = (on: boolean) => {
    setCheckedTypes(on ? new Set(typeMeta.map((t) => t.type)) : new Set());
  };

  const handleApply = useCallback(() => {
    if (!country) return;
    if (!skill && !radioMhz && !livery) { setResult('No changes entered'); return; }

    const targets = units.filter((u) =>
      u.country === country && (checkedTypes.size === 0 || checkedTypes.has(u.type))
    );

    for (const u of targets) {
      if (skill) addEdit({ unitId: u.unitId, field: 'skill', value: skill } as any);
      if (livery) addEdit({ unitId: u.unitId, field: 'livery', value: livery } as any);
      if (radioMhz && (u.category === 'plane' || u.category === 'helicopter')) {
        addEdit({ unitId: u.unitId, field: 'radioFrequency', value: Math.round(parseFloat(radioMhz) * 1e6) } as any);
      }
    }

    setResult(`Applied to ${targets.length} unit${targets.length !== 1 ? 's' : ''}`);
  }, [country, checkedTypes, skill, radioMhz, livery, units, addEdit]);

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: '#ccdae8' }}>Batch Edit</h2>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: '#5a7a8a' }}>
        Apply changes to multiple units at once by country and type.
      </p>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* Left column — selection */}
        <div style={{ flex: '1 1 300px', minWidth: 280 }}>
          {/* Step 1: Country */}
          <StepHeader num={1} title="Select Country" />
          <select
            value={country}
            onChange={(e) => { setCountry(e.target.value); setCheckedTypes(new Set()); setResult(''); }}
            style={selectStyle}
          >
            <option value="">— choose country —</option>
            {countries.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.unitCount} units) — {c.coalition}
              </option>
            ))}
          </select>

          {/* Step 2: Unit Types */}
          <StepHeader num={2} title="Unit Types" subtitle="empty = all" />
          {!country ? (
            <div style={{ color: '#5a7a8a', fontSize: 12, padding: '8px 0' }}>Select a country first</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <SmallBtn label="All" onClick={() => selectAllTypes(true)} />
                <SmallBtn label="None" onClick={() => selectAllTypes(false)} />
                <SmallBtn label="✈ Planes" onClick={() => selectCategory('plane')} accent />
                <SmallBtn label="🚁 Helis" onClick={() => selectCategory('helicopter')} accent />
                <SmallBtn label="🚗 Vehicles" onClick={() => selectCategory('vehicle')} accent />
                <SmallBtn label="⚓ Ships" onClick={() => selectCategory('ship')} accent />
              </div>
              <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #1a2a3a', borderRadius: 4, background: '#0a1520' }}>
                {typeMeta.map((t) => (
                  <label
                    key={t.type}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                      borderBottom: '1px solid #0f1a28', cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checkedTypes.has(t.type)}
                      onChange={() => toggleType(t.type)}
                      style={{ accentColor: '#4a8fd4' }}
                    />
                    <span style={{ color: '#5a7a8a' }}>{CAT_ICONS[t.category] || ''}</span>
                    <span style={{ color: '#ccdae8', flex: 1 }}>{t.type}</span>
                    <span style={{ color: '#5a7a8a', fontFamily: 'monospace', fontSize: 11 }}>{t.count}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right column — changes */}
        <div style={{ flex: '1 1 300px', minWidth: 280 }}>
          <StepHeader num={3} title="Changes to Apply" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            {/* Livery */}
            <div>
              <label style={labelStyle}>Paint Scheme</label>
              {availableLiveries.length > 0 ? (
                <select value={livery} onChange={(e) => setLivery(e.target.value)} style={selectStyle}>
                  <option value="">— no change —</option>
                  {availableLiveries.map((l) => (
                    <option key={l.id} value={l.id}>{l.name || l.id}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={livery}
                  onChange={(e) => setLivery(e.target.value)}
                  placeholder="livery_id"
                  style={inputStyle}
                />
              )}
            </div>

            {/* Skill */}
            <div>
              <label style={labelStyle}>Skill Level</label>
              <select value={skill} onChange={(e) => setSkill(e.target.value)} style={selectStyle}>
                <option value="">— no change —</option>
                {SKILL_OPTIONS.filter(Boolean).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Radio */}
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Radio Freq MHz (aircraft only)</label>
              <input
                type="number"
                value={radioMhz}
                onChange={(e) => setRadioMhz(e.target.value)}
                placeholder="305.000"
                step={0.025}
                min={100}
                max={400}
                style={{ ...inputStyle, width: 160 }}
              />
            </div>
          </div>

          {/* Preview + Apply */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #1a2a3a' }}>
            <span style={{ color: '#8fa8c0', fontSize: 13 }}>
              <strong style={{ color: '#ccdae8' }}>{affected}</strong> unit{affected !== 1 ? 's' : ''} will be affected
            </span>
            <button
              onClick={handleApply}
              disabled={!country || affected === 0}
              style={{
                background: country && affected > 0 ? '#d29922' : '#1a2a3a',
                border: 'none', borderRadius: 4, color: '#080f1c',
                cursor: country && affected > 0 ? 'pointer' : 'not-allowed',
                fontSize: 13, fontWeight: 600, padding: '8px 16px',
              }}
            >
              ⚡ Apply
            </button>
          </div>
          {result && (
            <div style={{ padding: '8px 12px', background: 'rgba(63, 185, 80, 0.1)', border: '1px solid #3fb950', borderRadius: 4, color: '#3fb950', fontSize: 12, marginTop: 8 }}>
              ✓ {result}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepHeader({ num, title, subtitle }: { num: number; title: string; subtitle?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, marginTop: num > 1 ? 16 : 0 }}>
      <span style={{
        width: 24, height: 24, borderRadius: '50%', background: '#1a3a5a',
        color: '#4a8fd4', fontWeight: 700, fontSize: 13,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{num}</span>
      <span style={{ color: '#ccdae8', fontWeight: 600, fontSize: 13 }}>{title}</span>
      {subtitle && <span style={{ color: '#5a7a8a', fontSize: 11 }}>({subtitle})</span>}
    </div>
  );
}

function SmallBtn({ label, onClick, accent }: { label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button onClick={onClick} style={{
      background: 'transparent',
      border: `1px solid ${accent ? '#1a3a5a' : '#1a2a3a'}`,
      borderRadius: 3, color: accent ? '#4a8fd4' : '#5a7a8a',
      cursor: 'pointer', fontSize: 11, padding: '3px 8px',
    }}>{label}</button>
  );
}

const selectStyle: React.CSSProperties = {
  background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
  color: '#ccdae8', fontSize: 12, padding: '6px 10px', width: '100%',
};
const inputStyle: React.CSSProperties = {
  background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
  color: '#ccdae8', fontSize: 12, padding: '6px 10px', fontFamily: 'monospace',
};
const labelStyle: React.CSSProperties = {
  display: 'block', color: '#5a7a8a', fontSize: 11, marginBottom: 4, fontWeight: 500,
};
