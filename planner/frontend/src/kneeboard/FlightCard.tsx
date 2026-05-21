/**
 * Flight Card — per-flight kneeboard card.
 * Shows callsigns, loadout summary, fuel/flare/chaff, datalink donors+team.
 */

import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, BORDER, TEXT, DIM, ACCENT, ROW_ALT, WARN, footerStyle, notesBox, MissionDateLine } from './cardStyles';
import type { MissionGroup, ClientUnit, MissionOverviewData } from '../types/mission';
import { getAircraftType } from '../utils/groups';

interface FlightCardProps {
  group: MissionGroup;
  clientUnits: ClientUnit[];
  overview?: MissionOverviewData;
  /** When set, highlight this pilot's row in the crew roster. */
  highlightUnitId?: number;
  /** Planner-typed notes rendered inside the NOTES box. (v0.9.70) */
  notes?: string;
}

export function FlightCard({ group, clientUnits, overview, highlightUnitId, notes }: FlightCardProps) {
  const airframe = getAircraftType(group);
  const flightUnits = clientUnits.filter((cu) => cu.groupName === group.groupName);

  // Aggregate loadout across all pylons for first unit (representative)
  const rep = flightUnits[0];
  const weaponSummary = rep
    ? Object.values(
        rep.pylons.reduce((acc, p) => {
          const key = p.shortName || p.name;
          if (!acc[key]) acc[key] = { name: key, count: 0, cat: p.category };
          acc[key].count += 1;
          return acc;
        }, {} as Record<string, { name: string; count: number; cat: string }>),
      )
    : [];

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>FLIGHT CARD — {group.groupName.toUpperCase()}</div>
        <div style={subtitleStyle}>
          {airframe} | {flightUnits.length} aircraft | {group.task || 'N/A'} | {group.frequency.toFixed(3)} MHz {group.modulation === 0 ? 'AM' : 'FM'}
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Flight-level NAV/COMMS data — TACAN + ICLS pulled from the .miz,
          IFF Mode codes left as edit placeholders (DCS doesn't expose IFF
          settings in the mission Lua; pilots set them in cockpit per SOP). */}
      <div style={sectionTitle}>FLIGHT DATA</div>
      <div style={{
        display: 'flex', gap: 0, flexShrink: 0,
        borderBottom: `1px solid ${BORDER}`,
      }}>
        {(() => {
          const tacanStr = group.tacan
            ? `${group.tacan.channel}${group.tacan.band}` + (group.tacan.callsign ? ` (${group.tacan.callsign})` : '')
            : '—';
          const iclsStr = group.icls?.channel ? String(group.icls.channel) : '—';
          const items = [
            { label: 'TACAN',     value: tacanStr,    color: group.tacan ? TEXT : DIM },
            { label: 'ICLS',      value: iclsStr,     color: group.icls ? TEXT : DIM },
            { label: 'IFF M1',    value: '— EDIT —',  color: DIM },
            { label: 'IFF M3',    value: '— EDIT —',  color: DIM },
          ];
          return items.map(({ label, value, color }) => (
            <div key={label} style={{
              flex: 1, padding: '4px 6px',
              borderRight: `1px solid ${BORDER}`, textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, color: DIM, fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 16, color, fontWeight: 600 }}>{value}</div>
            </div>
          ));
        })()}
      </div>

      {/* Crew roster */}
      <div style={sectionTitle}>CREW</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 30 }}>#</th>
            <th style={{ ...th, textAlign: 'left', width: 120 }}>CALLSIGN</th>
            <th style={{ ...th, width: 70 }}>STN L16</th>
            <th style={{ ...th, width: 60 }}>LASER</th>
            <th style={{ ...th, textAlign: 'left' }}>UNIT NAME</th>
          </tr>
        </thead>
        <tbody>
          {flightUnits.map((cu, i) => {
            const isHighlighted = highlightUnitId === cu.unitId;
            return (
            <tr key={cu.unitId} style={{
              background: isHighlighted ? 'rgba(74, 143, 212, 0.15)' : i % 2 === 0 ? 'transparent' : ROW_ALT,
              borderLeft: isHighlighted ? '3px solid #4a8fd4' : '3px solid transparent',
            }}>
              <td style={{ ...cell, textAlign: 'center', color: ACCENT, fontWeight: 600 }}>{i + 1}</td>
              <td style={{ ...cell, fontWeight: 600 }}>
                {cu.voiceCallsignLabel} {cu.voiceCallsignNumber}
              </td>
              <td style={{ ...cell, textAlign: 'center', color: DIM }}>{cu.stnL16 || '—'}</td>
              <td style={{ ...cell, textAlign: 'center', color: cu.laserCode ? WARN : DIM }}>
                {cu.laserCode || '—'}
              </td>
              <td style={{ ...cell, fontSize: 17, color: isHighlighted ? '#ccdae8' : DIM }}>{cu.name}</td>
            </tr>
            );
          })}
        </tbody>
      </table>

      {/* Stores summary */}
      {rep && (
        <>
          <div style={sectionTitle}>STORES</div>
          <div style={{ padding: '4px 16px', display: 'flex', gap: 24, flexWrap: 'wrap', borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 17 }}>
              <span style={{ color: DIM }}>FUEL </span>
              <span style={{ color: TEXT, fontWeight: 600 }}>{rep.fuel.toLocaleString()} lbs</span>
            </div>
            <div style={{ fontSize: 17 }}>
              <span style={{ color: DIM }}>FL </span>
              <span style={{ color: TEXT }}>{rep.flare}</span>
            </div>
            <div style={{ fontSize: 17 }}>
              <span style={{ color: DIM }}>CH </span>
              <span style={{ color: TEXT }}>{rep.chaff}</span>
            </div>
            <div style={{ fontSize: 17 }}>
              <span style={{ color: DIM }}>GUN </span>
              <span style={{ color: TEXT }}>{rep.gun}</span>
            </div>
          </div>

          {/* Loadout */}
          <div style={sectionTitle}>LOADOUT</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 40 }}>STN</th>
                <th style={{ ...th, textAlign: 'left' }}>WEAPON</th>
                <th style={{ ...th, width: 80 }}>CATEGORY</th>
              </tr>
            </thead>
            <tbody>
              {rep.pylons
                .filter((p) => p.name)
                .map((p, i) => (
                  <tr key={p.number} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                    <td style={{ ...cell, textAlign: 'center', color: ACCENT }}>{p.number}</td>
                    <td style={cell}>{p.shortName || p.name}</td>
                    <td style={{ ...cell, textAlign: 'center', color: DIM }}>{p.category}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          {/* Weapon totals */}
          {weaponSummary.length > 0 && (
            <div style={{ padding: '4px 16px', fontSize: 17, color: DIM, borderBottom: `1px solid ${BORDER}` }}>
              {weaponSummary.map((w) => `${w.count}x ${w.name}`).join(' | ')}
            </div>
          )}
        </>
      )}

      {/* Datalink */}
      {rep && rep.hasDatalinks && (
        <>
          <div style={sectionTitle}>DATALINK</div>
          <div style={{ padding: '4px 16px', fontSize: 17 }}>
            {rep.donors.length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: DIM }}>DONORS: </span>
                {rep.donors.map((d) => d.name).join(', ')}
              </div>
            )}
            {rep.teamMembers.length > 0 && (
              <div>
                <span style={{ color: DIM }}>TEAM: </span>
                {rep.teamMembers.map((t) => t.name).join(', ')}
              </div>
            )}
          </div>
        </>
      )}

      {/* TOLD — Takeoff & Landing Data */}
      {rep && (
        <>
          <div style={sectionTitle}>TOLD</div>
          <div style={{ display: 'flex', gap: 0, flexShrink: 0, borderBottom: `1px solid ${BORDER}` }}>
            {(() => {
              const fuel = rep.fuel || 0;
              const storesEst = 2000;
              const emptyWt = 25640;
              const grossWt = emptyWt + fuel + storesEst;
              const joker = Math.round(fuel * 0.35);
              const bingo = Math.round(fuel * 0.20);
              const items = [
                { label: 'GROSS WT', value: `${Math.round(grossWt).toLocaleString()} lbs`, color: TEXT },
                { label: 'T/O FUEL', value: `${Math.round(fuel).toLocaleString()} lbs`, color: TEXT },
                { label: 'JOKER', value: `${joker.toLocaleString()} lbs`, color: WARN },
                { label: 'BINGO', value: `${bingo.toLocaleString()} lbs`, color: '#d95050' },
              ];
              return items.map(({ label, value, color }) => (
                <div key={label} style={{
                  flex: 1,
                  padding: '4px 6px',
                  borderRight: `1px solid ${BORDER}`,
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 11, color: DIM, fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: 17, color, fontWeight: 700 }}>{value}</div>
                </div>
              ));
            })()}
          </div>
        </>
      )}

      {/* Notes */}
      <div style={{ padding: '6px 0 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 17, color: DIM, marginBottom: 2, fontWeight: 600 }}>NOTES</div>
        <div style={notesBox}>
          {notes && notes.trim() && (
            <div style={{
              fontSize: 17, color: TEXT,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.35,
            }}>
              {notes.trim()}
            </div>
          )}
        </div>
      </div>

      <div style={footerStyle}>Generated by DCS Mission Planner | VMFA-224(AW)</div>
    </div>
  );
}
