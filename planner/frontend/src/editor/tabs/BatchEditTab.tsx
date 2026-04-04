import { useState, useMemo, useCallback, useEffect } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';

const SKILL_OPTIONS = ['', 'Average', 'Good', 'High', 'Excellent', 'Random'];

/** DCS callsign names mapped to their Lua index */
const CALLSIGN_NAMES: { idx: number; name: string }[] = [
  { idx: 1, name: 'Enfield' },
  { idx: 2, name: 'Springfield' },
  { idx: 3, name: 'Uzi' },
  { idx: 4, name: 'Colt' },
  { idx: 5, name: 'Dodge' },
  { idx: 6, name: 'Ford' },
  { idx: 7, name: 'Chevy' },
  { idx: 8, name: 'Pontiac' },
  { idx: 9, name: 'Hawg' },
  { idx: 10, name: 'Boar' },
  { idx: 11, name: 'Pig' },
  { idx: 12, name: 'Tusk' },
];

/** Make a raw livery_id human-readable */
function formatLiveryId(raw: string): string {
  if (!raw) return '(default)';
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
const CAT_ICONS: Record<string, string> = { plane: '✈', helicopter: '🚁', vehicle: '🚗', ship: '⚓', static: '●' };

export function BatchEditTab() {
  const countries = useMissionStore((s) => s.countries);
  const units = useMissionStore((s) => s.units);
  const liveryData = useMissionStore((s) => s.liveryData) as { type: string; units: { livery_id: string }[]; liveries: string[] }[];
  const addEdit = useEditStore((s) => s.addEdit);

  const [country, setCountry] = useState('');
  const [checkedTypes, setCheckedTypes] = useState<Set<string>>(new Set());
  const [skill, setSkill] = useState('');
  const [radioMhz, setRadioMhz] = useState('');
  const [livery, setLivery] = useState('');
  const [tailMin, setTailMin] = useState('');
  const [tailMax, setTailMax] = useState('');
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

  // Build livery dropdown from mission data + API fetch
  useEffect(() => {
    if (checkedTypes.size === 0) { setAvailableLiveries([]); return; }

    // 1. Gather liveries already known from mission data for checked types
    const missionLiveries = new Map<string, string>(); // id → display name
    for (const entry of liveryData) {
      if (!checkedTypes.has(entry.type)) continue;
      // From the liveries array on the entry
      for (const lid of (entry.liveries || [])) {
        if (lid && !missionLiveries.has(lid)) {
          missionLiveries.set(lid, formatLiveryId(lid));
        }
      }
      // From livery_id on each unit (what's actually in use)
      for (const u of (entry.units || [])) {
        if (u.livery_id && !missionLiveries.has(u.livery_id)) {
          missionLiveries.set(u.livery_id, formatLiveryId(u.livery_id));
        }
      }
    }

    // Start with mission data so dropdown is instant
    const missionList = Array.from(missionLiveries.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setAvailableLiveries(missionList);

    // 2. Try API for a richer list — merge in if it returns data
    const firstType = Array.from(checkedTypes)[0];
    fetch(`/api/liveries/${encodeURIComponent(firstType)}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          // Merge: API results take priority for display names, add mission-only entries
          const merged = new Map<string, string>();
          for (const l of data) merged.set(l.id, l.name || formatLiveryId(l.id));
          for (const [id, name] of missionLiveries) {
            if (!merged.has(id)) merged.set(id, name);
          }
          setAvailableLiveries(
            Array.from(merged.entries())
              .map(([id, name]) => ({ id, name }))
              .sort((a, b) => a.name.localeCompare(b.name))
          );
        }
      })
      .catch(() => { /* keep mission data list */ });
  }, [checkedTypes, liveryData]);

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
    if (!skill && !radioMhz && !livery && !tailMin) { setResult('No changes entered'); return; }

    const targets = units.filter((u) =>
      u.country === country && (checkedTypes.size === 0 || checkedTypes.has(u.type))
    );

    // Generate random unique tail numbers within range (octal digits only: 0-7)
    let tailNums: number[] = [];
    if (tailMin) {
      const lo = parseInt(tailMin, 10);
      const hi = tailMax ? parseInt(tailMax, 10) : lo + targets.length * 5;
      const pool: number[] = [];
      for (let n = lo; n <= hi; n++) {
        // Only include numbers with octal-valid digits (no 8 or 9)
        if (/^[0-7]+$/.test(String(n))) pool.push(n);
      }
      // Fisher-Yates shuffle and take what we need
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      tailNums = pool.slice(0, targets.length);
    }

    for (let i = 0; i < targets.length; i++) {
      const u = targets[i];
      if (skill) addEdit({ unitId: u.unitId, field: 'skill', value: skill } as any);
      if (livery) addEdit({ unitId: u.unitId, field: 'livery', value: livery } as any);
      if (radioMhz && (u.category === 'plane' || u.category === 'helicopter')) {
        addEdit({ unitId: u.unitId, field: 'radioFrequency', value: Math.round(parseFloat(radioMhz) * 1e6) } as any);
      }
      if (tailNums.length > 0) {
        addEdit({ unitId: u.unitId, field: 'onboard_num', value: String(tailNums[i]) } as any);
      }
    }

    setResult(`Applied to ${targets.length} unit${targets.length !== 1 ? 's' : ''}`);
  }, [country, checkedTypes, skill, radioMhz, livery, tailMin, tailMax, units, addEdit]);

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600, color: '#ccdae8' }}>Batch Edit</h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#5a7a8a' }}>
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
            <div style={{ color: '#5a7a8a', fontSize: 13, padding: '8px 0' }}>Select a country first</div>
          ) : (
            <>
              {/* Filter pills */}
              <div style={{
                display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap',
                padding: '6px 8px', background: '#0a1218', borderRadius: 6,
                border: '1px solid #12202e',
              }}>
                <FilterPill label="All" active={checkedTypes.size === typeMeta.length && typeMeta.length > 0} onClick={() => selectAllTypes(true)} />
                <FilterPill label="None" active={checkedTypes.size === 0} onClick={() => selectAllTypes(false)} />
                <span style={{ width: 1, background: '#1a2a3a', margin: '2px 4px' }} />
                <FilterPill label="✈ Planes" active={typeMeta.filter(t => t.category === 'plane').every(t => checkedTypes.has(t.type)) && typeMeta.some(t => t.category === 'plane')} onClick={() => selectCategory('plane')} color="#4a8fd4" />
                <FilterPill label="🚁 Helis" active={typeMeta.filter(t => t.category === 'helicopter').every(t => checkedTypes.has(t.type)) && typeMeta.some(t => t.category === 'helicopter')} onClick={() => selectCategory('helicopter')} color="#60c080" />
                <FilterPill label="🚗 Ground" active={typeMeta.filter(t => t.category === 'vehicle').every(t => checkedTypes.has(t.type)) && typeMeta.some(t => t.category === 'vehicle')} onClick={() => selectCategory('vehicle')} color="#d29922" />
                <FilterPill label="⚓ Ships" active={typeMeta.filter(t => t.category === 'ship').every(t => checkedTypes.has(t.type)) && typeMeta.some(t => t.category === 'ship')} onClick={() => selectCategory('ship')} color="#b07ed8" />
              </div>
              {/* Unit type list */}
              <div style={{
                maxHeight: 300, overflow: 'auto', borderRadius: 6,
                border: '1px solid #12202e', background: '#0a1218',
              }}>
                {typeMeta.map((t, i) => {
                  const checked = checkedTypes.has(t.type);
                  const catColor = t.category === 'plane' ? '#4a8fd4' : t.category === 'helicopter' ? '#60c080' : t.category === 'vehicle' ? '#d29922' : t.category === 'ship' ? '#b07ed8' : '#5a7a8a';
                  return (
                    <label
                      key={t.type}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                        borderBottom: i < typeMeta.length - 1 ? '1px solid #0f1a24' : 'none',
                        cursor: 'pointer', fontSize: 13,
                        background: checked ? 'rgba(74, 143, 212, 0.06)' : 'transparent',
                        transition: 'background 0.15s',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleType(t.type)}
                        style={{ accentColor: '#4a8fd4' }}
                      />
                      <span style={{
                        fontSize: 10, padding: '1px 5px', borderRadius: 3,
                        background: `${catColor}15`, color: catColor,
                        border: `1px solid ${catColor}30`, fontWeight: 600,
                        minWidth: 16, textAlign: 'center',
                      }}>{CAT_ICONS[t.category] || '?'}</span>
                      <span style={{ color: checked ? '#ccdae8' : '#8fa8c0', flex: 1, fontWeight: checked ? 500 : 400 }}>{t.type}</span>
                      <span style={{
                        color: '#5a7a8a', fontFamily: 'monospace', fontSize: 11,
                        background: '#0f1a28', padding: '1px 6px', borderRadius: 3,
                        border: '1px solid #1a2a3a',
                      }}>{t.count}</span>
                    </label>
                  );
                })}
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
              <select value={livery} onChange={(e) => setLivery(e.target.value)} style={selectStyle}>
                <option value="">— no change —</option>
                {availableLiveries.map((l) => (
                  <option key={l.id} value={l.id}>{l.name || l.id}</option>
                ))}
              </select>
              {checkedTypes.size > 0 && availableLiveries.length === 0 && (
                <div style={{ fontSize: 11, color: '#5a7a8a', marginTop: 4 }}>
                  No liveries found for selected types
                </div>
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
            <div>
              <label style={labelStyle}>Radio Freq MHz (aircraft only)</label>
              <input
                type="number"
                value={radioMhz}
                onChange={(e) => setRadioMhz(e.target.value)}
                placeholder="305.000"
                step={0.025}
                min={100}
                max={400}
                style={{ ...inputStyle, width: '100%' }}
              />
            </div>

            {/* Tail Number */}
            <div>
              <label style={labelStyle}>Tail # Range</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="number"
                  value={tailMin}
                  onChange={(e) => setTailMin(e.target.value)}
                  placeholder="100"
                  min={0}
                  max={9999}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <span style={{ color: '#5a7a8a', fontSize: 12 }}>–</span>
                <input
                  type="number"
                  value={tailMax}
                  onChange={(e) => setTailMax(e.target.value)}
                  placeholder={tailMin ? String(parseInt(tailMin, 10) + affected * 3) : '300'}
                  min={0}
                  max={9999}
                  style={{ ...inputStyle, flex: 1 }}
                />
              </div>
              {tailMin && affected > 0 && (
                <div style={{ fontSize: 11, color: '#5a7a8a', marginTop: 4 }}>
                  {affected} random octal tail numbers from {tailMin} – {tailMax || parseInt(tailMin, 10) + affected * 5}
                </div>
              )}
            </div>
          </div>

          {/* Auto-assign callsigns */}
          <div style={{ marginBottom: 12 }}>
            <button
              onClick={() => {
                if (!country || affected === 0) return;
                const targets = units.filter((u) =>
                  u.country === country && (checkedTypes.size === 0 || checkedTypes.has(u.type))
                    && (u.category === 'plane' || u.category === 'helicopter')
                );
                if (targets.length === 0) { setResult('No aircraft found'); return; }
                const groupOrder: string[] = [];
                for (const u of targets) {
                  const gn = u.groupName || `g${u.groupId}`;
                  if (!groupOrder.includes(gn)) groupOrder.push(gn);
                }
                const groupCs = new Map<string, { nameIdx: number; name: string; flight: number }>();
                for (let i = 0; i < groupOrder.length; i++) {
                  const cs = CALLSIGN_NAMES[i % CALLSIGN_NAMES.length];
                  const flight = Math.floor(i / CALLSIGN_NAMES.length) + 1;
                  groupCs.set(groupOrder[i], { nameIdx: cs.idx, name: cs.name, flight });
                }
                const posCounters = new Map<string, number>();
                for (const u of targets) {
                  const gn = u.groupName || `g${u.groupId}`;
                  const gc = groupCs.get(gn)!;
                  const pos = (posCounters.get(gn) || 0) + 1;
                  posCounters.set(gn, pos);
                  addEdit({ unitId: u.unitId, field: 'callsign', value: {
                    nameIdx: gc.nameIdx, flight: gc.flight, pos,
                    name: `${gc.name}${gc.flight}${pos}`,
                  }} as any);
                }
                setResult(`Callsigns assigned to ${targets.length} aircraft across ${groupOrder.length} groups`);
              }}
              disabled={!country || affected === 0}
              style={{
                background: country && affected > 0 ? '#1a3a5a' : '#1a2a3a',
                border: `1px solid ${country && affected > 0 ? '#4a8fd4' : '#1a2a3a'}`,
                borderRadius: 4, color: country && affected > 0 ? '#4a8fd4' : '#5a7a8a',
                cursor: country && affected > 0 ? 'pointer' : 'not-allowed',
                fontSize: 13, fontWeight: 600, padding: '6px 14px', width: '100%',
              }}
            >
              Auto-Assign Callsigns (aircraft only)
            </button>
            <div style={{ fontSize: 11, color: '#5a7a8a', marginTop: 4 }}>
              Each group gets a unique callsign: Enfield 1-1, Springfield 1-1, Uzi 1-1, ...
            </div>
          </div>

          {/* Preview + Apply */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #1a2a3a' }}>
            <span style={{ color: '#8fa8c0', fontSize: 14 }}>
              <strong style={{ color: '#ccdae8' }}>{affected}</strong> unit{affected !== 1 ? 's' : ''} will be affected
            </span>
            <button
              onClick={handleApply}
              disabled={!country || affected === 0}
              style={{
                background: country && affected > 0 ? '#d29922' : '#1a2a3a',
                border: 'none', borderRadius: 4, color: '#080f1c',
                cursor: country && affected > 0 ? 'pointer' : 'not-allowed',
                fontSize: 14, fontWeight: 600, padding: '8px 16px',
              }}
            >
              ⚡ Apply
            </button>
          </div>
          {result && (
            <div style={{ padding: '8px 12px', background: 'rgba(63, 185, 80, 0.1)', border: '1px solid #3fb950', borderRadius: 4, color: '#3fb950', fontSize: 13, marginTop: 8 }}>
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
        color: '#4a8fd4', fontWeight: 700, fontSize: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{num}</span>
      <span style={{ color: '#ccdae8', fontWeight: 600, fontSize: 14 }}>{title}</span>
      {subtitle && <span style={{ color: '#5a7a8a', fontSize: 12 }}>({subtitle})</span>}
    </div>
  );
}

function FilterPill({ label, active, onClick, color }: { label: string; active?: boolean; onClick: () => void; color?: string }) {
  const c = color || '#8fa8c0';
  return (
    <button onClick={onClick} style={{
      background: active ? `${c}20` : 'transparent',
      border: `1px solid ${active ? `${c}50` : '#1a2a3a'}`,
      borderRadius: 12, color: active ? c : '#5a7a8a',
      cursor: 'pointer', fontSize: 11, padding: '3px 10px',
      fontWeight: active ? 600 : 400,
      transition: 'all 0.15s',
    }}>{label}</button>
  );
}

const selectStyle: React.CSSProperties = {
  background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
  color: '#ccdae8', fontSize: 13, padding: '6px 10px', width: '100%',
};
const inputStyle: React.CSSProperties = {
  background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
  color: '#ccdae8', fontSize: 13, padding: '6px 10px', fontFamily: 'monospace',
};
const labelStyle: React.CSSProperties = {
  display: 'block', color: '#5a7a8a', fontSize: 12, marginBottom: 4, fontWeight: 500,
};
