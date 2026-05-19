/**
 * Coalitions tab — view and reassign countries between coalitions.
 *
 * Shows current coalition assignments with unit counts, and allows
 * reassigning countries via click or using era-based presets.
 * Changes are staged as edits and applied on .miz download.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
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

// Country names MUST match DCS's exact strings (case-insensitive). When
// a preset name doesn't match a country present in the .miz, the preset
// silently skips it — which looks like "presets don't work" if half the
// preset's countries are misspelled. Cross-reference any new entries
// against `dcs.countries.country_dict` before adding.
//
// Notable DCS naming quirks to watch for:
//   - 'The Netherlands' (NOT 'Netherlands')
//   - 'United Arab Emirates' (NOT 'UAE')
//   - Latvia / Lithuania / Estonia / Albania — DCS doesn't model these
const PRESETS: CoalitionPreset[] = [
  {
    id: 'modern-nato-vs-russia',
    name: 'Modern NATO vs Russia',
    description: 'Current-era NATO alliance vs Russian Federation and allies',
    blue: [
      'USA', 'UK', 'France', 'Germany', 'Canada', 'Turkey', 'Spain', 'Italy',
      'Norway', 'Denmark', 'The Netherlands', 'Belgium', 'Greece', 'Poland',
      'Czech Republic', 'Hungary', 'Romania', 'Bulgaria', 'Croatia', 'Slovakia',
      'Slovenia', 'Portugal', 'Sweden', 'Finland',
      // Ukraine is a Western ally in current-era scenarios — DCS lists it
      // separately from NATO members but mission designers consistently
      // place it on blue. Without it here the preset was a no-op for
      // Ukraine-vs-Russia missions (Fett's testing case).
      'Ukraine',
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
      'Norway', 'Denmark', 'The Netherlands', 'Belgium', 'Greece', 'Portugal',
      'Australia', 'Japan', 'South Korea', 'Israel',
    ],
    red: [
      // Soviet republics (Ukrainian SSR, Belarussian SSR were part of the
      // USSR throughout the 80s — DCS still models them as separate
      // countries because units use them in modern scenarios). Without
      // them on the red list here, a Cold War mission with Ukraine
      // would leave Ukraine on blue, which is wrong for the era.
      'Russia', 'Ukraine', 'Belarus',
      // Warsaw Pact + aligned states
      'China', 'North Korea', 'Cuba', 'Hungary', 'Poland',
      'Czech Republic', 'Romania', 'Bulgaria', 'Syria', 'Iraq', 'Iran',
    ],
  },
  {
    id: 'gulf-war',
    name: 'Gulf War (1991)',
    description: 'US-led coalition vs Iraq',
    blue: [
      'USA', 'UK', 'France', 'Saudi Arabia', 'Canada', 'Italy', 'Kuwait',
      'Egypt', 'Qatar', 'Bahrain', 'United Arab Emirates', 'Oman', 'Australia',
    ],
    red: [
      'Iraq', 'Russia',
    ],
  },
  {
    id: 'middle-east',
    name: 'Middle East Conflict',
    description: 'Western coalition vs regional adversaries',
    blue: [
      'USA', 'UK', 'France', 'Israel', 'Saudi Arabia', 'United Arab Emirates',
      'Jordan', 'Turkey', 'Egypt', 'Kuwait', 'Qatar', 'Bahrain',
    ],
    red: [
      'Iran', 'Syria', 'Iraq', 'Russia',
    ],
  },
];

// Aliases — common names users might write that DCS spells differently.
// applyPreset() normalizes preset country names through this map before
// the lookup, so a preset accidentally written with "UAE" or "Netherlands"
// still works. New aliases go here, not in the PRESETS list above.
const COUNTRY_ALIASES: Record<string, string> = {
  'uae': 'united arab emirates',
  'netherlands': 'the netherlands',
  'usa': 'usa',  // sanity — already matches
  'us': 'usa',
};

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const COAL_COLORS: Record<string, string> = {
  blue: '#d49a30',
  red: '#d95050',
  neutrals: '#8a8a6a',
};

const columnStyle: React.CSSProperties = {
  flex: 1, minWidth: 0,
  background: '#6e7c83', borderRadius: 6, border: '1px solid #8c9ba2',
  padding: 10, minHeight: 200,
};

const countryPill: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '6px 10px', borderRadius: 4, marginBottom: 4,
  fontSize: 12, cursor: 'pointer', transition: 'background 0.1s',
};

const presetCard: React.CSSProperties = {
  padding: '8px 12px', background: '#6e7c83', borderRadius: 4,
  border: '1px solid #8c9ba2', cursor: 'pointer', transition: 'border-color 0.15s',
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

  const [assignments, setAssignments] = useState<Map<string, string>>(() => new Map(initialAssignments));
  const [showPresets, setShowPresets] = useState(false);

  // Reset assignments when the underlying country list changes (new mission loaded).
  // Using useEffect (not useMemo) because this is a side effect, not a memoized value.
  useEffect(() => {
    setAssignments(new Map(initialAssignments));
  }, [initialAssignments]);

  // Auto-stage on every change: compute the cumulative diff against the
  // initial assignments and dispatch a coalitionReassign edit. Earlier
  // versions required clicking an explicit "Stage Coalition Changes"
  // button — Fett moved Ukraine to red and downloaded without staging,
  // got a .miz where Ukraine was still blue. Auto-staging matches the
  // every-other-tab pattern (weather, comms, etc.) where mutations
  // queue immediately. The backend handler is idempotent so re-firing
  // the same change set on each click is safe.
  useEffect(() => {
    const changes: Record<string, string> = {};
    for (const [name, coal] of assignments) {
      const initial = initialAssignments.get(name);
      if (initial && coal !== initial) {
        changes[name] = coal;
      }
    }
    // Always dispatch — even an empty changes set, because clearing
    // back to the original (Reset) needs to overwrite a previous
    // coalitionReassign edit. Edits accumulate in editStore; the most
    // recent one for a given country wins because it runs last.
    if (Object.keys(changes).length > 0) {
      addEdit({ field: 'coalitionReassign', value: changes } as any);
    }
    // Intentionally only react to assignments changes — initialAssignments
    // is recomputed when countries change (loaded mission), at which
    // point the resetting useEffect above clears assignments to match
    // and we don't want to fire a redundant edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments]);

  // Group countries by coalition. Defensively normalise unexpected
  // coalition values ('neutral' singular, undefined, etc.) into
  // 'neutrals' so the country always lands in one of the three rendered
  // columns instead of vanishing into a fourth bucket the UI ignores.
  const coalitionGroups = useMemo(() => {
    const result: Record<string, { name: string; unitCount: number; groupCount: number }[]> = {
      blue: [], red: [], neutrals: [],
    };
    for (const c of countries) {
      let coal = assignments.get(c.name) || c.coalition || 'neutrals';
      if (coal !== 'blue' && coal !== 'red') coal = 'neutrals';
      const groupCount = groups.filter(
        (g) => g.country === c.name
      ).length;
      result[coal].push({ name: c.name, unitCount: c.unitCount, groupCount });
    }
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

  // Cycle coalition uses functional setState so the read of "current"
  // always sees the latest assignments map. The previous version closed
  // over `assignments` and could see stale state under React 19's
  // automatic batching, which made consecutive clicks appear to do
  // nothing (Brazil bug). Empty deps keep the callback stable across
  // renders, so onClick refs don't churn.
  const cycleCoalition = useCallback((name: string) => {
    setAssignments((prev) => {
      const order = ['blue', 'red', 'neutrals'];
      // Coalitions in the parsed mission can use either "neutrals"
      // (plural, what extract_countries returns) or "neutral" (singular,
      // some mod / older paths). Normalise so the order lookup always
      // resolves and one click always advances.
      let current = prev.get(name) || 'neutrals';
      if (current === 'neutral') current = 'neutrals';
      const idx = order.indexOf(current);
      const next = order[(idx + 1 + order.length) % order.length];
      const result = new Map(prev);
      result.set(name, next);
      return result;
    });
  }, []);

  const applyPreset = useCallback((preset: CoalitionPreset) => {
    // Normalize each preset name through COUNTRY_ALIASES so quirks like
    // 'UAE' / 'Netherlands' resolve to the DCS canonical names ('United
    // Arab Emirates' / 'The Netherlands') before we look them up. Without
    // this, mismatched preset entries silently fail and the preset
    // appears to do nothing.
    const norm = (s: string) => {
      const lower = s.toLowerCase();
      return COUNTRY_ALIASES[lower] || lower;
    };
    setAssignments((prev) => {
      const next = new Map(prev);
      const blueSet = new Set(preset.blue.map(norm));
      const redSet = new Set(preset.red.map(norm));
      for (const c of countries) {
        const lower = c.name.toLowerCase();
        if (blueSet.has(lower)) next.set(c.name, 'blue');
        else if (redSet.has(lower)) next.set(c.name, 'red');
        // Countries not in preset keep their current assignment
      }
      return next;
    });
    setShowPresets(false);
  }, [countries]);

  const handleReset = useCallback(() => {
    setAssignments(new Map(initialAssignments));
  }, [initialAssignments]);

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#1a1f25' }}>
          Coalitions
        </h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setShowPresets(!showPresets)}
            style={{
              background: showPresets ? 'rgba(74, 143, 212, 0.15)' : '#4a5258',
              border: '1px solid #4a5258', borderRadius: 4,
              color: '#d49a30', cursor: 'pointer', fontSize: 12,
              padding: '5px 12px', fontFamily: 'inherit',
            }}
          >
            {showPresets ? 'Hide Presets' : 'Presets'}
          </button>
          {hasChanges && (
            <button onClick={handleReset} style={{
              background: 'transparent', border: '1px solid #4a5258', borderRadius: 4,
              color: '#3a4248', cursor: 'pointer', fontSize: 12,
              padding: '5px 12px', fontFamily: 'inherit',
            }}>
              Reset
            </button>
          )}
        </div>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#3a4248' }}>
        Click a country to cycle it between coalitions. Use presets for quick era-based setups.
      </p>

      {/* Presets panel */}
      {showPresets && (
        <div style={{
          marginBottom: 14, padding: 12, background: '#7a8a92',
          border: '1px solid #4a5258', borderRadius: 6,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1f25', marginBottom: 8 }}>
            Alliance Presets
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
            {PRESETS.map((p) => (
              <div
                key={p.id}
                onClick={() => applyPreset(p)}
                style={presetCard}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#d49a30')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#8c9ba2')}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1f25' }}>{p.name}</div>
                <div style={{ fontSize: 11, color: '#3a4248', marginTop: 2 }}>{p.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {countries.length === 0 ? (
        <div style={{
          padding: '24px 16px', background: 'rgba(74, 143, 212, 0.04)',
          borderRadius: 6, border: '1px solid #4a5258', textAlign: 'center',
          color: '#3a4248', fontSize: 13,
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
                    <span style={{ fontSize: 11, color: '#3a4248', marginLeft: 'auto' }}>
                      {items.length}c / {totalGroups}g / {totalUnits}u
                    </span>
                  </div>

                  {/* Country pills */}
                  {items.length === 0 && (
                    <div style={{ fontSize: 11, color: '#4a5258', textAlign: 'center', padding: '8px 0' }}>
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
                        <span style={{ color: '#1a1f25', fontWeight: changed ? 600 : 400 }}>
                          {c.name}
                          {changed && <span style={{ color, marginLeft: 4, fontSize: 10 }}>*</span>}
                        </span>
                        <span style={{ color: '#3a4248', fontSize: 11 }}>
                          {c.groupCount}g / {c.unitCount}u
                        </span>
                      </div>
                    );
                  })}

                  {/* Drop zone hint */}
                  <div style={{
                    marginTop: 4, padding: '4px 0', textAlign: 'center',
                    fontSize: 10, color: '#4a5258',
                  }}>
                    click country to cycle
                  </div>
                </div>
              );
            })}
          </div>

          {/* Status bar — coalition changes auto-stage on every click /
              preset application, so all the user needs is confirmation
              that edits are queued and a count of how many countries
              will be reassigned on download. */}
          {hasChanges && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginTop: 14,
              padding: '10px 14px', borderTop: '1px solid #4a5258',
              background: 'rgba(63, 185, 80, 0.08)',
              borderRadius: 4,
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: '#3fb950',
              }} />
              <span style={{ fontSize: 13, color: '#3fb950', fontWeight: 600 }}>
                Edits queued — download .miz to save
              </span>
              <span style={{ fontSize: 12, color: '#3a4248' }}>
                {Array.from(assignments.entries()).filter(
                  ([name, coal]) => initialAssignments.get(name) !== coal
                ).length} country reassignment(s)
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
