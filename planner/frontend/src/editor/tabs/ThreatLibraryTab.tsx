import { useState, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { isPlayerGroup } from '../../utils/groups';
import type { ThreatRing, MissionGroup } from '../../types/mission';

/* ------------------------------------------------------------------ */
/* SAM threat database — NATO designation, guidance, typical ranges     */
/* ------------------------------------------------------------------ */

interface SamInfo {
  nato: string;
  system: string;
  guidance: string;
  rangeKm: number;
  altMaxFt: number;
  category: 'strategic' | 'medium' | 'short' | 'shorad' | 'manpad' | 'aaa';
}

/** Maps DCS unit type substrings → SAM info for display enrichment */
const SAM_DATABASE: Record<string, SamInfo> = {
  'S-300':    { nato: 'SA-10 Grumble',    system: 'S-300PS',       guidance: 'Semi-active radar', rangeKm: 120, altMaxFt: 98000, category: 'strategic' },
  'Patriot':  { nato: 'MIM-104 Patriot',  system: 'Patriot',       guidance: 'Track-via-missile', rangeKm: 100, altMaxFt: 79000, category: 'strategic' },
  'Hawk':     { nato: 'MIM-23 Hawk',      system: 'Hawk',          guidance: 'Semi-active CW',    rangeKm: 45,  altMaxFt: 45000, category: 'medium' },
  'SA-11':    { nato: 'SA-11 Gadfly',     system: 'Buk M1',        guidance: 'Semi-active radar', rangeKm: 45,  altMaxFt: 72000, category: 'medium' },
  'Kub':      { nato: 'SA-6 Gainful',     system: 'Kub (2K12)',    guidance: 'Semi-active radar', rangeKm: 24,  altMaxFt: 40000, category: 'medium' },
  'Osa':      { nato: 'SA-8 Gecko',       system: 'Osa (9K33)',    guidance: 'Radio command',     rangeKm: 9,   altMaxFt: 16000, category: 'short' },
  'Tor':      { nato: 'SA-15 Gauntlet',   system: 'Tor (9K330)',   guidance: 'Radio command',     rangeKm: 12,  altMaxFt: 20000, category: 'short' },
  'SA-15':    { nato: 'SA-15 Gauntlet',   system: 'Tor (9K330)',   guidance: 'Radio command',     rangeKm: 12,  altMaxFt: 20000, category: 'short' },
  'Tunguska': { nato: 'SA-19 Grison',     system: 'Tunguska (2S6)',guidance: 'Radar/optical',     rangeKm: 8,   altMaxFt: 11000, category: 'shorad' },
  '2S6':      { nato: 'SA-19 Grison',     system: 'Tunguska (2S6)',guidance: 'Radar/optical',     rangeKm: 8,   altMaxFt: 11000, category: 'shorad' },
  'Strela-10':{ nato: 'SA-13 Gopher',     system: 'Strela-10',     guidance: 'IR',                rangeKm: 5,   altMaxFt: 11500, category: 'shorad' },
  'Strela-1': { nato: 'SA-9 Gaskin',      system: 'Strela-1',      guidance: 'IR',                rangeKm: 4.2, altMaxFt: 11500, category: 'shorad' },
  'SA-9':     { nato: 'SA-9 Gaskin',      system: 'Strela-1',      guidance: 'IR',                rangeKm: 4.2, altMaxFt: 11500, category: 'shorad' },
  'Roland':   { nato: 'Roland',           system: 'Roland ADS',    guidance: 'Radio command',     rangeKm: 8,   altMaxFt: 19700, category: 'short' },
  'Avenger':  { nato: 'Avenger',          system: 'AN/TWQ-1',      guidance: 'IR (Stinger)',      rangeKm: 5.5, altMaxFt: 12500, category: 'shorad' },
  'Linebacker':{ nato: 'Linebacker',      system: 'M6 Linebacker', guidance: 'IR (Stinger)',      rangeKm: 8,   altMaxFt: 12500, category: 'shorad' },
  'Vulcan':   { nato: 'M163 VADS',        system: 'M163 Vulcan',   guidance: 'Radar/optical',     rangeKm: 1.5, altMaxFt: 3000,  category: 'aaa' },
  'Shilka':   { nato: 'ZSU-23-4 Shilka',  system: 'ZSU-23-4',      guidance: 'Radar',             rangeKm: 2.5, altMaxFt: 5000,  category: 'aaa' },
  'ZU-23':    { nato: 'ZU-23',            system: 'ZU-23-2',       guidance: 'Optical',           rangeKm: 2.5, altMaxFt: 5000,  category: 'aaa' },
  'rapier':   { nato: 'Rapier',           system: 'Rapier FSA',    guidance: 'Radio command',     rangeKm: 7,   altMaxFt: 10000, category: 'short' },
};

function lookupSamInfo(unitType: string): SamInfo | null {
  for (const [key, info] of Object.entries(SAM_DATABASE)) {
    if (unitType.toLowerCase().includes(key.toLowerCase())) return info;
  }
  return null;
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  strategic: { label: 'Strategic',  color: '#f85149' },
  medium:    { label: 'Medium',     color: '#d29922' },
  short:     { label: 'Short',      color: '#d29922' },
  shorad:    { label: 'SHORAD',     color: '#3fb950' },
  manpad:    { label: 'MANPAD',     color: '#3fb950' },
  aaa:       { label: 'AAA',        color: '#8fa8c0' },
};

/* ------------------------------------------------------------------ */
/* Haversine math for route-threat analysis                            */
/* ------------------------------------------------------------------ */

const R_EARTH_M = 6371000;
const DEG2RAD = Math.PI / 180;
const M_TO_NM = 1 / 1852;

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return R_EARTH_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Minimum distance from a point to a line segment (great circle approx via flat earth for short distances) */
function pointToSegmentDist(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): number {
  // Project onto segment using parametric t
  const dx = bLon - aLon;
  const dy = bLat - aLat;
  if (dx === 0 && dy === 0) return haversine(pLat, pLon, aLat, aLon);
  let t = ((pLon - aLon) * dx + (pLat - aLat) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  const closestLon = aLon + t * dx;
  const closestLat = aLat + t * dy;
  return haversine(pLat, pLon, closestLat, closestLon);
}

/* ------------------------------------------------------------------ */
/* Exposure analysis                                                   */
/* ------------------------------------------------------------------ */

interface ExposureResult {
  groupId: number;
  groupName: string;
  coalition: string;
  isPlayer: boolean;
  legs: LegExposure[];
  maxThreatCategory: string;
  threatCount: number;
}

interface LegExposure {
  fromWp: number;
  toWp: number;
  fromName: string;
  toName: string;
  threats: LegThreat[];
}

interface LegThreat {
  threatName: string;
  threatType: string;
  nato: string;
  category: string;
  rangeM: number;
  closestApproachM: number;
  /** negative = inside ring, positive = outside ring */
  marginM: number;
}

function analyzeRouteExposure(
  group: MissionGroup,
  threats: ThreatRing[],
): ExposureResult {
  const legs: LegExposure[] = [];
  const wps = group.waypoints.filter((w) => w.lat != null && w.lon != null);
  const seenThreats = new Set<string>();

  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    const legThreats: LegThreat[] = [];

    for (const t of threats) {
      if (!t.lat || !t.lon) continue;
      const dist = pointToSegmentDist(t.lat, t.lon, a.lat!, a.lon!, b.lat!, b.lon!);
      const margin = dist - t.range;
      // Flag if route passes within 120% of threat range (inside or close)
      if (margin < t.range * 0.2) {
        const info = lookupSamInfo(t.type);
        legThreats.push({
          threatName: t.name,
          threatType: t.type,
          nato: info?.nato || t.type,
          category: info?.category || 'medium',
          rangeM: t.range,
          closestApproachM: dist,
          marginM: margin,
        });
        seenThreats.add(`${t.name}-${t.x}-${t.y}`);
      }
    }

    if (legThreats.length > 0) {
      legThreats.sort((a, b) => a.marginM - b.marginM);
      legs.push({
        fromWp: a.waypoint_number,
        toWp: b.waypoint_number,
        fromName: a.waypoint_name || `WP${a.waypoint_number}`,
        toName: b.waypoint_name || `WP${b.waypoint_number}`,
        threats: legThreats,
      });
    }
  }

  // Determine worst threat category
  const categoryPriority = ['strategic', 'medium', 'short', 'shorad', 'aaa', 'manpad'];
  let maxCat = '';
  for (const leg of legs) {
    for (const lt of leg.threats) {
      const idx = categoryPriority.indexOf(lt.category);
      const curIdx = categoryPriority.indexOf(maxCat);
      if (maxCat === '' || (idx >= 0 && idx < curIdx)) maxCat = lt.category;
    }
  }

  return {
    groupId: group.groupId,
    groupName: group.groupName,
    coalition: group.coalition,
    isPlayer: isPlayerGroup(group),
    legs,
    maxThreatCategory: maxCat,
    threatCount: seenThreats.size,
  };
}

/* ------------------------------------------------------------------ */
/* Grouped threat view                                                 */
/* ------------------------------------------------------------------ */

interface ThreatGroup {
  system: string;
  nato: string;
  category: string;
  guidance: string;
  rangeKm: number;
  altMaxFt: number;
  threats: ThreatRing[];
}

function groupThreats(threats: ThreatRing[]): ThreatGroup[] {
  const map = new Map<string, ThreatGroup>();
  for (const t of threats) {
    const info = lookupSamInfo(t.type);
    const key = info?.nato || t.type;
    if (!map.has(key)) {
      map.set(key, {
        system: info?.system || t.type,
        nato: key,
        category: info?.category || 'medium',
        guidance: info?.guidance || 'Unknown',
        rangeKm: info?.rangeKm || Math.round(t.range / 1000),
        altMaxFt: info?.altMaxFt || 0,
        threats: [],
      });
    }
    map.get(key)!.threats.push(t);
  }
  // Sort: strategic first, then by range descending
  const catOrder = ['strategic', 'medium', 'short', 'shorad', 'manpad', 'aaa'];
  return Array.from(map.values()).sort((a, b) => {
    const ca = catOrder.indexOf(a.category);
    const cb = catOrder.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return b.rangeKm - a.rangeKm;
  });
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type ViewTab = 'threats' | 'exposure';
type CoalFilter = 'all' | 'red' | 'blue';

export function ThreatLibraryTab() {
  const groups = useMissionStore((s) => s.groups);
  const threats = useMissionStore((s) => s.threats);
  const [viewTab, setViewTab] = useState<ViewTab>('threats');
  const [coalFilter, setCoalFilter] = useState<CoalFilter>('all');
  const [expandedSystems, setExpandedSystems] = useState<Set<string>>(new Set());
  const [expandedFlights, setExpandedFlights] = useState<Set<number>>(new Set());

  // Filter threats by coalition
  const filtered = useMemo(() => {
    if (coalFilter === 'all') return threats;
    return threats.filter((t) => t.coalition === coalFilter);
  }, [threats, coalFilter]);

  // Group threats by system type
  const threatGroups = useMemo(() => groupThreats(filtered), [filtered]);

  // Route exposure analysis — analyze all flights with waypoints against enemy threats
  const exposureResults = useMemo<ExposureResult[]>(() => {
    const airGroups = groups.filter((g) =>
      (g.category === 'plane' || g.category === 'helicopter') &&
      g.waypoints.length >= 2
    );
    // Only analyze against opposing threats
    const results: ExposureResult[] = [];
    for (const g of airGroups) {
      const enemyThreats = threats.filter((t) =>
        t.coalition !== g.coalition && t.lat != null && t.lon != null
      );
      if (enemyThreats.length === 0) continue;
      const result = analyzeRouteExposure(g, enemyThreats);
      if (result.legs.length > 0 || isPlayerGroup(g)) {
        results.push(result);
      }
    }
    // Players first, then by threat severity
    const catOrder = ['strategic', 'medium', 'short', 'shorad', 'aaa', 'manpad', ''];
    results.sort((a, b) => {
      if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1;
      const ca = catOrder.indexOf(a.maxThreatCategory);
      const cb = catOrder.indexOf(b.maxThreatCategory);
      return ca - cb;
    });
    return results;
  }, [groups, threats]);

  const toggleSystem = useCallback((key: string) => {
    setExpandedSystems((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const toggleFlight = useCallback((groupId: number) => {
    setExpandedFlights((prev) => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  }, []);

  // Stats
  const redCount = threats.filter((t) => t.coalition === 'red').length;
  const blueCount = threats.filter((t) => t.coalition === 'blue').length;
  const exposedPlayers = exposureResults.filter((r) => r.isPlayer && r.legs.length > 0).length;
  const totalPlayers = exposureResults.filter((r) => r.isPlayer).length;

  return (
    <div style={{ maxWidth: 800 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600, color: '#ccdae8' }}>
        Threat Library
      </h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#5a7a8a' }}>
        SAM/AAA systems detected in the mission and route exposure analysis.
      </p>

      {threats.length === 0 ? (
        <div style={{ color: '#5a7a8a', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>
          No SAM/AAA threats detected in this mission.
        </div>
      ) : (
        <>
          {/* Stats bar */}
          <div style={{
            display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap',
          }}>
            <StatBadge label="Red Threats" value={redCount} color="#f85149" />
            <StatBadge label="Blue SAMs" value={blueCount} color="#4a8fd4" />
            <StatBadge label="System Types" value={threatGroups.length} color="#d29922" />
            <StatBadge label="Players Exposed" value={`${exposedPlayers}/${totalPlayers}`} color={exposedPlayers > 0 ? '#f85149' : '#3fb950'} />
          </div>

          {/* View toggle + filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <TabButton active={viewTab === 'threats'} onClick={() => setViewTab('threats')}>
              Threat Overview
            </TabButton>
            <TabButton active={viewTab === 'exposure'} onClick={() => setViewTab('exposure')}>
              Route Exposure
            </TabButton>
            <div style={{ flex: 1 }} />
            <select
              value={coalFilter}
              onChange={(e) => setCoalFilter(e.target.value as CoalFilter)}
              style={{
                background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
                color: '#ccdae8', fontSize: 12, padding: '4px 8px',
              }}
            >
              <option value="all">All Coalitions</option>
              <option value="red">Red Only</option>
              <option value="blue">Blue Only</option>
            </select>
          </div>

          {/* Threat overview */}
          {viewTab === 'threats' && (
            <div>
              {threatGroups.map((tg) => {
                const catInfo = CATEGORY_LABELS[tg.category] || { label: tg.category, color: '#8fa8c0' };
                const isExpanded = expandedSystems.has(tg.nato);
                return (
                  <div key={tg.nato} style={{
                    marginBottom: 6, background: '#0a1218', borderRadius: 6,
                    border: '1px solid #12202e', overflow: 'hidden',
                  }}>
                    {/* System header */}
                    <div
                      onClick={() => toggleSystem(tg.nato)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px', cursor: 'pointer',
                      }}
                    >
                      <span style={{ color: '#5a7a8a', fontSize: 12, width: 14 }}>
                        {isExpanded ? '▼' : '▶'}
                      </span>
                      <span style={{
                        background: `${catInfo.color}20`, color: catInfo.color,
                        fontSize: 10, fontWeight: 700, padding: '2px 7px',
                        borderRadius: 3, border: `1px solid ${catInfo.color}40`,
                      }}>
                        {catInfo.label}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#ccdae8', fontSize: 13, fontWeight: 600 }}>
                          {tg.nato}
                        </div>
                        <div style={{ color: '#5a7a8a', fontSize: 11 }}>
                          {tg.system} — {tg.guidance}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ color: '#ccdae8', fontSize: 13, fontFamily: 'monospace' }}>
                          {tg.rangeKm} km
                        </div>
                        <div style={{ color: '#5a7a8a', fontSize: 11 }}>
                          {tg.altMaxFt > 0 ? `${(tg.altMaxFt / 1000).toFixed(0)}k ft` : ''}
                        </div>
                      </div>
                      <span style={{
                        color: catInfo.color, fontSize: 11, fontWeight: 600, background: `${catInfo.color}15`,
                        border: `1px solid ${catInfo.color}30`, borderRadius: 10, padding: '1px 8px',
                      }}>
                        {tg.threats.length}
                      </span>
                    </div>

                    {/* Expanded — individual units */}
                    {isExpanded && (
                      <div style={{ borderTop: '1px solid #12202e', padding: '6px 14px 10px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '2px 16px', fontSize: 12 }}>
                          <div style={{ color: '#5a7a8a', fontWeight: 600, fontSize: 11, paddingBottom: 4 }}>Unit</div>
                          <div style={{ color: '#5a7a8a', fontWeight: 600, fontSize: 11, paddingBottom: 4 }}>Coalition</div>
                          <div style={{ color: '#5a7a8a', fontWeight: 600, fontSize: 11, paddingBottom: 4 }}>Range</div>
                          {tg.threats.map((t, i) => (
                            <ThreatUnitRow key={i} threat={t} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Route exposure */}
          {viewTab === 'exposure' && (
            <div>
              {exposureResults.length === 0 ? (
                <div style={{ color: '#5a7a8a', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
                  No air groups with waypoints found for analysis.
                </div>
              ) : (
                exposureResults.map((result) => {
                  const isExpanded = expandedFlights.has(result.groupId);
                  const catInfo = result.maxThreatCategory
                    ? (CATEGORY_LABELS[result.maxThreatCategory] || { label: '', color: '#8fa8c0' })
                    : null;
                  const safe = result.legs.length === 0;

                  return (
                    <div key={result.groupId} style={{
                      marginBottom: 6, background: '#0a1218', borderRadius: 6,
                      border: `1px solid ${safe ? '#12202e' : '#f8514930'}`, overflow: 'hidden',
                    }}>
                      <div
                        onClick={() => toggleFlight(result.groupId)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 14px', cursor: 'pointer',
                        }}
                      >
                        <span style={{ color: '#5a7a8a', fontSize: 12, width: 14 }}>
                          {result.legs.length > 0 ? (isExpanded ? '▼' : '▶') : ''}
                        </span>
                        {result.isPlayer && (
                          <span style={{
                            background: '#4a8fd420', color: '#4a8fd4', fontSize: 10,
                            fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                            border: '1px solid #4a8fd440',
                          }}>
                            PLAYER
                          </span>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            color: '#ccdae8', fontSize: 13, fontWeight: 500,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {result.groupName}
                          </div>
                        </div>
                        {safe ? (
                          <span style={{ color: '#3fb950', fontSize: 12, fontWeight: 600 }}>
                            CLEAR
                          </span>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {catInfo && (
                              <span style={{
                                background: `${catInfo.color}20`, color: catInfo.color,
                                fontSize: 10, fontWeight: 700, padding: '2px 7px',
                                borderRadius: 3, border: `1px solid ${catInfo.color}40`,
                              }}>
                                {catInfo.label}
                              </span>
                            )}
                            <span style={{
                              color: '#f85149', fontSize: 12, fontWeight: 600,
                            }}>
                              {result.threatCount} threat{result.threatCount !== 1 ? 's' : ''}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Expanded — leg details */}
                      {isExpanded && result.legs.length > 0 && (
                        <div style={{ borderTop: '1px solid #12202e', padding: '8px 14px 10px' }}>
                          {result.legs.map((leg, li) => (
                            <div key={li} style={{ marginBottom: li < result.legs.length - 1 ? 10 : 0 }}>
                              <div style={{ color: '#5a7a8a', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                                WP{leg.fromWp} → WP{leg.toWp}
                                <span style={{ fontWeight: 400, marginLeft: 6 }}>
                                  ({leg.fromName} → {leg.toName})
                                </span>
                              </div>
                              {leg.threats.map((lt, ti) => {
                                const inside = lt.marginM < 0;
                                const distNm = Math.abs(lt.closestApproachM * M_TO_NM).toFixed(1);
                                const marginNm = Math.abs(lt.marginM * M_TO_NM).toFixed(1);
                                const ltCat = CATEGORY_LABELS[lt.category] || { label: lt.category, color: '#8fa8c0' };
                                return (
                                  <div key={ti} style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '4px 8px', marginLeft: 14,
                                    background: inside ? 'rgba(248, 81, 73, 0.06)' : 'transparent',
                                    borderRadius: 3, fontSize: 12,
                                  }}>
                                    <span style={{
                                      color: inside ? '#f85149' : '#d29922',
                                      fontWeight: 600, width: 14, textAlign: 'center',
                                    }}>
                                      {inside ? '!' : '~'}
                                    </span>
                                    <span style={{ color: ltCat.color, fontSize: 10, fontWeight: 600 }}>
                                      {ltCat.label}
                                    </span>
                                    <span style={{ color: '#ccdae8', flex: 1 }}>
                                      {lt.nato}
                                    </span>
                                    <span style={{ color: '#5a7a8a', fontFamily: 'monospace', fontSize: 11 }}>
                                      {distNm} nm
                                    </span>
                                    <span style={{
                                      color: inside ? '#f85149' : '#3fb950',
                                      fontFamily: 'monospace', fontSize: 11, fontWeight: 600,
                                    }}>
                                      {inside ? `${marginNm} nm inside` : `${marginNm} nm clear`}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function StatBadge({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{
      background: `${color}10`, border: `1px solid ${color}30`, borderRadius: 6,
      padding: '8px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 80,
    }}>
      <div style={{ color, fontSize: 18, fontWeight: 700, fontFamily: 'monospace' }}>{value}</div>
      <div style={{ color: '#5a7a8a', fontSize: 10, fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'rgba(74, 143, 212, 0.12)' : 'transparent',
        border: `1px solid ${active ? '#4a8fd4' : '#1a2a3a'}`,
        borderRadius: 4, color: active ? '#4a8fd4' : '#5a7a8a',
        cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400,
        padding: '6px 14px', fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function ThreatUnitRow({ threat }: { threat: ThreatRing }) {
  const coalColor = threat.coalition === 'red' ? '#f85149' : threat.coalition === 'blue' ? '#4a8fd4' : '#8fa8c0';
  return (
    <>
      <div style={{ color: '#ccdae8', padding: '2px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {threat.name}
      </div>
      <div style={{ color: coalColor, fontWeight: 600, textTransform: 'uppercase', fontSize: 11, padding: '2px 0' }}>
        {threat.coalition}
      </div>
      <div style={{ color: '#5a7a8a', fontFamily: 'monospace', padding: '2px 0', textAlign: 'right' }}>
        {(threat.range / 1000).toFixed(0)} km / {(threat.range * M_TO_NM).toFixed(1)} nm
      </div>
    </>
  );
}
