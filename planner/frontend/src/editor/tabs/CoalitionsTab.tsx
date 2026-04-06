/**
 * Coalitions tab — view force composition by coalition, country, and category.
 *
 * Shows which countries are in each coalition with unit breakdowns by
 * category (plane, helicopter, vehicle, ship, static) and specific types.
 */

import { useMemo, useState } from 'react';
import { useMissionStore } from '../../store/missionStore';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface CoalitionData {
  name: string;
  color: string;
  countries: CountryData[];
  totalUnits: number;
  totalGroups: number;
  categoryCounts: Record<string, number>;
}

interface CountryData {
  name: string;
  unitCount: number;
  groupCount: number;
  categories: Record<string, number>;
  unitTypes: Record<string, number>;
}

const COALITION_COLORS: Record<string, string> = {
  blue: '#4a8fd4',
  red: '#d95050',
  neutrals: '#8a8a6a',
};

const COALITION_LABELS: Record<string, string> = {
  blue: 'BLUE',
  red: 'RED',
  neutrals: 'NEUTRAL',
};

const CATEGORY_ICONS: Record<string, string> = {
  plane: 'A',
  helicopter: 'H',
  vehicle: 'V',
  ship: 'S',
  static: 'T',
};

const CATEGORY_COLORS: Record<string, string> = {
  plane: '#4a8fd4',
  helicopter: '#38bdf8',
  vehicle: '#d29922',
  ship: '#a371f7',
  static: '#5a7a8a',
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function CoalitionsTab() {
  const groups = useMissionStore((s) => s.groups);
  const countries = useMissionStore((s) => s.countries);
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);

  const coalitions = useMemo<CoalitionData[]>(() => {
    const coalMap = new Map<string, CoalitionData>();

    // Build from countries data
    for (const c of countries) {
      const coal = c.coalition;
      if (!coalMap.has(coal)) {
        coalMap.set(coal, {
          name: coal,
          color: COALITION_COLORS[coal] || '#888',
          countries: [],
          totalUnits: 0,
          totalGroups: 0,
          categoryCounts: {},
        });
      }
      const cd = coalMap.get(coal)!;

      // Count groups for this country
      const countryGroups = groups.filter(
        (g) => g.coalition === coal && g.country === c.name
      );

      const countryData: CountryData = {
        name: c.name,
        unitCount: c.unitCount,
        groupCount: countryGroups.length,
        categories: (c as any).categories || {},
        unitTypes: (c as any).unitTypes || {},
      };

      cd.countries.push(countryData);
      cd.totalUnits += c.unitCount;
      cd.totalGroups += countryGroups.length;

      for (const [cat, count] of Object.entries(countryData.categories)) {
        cd.categoryCounts[cat] = (cd.categoryCounts[cat] || 0) + (count as number);
      }
    }

    // Sort coalitions: blue, red, neutrals
    const order = ['blue', 'red', 'neutrals'];
    return [...coalMap.values()].sort(
      (a, b) => order.indexOf(a.name) - order.indexOf(b.name)
    );
  }, [countries, groups]);

  const toggleCountry = (key: string) => {
    setExpandedCountry((prev) => (prev === key ? null : key));
  };

  return (
    <div style={{ maxWidth: 750 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600, color: '#ccdae8' }}>
        Coalitions
      </h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#5a7a8a' }}>
        Force composition by coalition and country.
      </p>

      {coalitions.length === 0 ? (
        <div style={{
          padding: '24px 16px', background: 'rgba(74, 143, 212, 0.04)',
          borderRadius: 6, border: '1px solid #1a3a5a', textAlign: 'center',
          color: '#5a7a8a', fontSize: 13,
        }}>
          No coalition data available. Upload a mission first.
        </div>
      ) : (
        coalitions.map((coal) => (
          <div key={coal.name} style={{ marginBottom: 16 }}>
            {/* Coalition header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', background: `${coal.color}10`,
              border: `1px solid ${coal.color}30`, borderRadius: '6px 6px 0 0',
            }}>
              <div style={{
                width: 12, height: 12, borderRadius: 2,
                background: coal.color,
              }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: coal.color }}>
                {COALITION_LABELS[coal.name] || coal.name.toUpperCase()}
              </span>
              <span style={{ fontSize: 12, color: '#5a7a8a', marginLeft: 'auto' }}>
                {coal.countries.length} {coal.countries.length === 1 ? 'country' : 'countries'}
                {' / '}
                {coal.totalGroups} groups
                {' / '}
                {coal.totalUnits} units
              </span>
            </div>

            {/* Category summary bar */}
            <div style={{
              display: 'flex', gap: 12, padding: '8px 14px',
              background: '#0c1824', borderLeft: `1px solid ${coal.color}30`,
              borderRight: `1px solid ${coal.color}30`,
            }}>
              {Object.entries(coal.categoryCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, count]) => (
                  <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, width: 18, height: 18,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 3, background: `${CATEGORY_COLORS[cat] || '#5a7a8a'}20`,
                      color: CATEGORY_COLORS[cat] || '#5a7a8a',
                      border: `1px solid ${CATEGORY_COLORS[cat] || '#5a7a8a'}40`,
                    }}>
                      {CATEGORY_ICONS[cat] || '?'}
                    </span>
                    <span style={{ fontSize: 12, color: '#8a9aaa' }}>
                      {count} {cat}
                    </span>
                  </div>
                ))}
            </div>

            {/* Country rows */}
            <div style={{
              border: `1px solid ${coal.color}30`, borderTop: 'none',
              borderRadius: '0 0 6px 6px', overflow: 'hidden',
            }}>
              {coal.countries
                .sort((a, b) => b.unitCount - a.unitCount)
                .map((country) => {
                  const key = `${coal.name}:${country.name}`;
                  const isExpanded = expandedCountry === key;
                  const typeEntries = Object.entries(country.unitTypes)
                    .sort((a, b) => (b[1] as number) - (a[1] as number));

                  return (
                    <div key={key}>
                      <div
                        onClick={() => toggleCountry(key)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 14px', cursor: 'pointer',
                          background: isExpanded ? '#0f1a28' : '#0a1218',
                          borderTop: '1px solid #12202e',
                        }}
                      >
                        <span style={{
                          fontSize: 10, color: '#5a7a8a', width: 12,
                          transition: 'transform 0.15s',
                          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        }}>
                          ▶
                        </span>
                        <span style={{ fontSize: 13, color: '#ccdae8', fontWeight: 500, flex: 1 }}>
                          {country.name}
                        </span>
                        {/* Category badges */}
                        <div style={{ display: 'flex', gap: 4 }}>
                          {Object.entries(country.categories)
                            .sort((a, b) => (b[1] as number) - (a[1] as number))
                            .map(([cat, count]) => (
                              <span key={cat} style={{
                                fontSize: 10, padding: '1px 6px', borderRadius: 3,
                                background: `${CATEGORY_COLORS[cat] || '#5a7a8a'}15`,
                                color: CATEGORY_COLORS[cat] || '#5a7a8a',
                                border: `1px solid ${CATEGORY_COLORS[cat] || '#5a7a8a'}30`,
                              }}>
                                {count} {cat}
                              </span>
                            ))}
                        </div>
                        <span style={{ fontSize: 12, color: '#5a7a8a', minWidth: 60, textAlign: 'right' }}>
                          {country.unitCount} units
                        </span>
                      </div>

                      {/* Expanded: unit type breakdown */}
                      {isExpanded && typeEntries.length > 0 && (
                        <div style={{
                          padding: '8px 14px 10px 36px',
                          background: '#0f1a28', borderTop: '1px solid #12202e',
                        }}>
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                            gap: '4px 16px',
                          }}>
                            {typeEntries.map(([type, count]) => (
                              <div key={type} style={{
                                display: 'flex', justifyContent: 'space-between',
                                fontSize: 12, padding: '2px 0',
                              }}>
                                <span style={{ color: '#8a9aaa' }}>{type}</span>
                                <span style={{ color: '#ccdae8', fontWeight: 500, fontFamily: 'monospace' }}>
                                  x{count as number}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
