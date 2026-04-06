/**
 * Coalitions tab — view and reassign countries between coalitions.
 *
 * Shows current coalition assignments with unit counts, and allows
 * reassigning countries via click or using era-based presets.
 * Changes are staged as edits and applied on .miz download.
 */

import { useState, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

interface CoalitionPreset {
  id: string;
  name: string;
  description: string;
  blue: string[];
  red: string[];
}

const PRESETS: CoalitionPreset[] = [
  {
    id: 'modern-nato-vs-russia',
    name: 'Modern NATO vs Russia',
    description: 'Current-era NATO alliance vs Russian Federation and allies',
    blue: [
      'USA', 'UK', 'France', 'Germany', 'Canada', 'Turkey', 'Spain', 'Italy',
      'Norway', 'Denmark', 'Netherlands', 'Belgium', 'Greece', 'Poland',
      'Czech Republic', 'Hungary', 'Romania', 'Bulgaria', 'Croatia', 'Slovakia',
      'Slovenia', 'Latvia', 'Lithuania', 'Estonia', 'Albania', 'Portugal',
      'Australia', 'Israel', 'Japan', 'South Korea',
    ],
    red: [
      'Russia', 'China', 'North Korea', 'Iran', 'Syria', 'Belarus',
    ],
  },
  {
    id: 'cold-war',
    name: 'Cold War (1980s)',
    description: 'NATO vs Warsaw Pact, circa 1985',
    blue: [
      'USA', 'UK', 'France', 'Germany', 'Canada', 'Turkey', 'Spain', 'Italy',
      'Norway', 'Denmark', 'Netherlands', 'Belgium', 'Greece', 'Portugal',
      'Australia', 'Japan', 'South Korea', 'Israel',
    ],
    red: [
      'Russia', 'China', 'North Korea', 'Cuba', 'Hungary', 'Poland',
      'Czech Republic', 'Romania', 'Bulgaria', 'Syria', 'Iraq', 'Iran',
    ],
  },
  {
    id: 'gulf-war',
    name: 'Gulf War (1991)',
    description: 'US-led coalition vs Iraq',
    blue: [
      'USA', 'UK', 'France', 'Saudi Arabia', 'Canada', 'Italy', 'Kuwait',
      'Egypt', 'Qatar', 'Bahrain', 'UAE', 'Oman', 'Australia',
    ],
    red: [
      'Iraq', 'Russia',
    ],
  },
  {
    id: 'pacific',
    name: 'Pacific Theater',
    description: 'US and allies vs China and DPRK',
    blue: [
      'USA', 'Japan', 'South Korea', 'Australia', 'UK', 'Canada', 'France',
      'Philippines', 'Thailand',
    ],
    red: [
      'China', 'North Korea', 'Russia',
    ],
  },
  {
    id: 'middle-east',
    name: 'Middle East Conflict',
    description: 'Western coalition vs regional adversaries',
    blue: [
      'USA', 'UK', 'France', 'Israel', 'Saudi Arabia', 'UAE', 'Jordan',
      'Turkey', 'Egypt', 'Kuwait', 'Qatar', 'Bahrain',
    ],
    red: [
      'Iran', 'Syria', 'Iraq', 'Russia',
    ],
  },
  {
    id: 'india-pakistan',
    name: 'India vs Pakistan',
    description: 'South Asian conflict scenario',
    blue: [
      'India', 'USA', 'UK', 'France', 'Israel',
    ],
    red: [
      'Pakistan', 'China', 'North Korea',
    ],
  },
  {
    id: 'falklands',
    name: 'Falklands War (1982)',
    description: 'UK vs Argentina',
    blue: [
      'UK', 'USA',
    ],
    red: [
      'Argentina',
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const COAL_COLORS: Record<string, string> = {
  blue: '#4a8fd4',
  red: '#d95050',
  neutrals: '#8a8a6a',
};

const columnStyle: React.CSSProperties = {
  flex: 1, minWidth: 0,
  background: '#0a1218', borderRadius: 6, border: '1px solid #12202e',
  padding: 10, minHeight: 200,
};

const countryPill: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '6px 10px', borderRadius: 4, marginBottom: 4,
  fontSize: 12, cursor: 'pointer', transition: 'background 0.1s',
};

const presetCard: React.CSSProperties = {
  padding: '8px 12px', background: '#0a1218', borderRadius: 4,
  border: '1px solid #12202e', cursor: 'pointer', transition: 'border-color 0.15s',
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function CoalitionsTab() {
  const countries = useMissionStore((s) => s.countries);
  const groups = useMissionStore((s) => s.groups);
  const addEdit = useEditStore((s) => s.addEdit);

  // Local state: map of country name → coalition
  const initialAssignments = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of countries) {
      map.set(c.name, c.coalition);
    }
    return map;
  }, [countries]);

  const [assignments, setAssignments] = useState<Map<string, string>>(new Map(initialAssignments));
  const [applied, setApplied] = useState(false);
  const [showPresets, setShowPresets] = useState(false);

  // Rebuild when countries change
  useMemo(() => {
    setAssignments(new Map(initialAssignments));
  }, [initialAssignments]);

  // Group countries by coalition
  const coalitionGroups = useMemo(() => {
    const result: Record<string, { name: string; unitCount: number; groupCount: number }[]> = {
      blue: [], red: [], neutrals: [],
    };
    for (const c of countries) {
      const coal = assignments.get(c.name) || c.coalition;
      if (!result[coal]) result[coal] = [];
      const groupCount = groups.filter(
        (g) => g.country === c.name
      ).length;
      result[coal].push({ name: c.name, unitCount: c.unitCount, groupCount });
    }
    // Sort each by unit count descending
    for (const coal of Object.keys(result)) {
      result[coal].sort((a, b) => b.unitCount - a.unitCount);
    }
    return result;
  }, [countries, groups, assignments]);

  const hasChanges = useMemo(() => {
    for (const c of countries) {
      if (assignments.get(c.name) !== c.coalition) return true;
    }
    return false;
  }, [assignments, countries]);

  const moveCountry = useCallback((name: string, toCoalition: string) => {
    setAssignments((prev) => {
      const next = new Map(prev);
      next.set(name, toCoalition);
      return next;
    });
    setApplied(false);
  }, []);

  const cycleCoalition = useCallback((name: string) => {
    const current = assignments.get(name) || 'neutrals';
    const order = ['blue', 'red', 'neutrals'];
    const next = order[(order.indexOf(current) + 1) % order.length];
    moveCountry(name, next);
  }, [assignments, moveCountry]);

  const applyPreset = useCallback((preset: CoalitionPreset) => {
    setAssignments((prev) => {
      const next = new Map(prev);
      const blueSet = new Set(preset.blue.map((s) => s.toLowerCase()));
      const redSet = new Set(preset.red.map((s) => s.toLowerCase()));
      for (const c of countries) {
        const lower = c.name.toLowerCase();
        if (blueSet.has(lower)) next.set(c.name, 'blue');
        else if (redSet.has(lower)) next.set(c.name, 'red');
        // Countries not in preset keep their current assignment
      }
      return next;
    });
    setApplied(false);
    setShowPresets(false);
  }, [countries]);

  const handleApply = useCallback(() => {
    // Build the reassignment map: only changed countries
    const changes: Record<string, string> = {};
    for (const c of countries) {
      const newCoal = assignments.get(c.name);
      if (newCoal && newCoal !== c.coalition) {
        changes[c.name] = newCoal;
      }
    }
    if (Object.keys(changes).length === 0) return;

    addEdit({
      field: 'coalitionReassign',
      value: changes,
    } as any);
    setApplied(true);
  }, [assignments, countries, addEdit]);

  const handleReset = useCallback(() => {
    setAssignments(new Map(initialAssignments));
    setApplied(false);
  }, [initialAssignments]);

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#ccdae8' }}>
          Coalitions
        </h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setShowPresets(!showPresets)}
            style={{
              background: showPresets ? 'rgba(74, 143, 212, 0.15)' : '#1a2a3a',
              border: '1px solid #2a3a4a', borderRadius: 4,
              color: '#4a8fd4', cursor: 'pointer', fontSize: 12,
              padding: '5px 12px', fontFamily: 'inherit',
            }}
          >
            {showPresets ? 'Hide Presets' : 'Presets'}
          </button>
          {hasChanges && (
            <button onClick={handleReset} style={{
              background: 'transparent', border: '1px solid #2a3a4a', borderRadius: 4,
              color: '#5a7a8a', cursor: 'pointer', fontSize: 12,
              padding: '5px 12px', fontFamily: 'inherit',
            }}>
              Reset
            </button>
          )}
        </div>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#5a7a8a' }}>
        Click a country to cycle it between coalitions. Use presets for quick era-based setups.
      </p>

      {/* Presets panel */}
      {showPresets && (
        <div style={{
          marginBottom: 14, padding: 12, background: '#0c1824',
          border: '1px solid #1a3a5a', borderRadius: 6,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#ccdae8', marginBottom: 8 }}>
            Alliance Presets
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
            {PRESETS.map((p) => (
              <div
                key={p.id}
                onClick={() => applyPreset(p)}
                style={presetCard}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#4a8fd4')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#12202e')}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: '#ccdae8' }}>{p.name}</div>
                <div style={{ fontSize: 11, color: '#5a7a8a', marginTop: 2 }}>{p.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {countries.length === 0 ? (
        <div style={{
          padding: '24px 16px', background: 'rgba(74, 143, 212, 0.04)',
          borderRadius: 6, border: '1px solid #1a3a5a', textAlign: 'center',
          color: '#5a7a8a', fontSize: 13,
        }}>
          No coalition data available. Upload a mission first.
        </div>
      ) : (
        <>
          {/* Three-column layout */}
          <div style={{ display: 'flex', gap: 8 }}>
            {(['blue', 'red', 'neutrals'] as const).map((coal) => {
              const color = COAL_COLORS[coal];
              const items = coalitionGroups[coal] || [];
              const totalUnits = items.reduce((s, c) => s + c.unitCount, 0);
              const totalGroups = items.reduce((s, c) => s + c.groupCount, 0);

              return (
                <div key={coal} style={columnStyle}>
                  {/* Column header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${color}30`,
                  }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                    <span style={{ fontSize: 14, fontWeight: 700, color }}>
                      {coal === 'neutrals' ? 'NEUTRAL' : coal.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 11, color: '#5a7a8a', marginLeft: 'auto' }}>
                      {items.length}c / {totalGroups}g / {totalUnits}u
                    </span>
                  </div>

                  {/* Country pills */}
                  {items.length === 0 && (
                    <div style={{ fontSize: 11, color: '#3a4a5a', textAlign: 'center', padding: '8px 0' }}>
                      No countries
                    </div>
                  )}
                  {items.map((c) => {
                    const changed = assignments.get(c.name) !== initialAssignments.get(c.name);
                    return (
                      <div
                        key={c.name}
                        onClick={() => cycleCoalition(c.name)}
                        style={{
                          ...countryPill,
                          background: changed ? `${color}18` : `${color}08`,
                          border: `1px solid ${changed ? color + '50' : color + '20'}`,
                        }}
                      >
                        <span style={{ color: '#ccdae8', fontWeight: changed ? 600 : 400 }}>
                          {c.name}
                          {changed && <span style={{ color, marginLeft: 4, fontSize: 10 }}>*</span>}
                        </span>
                        <span style={{ color: '#5a7a8a', fontSize: 11 }}>
                          {c.groupCount}g / {c.unitCount}u
                        </span>
                      </div>
                    );
                  })}

                  {/* Drop zone hint */}
                  <div style={{
                    marginTop: 4, padding: '4px 0', textAlign: 'center',
                    fontSize: 10, color: '#2a3a4a',
                  }}>
                    click country to cycle
                  </div>
                </div>
              );
            })}
          </div>

          {/* Apply bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginTop: 14,
            padding: '10px 0', borderTop: '1px solid #1a2a3a',
          }}>
            <button
              onClick={handleApply}
              disabled={!hasChanges}
              style={{
                background: hasChanges ? 'rgba(63, 185, 80, 0.15)' : 'rgba(63, 185, 80, 0.05)',
                border: '1px solid rgba(63, 185, 80, 0.3)',
                borderRadius: 4, color: hasChanges ? '#3fb950' : '#2a4a2a',
                fontSize: 13, padding: '8px 20px',
                cursor: hasChanges ? 'pointer' : 'not-allowed',
                fontWeight: 600, fontFamily: 'inherit',
              }}
            >
              {applied ? 'Changes Staged' : 'Stage Coalition Changes'}
            </button>
            {applied && (
              <span style={{ fontSize: 12, color: '#3fb950' }}>
                Changes will be applied when you download the .miz
              </span>
            )}
            {hasChanges && !applied && (
              <span style={{ fontSize: 12, color: '#d29922' }}>
                {Array.from(assignments.entries()).filter(
                  ([name, coal]) => initialAssignments.get(name) !== coal
                ).length} country reassignment(s) pending
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
