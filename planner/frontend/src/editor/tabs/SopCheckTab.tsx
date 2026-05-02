/**
 * SOP Check tab — read-only discrepancy report comparing the loaded
 * mission against the active SOP.
 *
 * v1 is read-only: every row tells the pilot what the mission has,
 * what the SOP says, and a severity tag. v2 (next release) will add
 * per-row "Apply SOP" buttons that dispatch the right edits — we held
 * off until the heuristics here are validated on a real mission, since
 * a bad fuzzy-match plus auto-apply could quietly stomp values that
 * were intentionally different.
 *
 * Categories checked:
 *   1. Player flight freq      — by callsign first-word match
 *   2. Guard freq              — mission GUARD vs SOP comm role=guard
 *   3. Tanker freq + TACAN     — fuzzy callsign / task match
 *   4. AWACS / support         — by task / callsign
 *   5. Carrier TACAN           — by hull type / callsign / generic CVN
 *   6. Datalink IDs            — player flight order vs SOP priority
 *   7. Laser codes             — first laser-equipped unit per flight
 */

import { useMemo } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useSopStore } from '../../sop/sopStore';
import { isPlayerGroup, isCarrierGroup } from '../../utils/groups';
import type { MissionGroup } from '../../types/mission';
import type { SOP, SopFlightCallsign, SopTanker, SopSupportAsset, SopTacanEntry } from '../../sop/types';

type Severity = 'red' | 'yellow' | 'gray';

interface DiscrepancyRow {
  category: string;
  field: string;
  missionValue: string;
  sopValue: string;
  severity: Severity;
  /** Optional explanatory text shown in muted color under the row. */
  reason?: string;
}

/* ------------------------------------------------------------------ */
/* Normalisation helpers                                              */
/* ------------------------------------------------------------------ */

/** Mission groups can store frequency in either Hz or MHz depending on how
 *  the .miz was authored. Anything ≥1e6 is Hz; smaller is already MHz. */
function freqMhz(raw: number | null | undefined): number | null {
  if (raw == null || raw <= 0) return null;
  return raw >= 1e6 ? raw / 1e6 : raw;
}

/** Mission modulation is numeric (0=AM, 1=FM). SOP / DTC carry strings. */
function modString(raw: number | undefined): 'AM' | 'FM' {
  return raw === 1 ? 'FM' : 'AM';
}

/** Convert any-source freq + mod to a canonical "270.800 AM" string. Returns
 *  '—' when no freq is present so blank cells render visibly. */
function fmtFreq(mhz: number | null, mod: 'AM' | 'FM'): string {
  if (mhz == null) return '—';
  return `${mhz.toFixed(3)} ${mod}`;
}

/** Two MHz values match if they're within 0.0005 MHz (tighter than the
 *  Hornet's 0.025 step so we still flag intentional 25kHz nudges). */
function freqsMatch(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.0005;
}

/** Pull the "first word" of a flight name — the part DCS uses as the
 *  callsign root. "Bengal 1" → "bengal", "Enfield-2-1" → "enfield". */
function firstWord(name: string): string {
  return (name || '').split(/[-\s]/)[0].toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Comparison engine                                                   */
/* ------------------------------------------------------------------ */

function checkPlayerFlightFreqs(
  groups: MissionGroup[],
  sop: SOP,
): DiscrepancyRow[] {
  const out: DiscrepancyRow[] = [];
  const sopByFirstWord = new Map<string, SopFlightCallsign>();
  for (const f of sop.flights) {
    if (!f.callsign) continue;
    sopByFirstWord.set(firstWord(f.callsign), f);
  }

  for (const g of groups) {
    if (!isPlayerGroup(g)) continue;
    if (g.category !== 'plane' && g.category !== 'helicopter') continue;

    const word = firstWord(g.groupName);
    const sopFlight = sopByFirstWord.get(word);
    if (!sopFlight) {
      // Player flight not in SOP — info, not a problem
      out.push({
        category: 'Flight Frequency',
        field: g.groupName,
        missionValue: fmtFreq(freqMhz(g.frequency), modString(g.modulation)),
        sopValue: 'Not in SOP',
        severity: 'gray',
        reason: `Callsign "${g.groupName.split(/[-\s]/)[0]}" not present in SOP flights[].`,
      });
      continue;
    }
    if (!sopFlight.defaultFreq) continue; // SOP has no opinion

    const mzMission = freqMhz(g.frequency);
    const sopFreq = sopFlight.defaultFreq;
    if (!freqsMatch(mzMission, sopFreq)) {
      out.push({
        category: 'Flight Frequency',
        field: g.groupName,
        missionValue: fmtFreq(mzMission, modString(g.modulation)),
        sopValue: fmtFreq(sopFreq, sopFlight.defaultMod ?? 'AM'),
        severity: 'red',
        reason: `Mission radio for ${sopFlight.callsign} differs from SOP default.`,
      });
    }
  }
  return out;
}

function checkGuardFreq(groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  const guardEntry = sop.comms.find((c) => /guard/i.test(c.role));
  if (!guardEntry) return [];

  // Mission "guard" is implicit — DCS doesn't expose a single guard
  // channel as group-level data. Best we can do is check whether any
  // group has a freq matching SOP guard. If none, that's a yellow.
  const sopMhz = guardEntry.frequency;
  const anyMatch = groups.some((g) => freqsMatch(freqMhz(g.frequency), sopMhz));
  if (anyMatch) return []; // someone's tuned to it — fine

  return [{
    category: 'Guard Channel',
    field: 'GUARD',
    missionValue: 'Not assigned to any group',
    sopValue: fmtFreq(sopMhz, guardEntry.modulation ?? 'AM'),
    severity: 'yellow',
    reason: 'No mission group is tuned to the SOP guard frequency. Pilots will need to dial it manually.',
  }];
}

/** Match a mission tanker group against the best SOP tanker entry by
 *  callsign substring. Returns the SOP entry or null if no plausible
 *  match. */
function matchSopTanker(g: MissionGroup, sop: SOP): SopTanker | null {
  if (!sop.tankers || sop.tankers.length === 0) return null;
  const name = g.groupName.toLowerCase();
  for (const t of sop.tankers) {
    const cs = (t.callsign || '').toLowerCase();
    if (cs && (name.includes(cs) || cs.includes(firstWord(g.groupName)))) {
      return t;
    }
  }
  // Fallback: any tanker if there's only one — gives the user a row
  // even when names don't match cleanly.
  return sop.tankers.length === 1 ? sop.tankers[0] : null;
}

function checkTankers(groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  const out: DiscrepancyRow[] = [];
  const tankers = groups.filter((g) =>
    (g.task || '').toLowerCase() === 'refueling' ||
    /tanker|texaco|shell|arco|exxon/i.test(g.groupName),
  );

  for (const g of tankers) {
    const sopT = matchSopTanker(g, sop);
    if (!sopT) {
      out.push({
        category: 'Tanker',
        field: g.groupName,
        missionValue: fmtFreq(freqMhz(g.frequency), modString(g.modulation)),
        sopValue: 'No matching SOP tanker',
        severity: 'gray',
      });
      continue;
    }

    // Frequency
    if (sopT.frequency) {
      const mz = freqMhz(g.frequency);
      if (!freqsMatch(mz, sopT.frequency)) {
        out.push({
          category: 'Tanker Freq',
          field: g.groupName,
          missionValue: fmtFreq(mz, modString(g.modulation)),
          sopValue: fmtFreq(sopT.frequency, sopT.modulation ?? 'AM'),
          severity: 'red',
          reason: `Matched to SOP tanker "${sopT.callsign}".`,
        });
      }
    }

    // TACAN
    if (sopT.tacanChannel) {
      const ch = g.tacan?.channel ?? null;
      const band = g.tacan?.band ?? null;
      const sopBand = sopT.tacanBand ?? 'X';
      const matches = ch === sopT.tacanChannel && band === sopBand;
      if (!matches) {
        out.push({
          category: 'Tanker TACAN',
          field: g.groupName,
          missionValue: ch ? `${ch}${band ?? '?'}` : 'Not set',
          sopValue: `${sopT.tacanChannel}${sopBand}${sopT.tacanCallsign ? ' ' + sopT.tacanCallsign : ''}`,
          severity: 'red',
          reason: `Matched to SOP tanker "${sopT.callsign}".`,
        });
      }
    }
  }
  return out;
}

function checkSupport(groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  const out: DiscrepancyRow[] = [];
  const support = sop.supportAssets ?? [];
  if (support.length === 0) return [];

  // For each SOP support asset, look for a mission group whose task or
  // callsign matches.
  for (const asset of support) {
    const role = (asset.role || '').toLowerCase();
    const csWord = firstWord(asset.callsign);
    const match = groups.find((g) => {
      const taskLow = (g.task || '').toLowerCase();
      const nameLow = g.groupName.toLowerCase();
      if (role && taskLow === role) return true;
      if (csWord && nameLow.includes(csWord)) return true;
      return false;
    });

    if (!match) {
      out.push({
        category: 'Support Asset',
        field: `${asset.role || '—'} ${asset.callsign}`,
        missionValue: 'Not present in mission',
        sopValue: asset.frequency ? fmtFreq(asset.frequency, asset.modulation ?? 'AM') : '—',
        severity: 'gray',
        reason: 'SOP defines this asset but no matching group is in the mission.',
      });
      continue;
    }

    if (asset.frequency) {
      const mz = freqMhz(match.frequency);
      if (!freqsMatch(mz, asset.frequency)) {
        out.push({
          category: 'Support Freq',
          field: `${asset.callsign} (${match.groupName})`,
          missionValue: fmtFreq(mz, modString(match.modulation)),
          sopValue: fmtFreq(asset.frequency, asset.modulation ?? 'AM'),
          severity: 'red',
        });
      }
    }
  }
  return out;
}

/** Find the SOP TACAN entry whose role best describes a carrier group. */
function matchCarrierTacan(g: MissionGroup, sop: SOP): SopTacanEntry | null {
  if (!sop.tacans || sop.tacans.length === 0) return null;
  const callsign = (g.tacan?.callsign || '').toLowerCase();
  const hullType = (g.units[0]?.type || '').toUpperCase();

  for (const t of sop.tacans) {
    const role = (t.role || '').toLowerCase();
    if (!role) continue;
    if (callsign && role.includes(callsign)) return t;
    if (hullType && role.toUpperCase().includes(hullType)) return t;
    if (/\b(cvn|carrier|home\s*plate|ship)\b/i.test(role)) return t;
  }
  return null;
}

function checkCarriers(groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  const out: DiscrepancyRow[] = [];
  const carriers = groups.filter(isCarrierGroup);
  for (const g of carriers) {
    const sopT = matchCarrierTacan(g, sop);
    if (!sopT) continue; // SOP doesn't speak about this carrier

    const ch = g.tacan?.channel ?? null;
    const band = g.tacan?.band ?? null;
    if (ch !== sopT.channel || band !== sopT.band) {
      out.push({
        category: 'Carrier TACAN',
        field: g.groupName,
        missionValue: ch ? `${ch}${band ?? '?'}${g.tacan?.callsign ? ' ' + g.tacan.callsign : ''}` : 'Not set',
        sopValue: `${sopT.channel}${sopT.band}${sopT.callsign ? ' ' + sopT.callsign : ''}`,
        severity: 'red',
        reason: `Matched to SOP TACAN entry "${sopT.role}".`,
      });
    }
  }
  return out;
}

function checkDatalinkOrder(groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  // This is a soft check — the auto-assign uses SOP order to pick
  // datalink IDs, so any mismatch here likely means the user hasn't
  // run Auto Assign yet. Marked yellow / informational.
  const out: DiscrepancyRow[] = [];
  if (sop.flights.length === 0) return out;

  const playerFlights = groups.filter((g) =>
    isPlayerGroup(g) && (g.category === 'plane' || g.category === 'helicopter'),
  );

  const sopWords = new Set(sop.flights.map((f) => firstWord(f.callsign)));
  const offSop = playerFlights.filter((g) => !sopWords.has(firstWord(g.groupName)));
  if (offSop.length > 0) {
    out.push({
      category: 'Datalink Roster',
      field: 'Player flights vs SOP roster',
      missionValue: `${offSop.length} flight${offSop.length !== 1 ? 's' : ''} off-SOP`,
      sopValue: `${sopWords.size} callsigns in SOP`,
      severity: 'yellow',
      reason: `Off-SOP flights: ${offSop.map((g) => g.groupName).join(', ')}. Datalink auto-assign will fall back to defaults for these.`,
    });
  }
  return out;
}

function checkLaserCodes(_groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  // We don't have per-unit laser codes on MissionGroup — those live
  // in unit pylon weapon settings, which the frontend reads as
  // pylonOptions / unit edits. For v1 we just inform the user about
  // the SOP base value so they can verify in the Laser tab. v2 will
  // pull actual unit laser codes via the donor data structure.
  if (sop.laserCodeBase == null) return [];
  return [{
    category: 'Laser Codes',
    field: 'Base value',
    missionValue: 'Check Laser tab',
    sopValue: String(sop.laserCodeBase),
    severity: 'gray',
    reason: `SOP defines laser code base ${sop.laserCodeBase}. Per-unit codes are validated separately in v2.`,
  }];
}

function buildReport(groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  return [
    ...checkPlayerFlightFreqs(groups, sop),
    ...checkGuardFreq(groups, sop),
    ...checkTankers(groups, sop),
    ...checkSupport(groups, sop),
    ...checkCarriers(groups, sop),
    ...checkDatalinkOrder(groups, sop),
    ...checkLaserCodes(groups, sop),
  ];
}

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */

function severityChip(sev: Severity): React.CSSProperties {
  const palette: Record<Severity, { bg: string; border: string; fg: string }> = {
    red: { bg: '#3a1a1a', border: '#5a2a2a', fg: '#d95050' },
    yellow: { bg: '#3a2e1a', border: '#5a4a2a', fg: '#d29922' },
    gray: { bg: '#1a1a1a', border: '#3a3a3a', fg: '#888' },
  };
  const c = palette[sev];
  return {
    padding: '2px 8px',
    borderRadius: 4,
    background: c.bg,
    border: `1px solid ${c.border}`,
    color: c.fg,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flexShrink: 0,
  };
}

const severityLabel: Record<Severity, string> = {
  red: 'Issue',
  yellow: 'Warn',
  gray: 'Info',
};

export function SopCheckTab() {
  const groups = useMissionStore((s) => s.groups);
  const sops = useSopStore((s) => s.sops);
  const activeSopId = useSopStore((s) => s.activeId);
  const activeSop = useMemo(
    () => (activeSopId ? sops.find((s) => s.id === activeSopId) ?? null : null),
    [activeSopId, sops],
  );

  const rows = useMemo(() => {
    if (!activeSop) return [];
    return buildReport(groups, activeSop);
  }, [groups, activeSop]);

  // Group rows by category for visual scanning. JS Map preserves insert
  // order so the report sections come out in checkPlayerFlightFreqs →
  // checkLaserCodes order.
  const byCategory = useMemo(() => {
    const m = new Map<string, DiscrepancyRow[]>();
    for (const r of rows) {
      if (!m.has(r.category)) m.set(r.category, []);
      m.get(r.category)!.push(r);
    }
    return m;
  }, [rows]);

  const counts = useMemo(() => {
    const c = { red: 0, yellow: 0, gray: 0 };
    for (const r of rows) c[r.severity]++;
    return c;
  }, [rows]);

  if (!activeSop) {
    return (
      <div style={{ color: '#aaaaaa', fontSize: 14, padding: 24, maxWidth: 600 }}>
        <h2 style={{ color: '#e0e0e0', fontSize: 18, margin: '0 0 12px', fontWeight: 600 }}>
          SOP Check
        </h2>
        <p>
          Activate a SOP on the SOP tab first. This panel reports where the loaded
          mission disagrees with the active SOP — flight frequencies, tanker
          TACANs, carrier channels, and so on.
        </p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div style={{ color: '#aaaaaa', fontSize: 14, padding: 24 }}>
        Load a mission to compare against SOP "{activeSop.name}".
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, padding: '0 4px' }}>
      <h2 style={{ color: '#e0e0e0', fontSize: 18, margin: '0 0 10px', fontWeight: 600 }}>
        SOP Check
      </h2>

      {/* Active-SOP banner — green accent strip with the SOP name in
          large readable text, the squadron underneath if defined. The
          point of this tab is to compare against this SOP, so making
          which one is active visible at a glance matters. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '10px 14px',
          marginBottom: 14,
          background: '#0d2818',
          border: '1px solid #2a5a2a',
          borderLeft: '4px solid #3fb950',
          borderRadius: 6,
        }}
      >
        <span
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            background: '#1a3a1a',
            border: '1px solid #2a5a2a',
            color: '#3fb950',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 1,
            flexShrink: 0,
          }}
        >
          SOP ACTIVE
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: '#e0e0e0',
              fontSize: 16,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {activeSop.name}
          </div>
          {activeSop.squadron && (
            <div style={{ color: '#888', fontSize: 12, marginTop: 1 }}>
              {activeSop.squadron}
            </div>
          )}
        </div>
        <div style={{ color: '#5a8a6a', fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>
          {activeSop.flights?.length ?? 0} flights · {activeSop.comms?.length ?? 0} comms · {activeSop.tankers?.length ?? 0} tankers
        </div>
      </div>

      <p style={{ color: '#888', fontSize: 12, margin: '0 0 14px', maxWidth: 720 }}>
        Read-only report. Compares the loaded mission against the active SOP and
        flags differences. Apply-on-click is coming in the next release; for now
        the matching tabs (Radio, Datalink, Carriers, DTC, Renamer) carry the
        write-back buttons.
      </p>

      {/* Summary strip */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 16,
          padding: '8px 12px',
          background: '#0a1218',
          border: '1px solid #222',
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        <SummaryChip label="Issues" count={counts.red} color="#d95050" />
        <SummaryChip label="Warnings" count={counts.yellow} color="#d29922" />
        <SummaryChip label="Info" count={counts.gray} color="#888" />
        <span style={{ marginLeft: 'auto', color: '#888' }}>
          {rows.length === 0 ? 'No discrepancies — mission matches SOP.' :
            `${rows.length} row${rows.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Sections */}
      {rows.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            color: '#3fb950',
            background: '#0a1218',
            border: '1px solid #1a3a1a',
            borderRadius: 6,
          }}
        >
          ✓ Mission is consistent with SOP "{activeSop.name}". No discrepancies found.
        </div>
      ) : (
        Array.from(byCategory.entries()).map(([cat, catRows]) => (
          <div key={cat} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#5a8a6a',
                textTransform: 'uppercase',
                letterSpacing: 1,
                marginBottom: 6,
              }}
            >
              {cat} ({catRows.length})
            </div>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
                color: '#e0e0e0',
                background: '#1a1a1a',
                border: '1px solid #3a3a3a',
                borderRadius: 4,
              }}
            >
              <thead>
                <tr style={{ background: '#222', color: '#aaaaaa' }}>
                  <th style={thStyle}>Field</th>
                  <th style={thStyle}>Mission has</th>
                  <th style={thStyle}>SOP says</th>
                  <th style={{ ...thStyle, width: 70, textAlign: 'center' }}>Severity</th>
                </tr>
              </thead>
              <tbody>
                {catRows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #2a2a2a' }}>
                    <td style={tdStyle}>
                      <div style={{ color: '#cccccc', fontWeight: 600 }}>{r.field}</div>
                      {r.reason && (
                        <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>{r.reason}</div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", color: '#e0e0e0' }}>
                      {r.missionValue}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", color: '#3fb950' }}>
                      {r.sopValue}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <span style={severityChip(r.severity)}>{severityLabel[r.severity]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}

function SummaryChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#aaaaaa' }}>
      <span style={{ color, fontWeight: 700, fontSize: 14 }}>{count}</span>
      {label}
    </span>
  );
}

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 12,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  verticalAlign: 'top',
};
