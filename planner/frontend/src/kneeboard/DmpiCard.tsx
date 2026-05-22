/**
 * DMPI Card — shared (mission-wide) kneeboard card.
 *
 * Mirrors GoalsCard for DMPIs: a compact in-cockpit reference of the
 * DMPI list pilots have in their plan. Pulls from useDmpiStore so
 * what shows on the card matches what's in the editor.
 *
 * Layout (600x850 fixed):
 *  - Header: DMPIs title + squadron/theater/date
 *  - Summary strip: total DMPI count
 *  - Table: # / NAME / COORDS / ELEV / WEAPON
 *  - Footer
 *
 * Overflow: caps at MAX_ROWS so a mission with 30 DMPIs doesn't blow
 * the bottom of the card. Excess rows show "+N more" — same pattern
 * as GoalsCard / SopCommsCard.
 */

import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle,
  cell, th, BORDER_MED, TEXT, DIM, ACCENT, ROW_ALT, footerStyle,
  MissionDateLine,
} from './cardStyles';
import type { Dmpi } from '../store/dmpiStore';
import type { MissionOverviewData } from '../types/mission';
import { metersToFeet } from '../utils/conversions';
import { formatCoord, type CoordFormat } from './coords';

interface DmpiCardProps {
  dmpis: Dmpi[];
  squadron?: string;
  overview?: MissionOverviewData;
  /** Coordinate display format from the Kneeboard tab. (v0.9.76) */
  coordFormat?: CoordFormat;
}

const MAX_ROWS = 12;

function fmtElev(meters: number): string {
  if (!meters) return '—';
  return `${Math.round(metersToFeet(meters)).toLocaleString()} ft`;
}

export function DmpiCard({ dmpis, squadron, overview, coordFormat = 'mgrs' }: DmpiCardProps) {
  // Drop placeholder rows (blank name OR coordinates still 0/0).
  // Same filter the brief-token formatter uses, so the card and the
  // brief stay in lockstep.
  const valid = dmpis.filter(
    (d) => d.name.trim().length > 0 && (d.lat !== 0 || d.lon !== 0),
  );
  const shown = valid.slice(0, MAX_ROWS);
  const extra = Math.max(0, valid.length - MAX_ROWS);

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>DMPI LIST</div>
        {squadron && <div style={subtitleStyle}>{squadron}</div>}
        {overview && (
          <MissionDateLine
            date={overview.date}
            startTime={overview.start_time}
            theater={overview.theater}
            showTheater
          />
        )}
      </div>

      {/* Summary strip */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 10,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            border: `1px solid ${BORDER_MED}`,
            background: 'var(--kb-surface, #222)',
            padding: '6px 10px',
          }}
        >
          <div style={{ fontSize: 13, color: DIM, fontWeight: 600, letterSpacing: 0.5 }}>
            DMPIs
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: ACCENT, fontFamily: 'monospace' }}>
            {valid.length > 0 ? valid.length : '—'}
          </div>
        </div>
      </div>

      {valid.length === 0 ? (
        <div
          style={{
            ...cell,
            border: 'none',
            color: DIM,
            fontStyle: 'italic',
            textAlign: 'center',
            padding: '20px 12px',
          }}
        >
          No DMPIs defined. Add targets in the DMPI tab.
        </div>
      ) : (
        <>
          <div style={sectionTitle}>TARGETS</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 4 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 28 }}>#</th>
                <th style={{ ...th, textAlign: 'left' }}>NAME</th>
                <th style={{ ...th, textAlign: 'left' }}>COORDS</th>
                <th style={{ ...th, width: 70 }}>ELEV</th>
                <th style={{ ...th, width: 90 }}>WEAPON</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d, i) => (
                <tr key={d.id} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                  <td style={{ ...cell, textAlign: 'center', color: ACCENT, fontWeight: 700 }}>
                    {i + 1}
                  </td>
                  <td style={{ ...cell, color: TEXT, fontWeight: 500, whiteSpace: 'normal' }}>
                    {d.name}
                  </td>
                  <td style={{ ...cell, fontFamily: 'monospace', fontSize: 16, whiteSpace: 'normal' }}>
                    {formatCoord(d.lat, d.lon, coordFormat, 4)}
                  </td>
                  <td style={{ ...cell, textAlign: 'center', fontFamily: 'monospace' }}>
                    {fmtElev(d.elevation)}
                  </td>
                  <td style={{ ...cell, textAlign: 'center', whiteSpace: 'normal' }}>
                    {d.weaponDelivery || '—'}
                  </td>
                </tr>
              ))}
              {extra > 0 && (
                <tr>
                  <td colSpan={5} style={{ ...cell, color: DIM, fontStyle: 'italic', textAlign: 'center' }}>
                    +{extra} more in DMPI list
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      <div style={footerStyle}>
        DMPI Card | Generated by DCS:OPT
      </div>
    </div>
  );
}
