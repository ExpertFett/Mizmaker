/**
 * Support Assets Card — shared mission-wide kneeboard card.
 * Shows tankers, AWACS, and other support groups with frequencies and positions.
 */

import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, BORDER_MED, TEXT, DIM, ACCENT, ROW_ALT, footerStyle, notesBox, MissionDateLine } from './cardStyles';
import type { MissionGroup, MissionOverviewData, RadioPresetRadio } from '../types/mission';
import { presetLabel } from './radioPresets';
import { metersToFeet, msToKnots } from '../utils/conversions';

interface SupportAssetsCardProps {
  groups: MissionGroup[];
  coalition: string;
  overview?: MissionOverviewData;
  /** 0-based page index. Lets callers render multi-card sets when the
   *  asset list overflows one card. Use supportAssetsPageCount() to
   *  decide how many cards to emit. Default 0 = first/only page. */
  page?: number;
  /** Planner-typed notes rendered inside the NOTES box. (v0.9.70) */
  notes?: string;
  /** Jet's programmed radio presets, used to tag each frequency with the
   *  channel it sits on. Omitted → frequencies print bare. */
  presets?: RadioPresetRadio[];
}

/** Maximum 'OTHER AIR ASSETS' rows on one card before pagination kicks
 *  in. Tankers + AWACS always stay on page 1; only the bulk 'other'
 *  list paginates. Tuned so the card body fits within H=850. */
const OTHER_PAGE_SIZE = 7;

/** Compute how many cards a given props set would emit. ExportPanel
 *  calls this to know how many filenames to write. */
export function supportAssetsPageCount(props: Pick<SupportAssetsCardProps, 'groups' | 'coalition'>): number {
  const cg = props.groups.filter((g) => g.coalition === props.coalition);
  const others = cg.filter((g) => {
    const task = (g.task || '').toLowerCase();
    return (g.category === 'plane' || g.category === 'helicopter') &&
      task !== 'refueling' && task !== 'awacs' &&
      !g.units.some((u) => u.skill === 'Client' || u.skill === 'Player');
  });
  // Page 1 always exists (tankers + awacs + first OTHER_PAGE_SIZE other).
  // Subsequent pages each carry OTHER_PAGE_SIZE more "other" rows.
  if (others.length <= OTHER_PAGE_SIZE) return 1;
  return 1 + Math.ceil((others.length - OTHER_PAGE_SIZE) / OTHER_PAGE_SIZE);
}

function formatFreq(freq: number, mod: number): string {
  return `${freq.toFixed(3)} ${mod === 0 ? 'AM' : 'FM'}`;
}

function formatAlt(wp: { altitude_m: number }): string {
  const ft = Math.round(metersToFeet(wp.altitude_m));
  if (ft <= 0) return 'SFC';
  return `${ft.toLocaleString()} ft`;
}

function formatSpeed(wp: { speed_ms: number }): string {
  return `${Math.round(msToKnots(wp.speed_ms))} kts`;
}

export function SupportAssetsCard({ groups, coalition, overview, page = 0, notes, presets }: SupportAssetsCardProps) {
  const coalitionGroups = groups.filter((g) => g.coalition === coalition);
  const tankers = coalitionGroups.filter((g) => (g.task || '').toLowerCase() === 'refueling');
  const awacsGroups = coalitionGroups.filter((g) => (g.task || '').toLowerCase() === 'awacs');

  // Other support — non-player planes/helos that aren't tanker/AWACS
  const otherSupport = coalitionGroups.filter((g) => {
    const task = (g.task || '').toLowerCase();
    return (g.category === 'plane' || g.category === 'helicopter') &&
      task !== 'refueling' && task !== 'awacs' &&
      !g.units.some((u) => u.skill === 'Client' || u.skill === 'Player');
  });

  // Page slicing: page 0 carries tankers+AWACS+first OTHER_PAGE_SIZE
  // "other" rows; pages 1+ carry only continuation "other" rows.
  const isFirstPage = page === 0;
  const pageStart = isFirstPage ? 0 : OTHER_PAGE_SIZE + (page - 1) * OTHER_PAGE_SIZE;
  const pageEnd = pageStart + OTHER_PAGE_SIZE;
  const otherSlice = otherSupport.slice(pageStart, pageEnd);
  const totalPages = Math.max(1,
    otherSupport.length <= OTHER_PAGE_SIZE
      ? 1
      : 1 + Math.ceil((otherSupport.length - OTHER_PAGE_SIZE) / OTHER_PAGE_SIZE));

  const preset = (f: number) => presetLabel(f, presets);

  // tableLayout:'fixed' — adding the TACAN column let long callsigns push the
  // table 34px past the card edge under auto layout.
  const renderAssetTable = (assets: MissionGroup[], _role: string) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: 'left' }}>CALLSIGN</th>
          <th style={{ ...th, width: 72 }}>TYPE</th>
          <th style={{ ...th, width: 118 }}>FREQ</th>
          <th style={{ ...th, width: 78 }}>TACAN</th>
          <th style={{ ...th, width: 62 }}>ALT</th>
          <th style={{ ...th, width: 54 }}>SPD</th>
        </tr>
      </thead>
      <tbody>
        {assets.map((g, i) => {
          const orbitWp = g.waypoints.find((wp) => wp.waypoint_number > 0) || g.waypoints[0];
          const acType = g.units[0]?.type || '—';
          const shortType = acType.replace(/[_-]/g, ' ').split(' ').slice(0, 2).join(' ');
          return (
            <tr key={g.groupId} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
              <td style={{ ...cell, fontWeight: 600, overflow: 'hidden',
                           textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.groupName}</td>
              <td style={{ ...cell, color: DIM, textAlign: 'center' }}>{shortType}</td>
              <td style={{ ...cell, textAlign: 'center', color: ACCENT }}>
                {formatFreq(g.frequency, g.modulation)}
                {preset(g.frequency) && (
                  <span style={{ color: TEXT, marginLeft: 4 }}>{preset(g.frequency)}</span>
                )}
              </td>
              {/* Tankers carry a TACAN; a card that lists a basket without its
                  channel makes the pilot go hunting for the join-up. Already
                  parsed off the group's ActivateBeacon task. */}
              <td style={{ ...cell, textAlign: 'center', color: g.tacan ? ACCENT : DIM }}>
                {g.tacan ? `${g.tacan.channel}${g.tacan.band}` : '—'}
              </td>
              <td style={{ ...cell, textAlign: 'right' }}>{orbitWp ? formatAlt(orbitWp) : '—'}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{orbitWp ? formatSpeed(orbitWp) : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div style={{ ...cardRoot, position: 'relative' }}>
      <div style={headerStyle}>
        <div style={titleStyle}>
          SUPPORT ASSETS{totalPages > 1 ? ` (${page + 1}/${totalPages})` : ''}
        </div>
        <div style={subtitleStyle}>
          {coalition.toUpperCase()} coalition | {tankers.length} tanker{tankers.length !== 1 ? 's' : ''} | {awacsGroups.length} AWACS
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Tankers — first page only */}
      {isFirstPage && tankers.length > 0 && (
        <>
          <div style={sectionTitle}>TANKERS</div>
          {renderAssetTable(tankers, 'TANKER')}
          {tankers.some((t) => t.tacan?.callsign) && (
            <div style={{ fontSize: 13, color: DIM, padding: '2px 0 0' }}>
              TACAN ident: {tankers.filter((t) => t.tacan?.callsign)
                .map((t) => `${t.groupName} ${t.tacan!.channel}${t.tacan!.band}/${t.tacan!.callsign}`)
                .join(' · ')}
            </div>
          )}
        </>
      )}

      {/* AWACS — first page only */}
      {isFirstPage && awacsGroups.length > 0 && (
        <>
          <div style={sectionTitle}>AWACS</div>
          {renderAssetTable(awacsGroups, 'AWACS')}
        </>
      )}

      {/* Other support — paginated */}
      {otherSlice.length > 0 && (
        <>
          <div style={sectionTitle}>
            {isFirstPage ? 'OTHER AIR ASSETS' : "OTHER AIR ASSETS — CONT'D"}
          </div>
          {renderAssetTable(otherSlice, 'SUPPORT')}
        </>
      )}

      {isFirstPage && tankers.length === 0 && awacsGroups.length === 0 && otherSupport.length === 0 && (
        <div style={{ padding: '20px 16px', fontSize: 17, color: DIM, textAlign: 'center' }}>
          No support assets found for this coalition.
        </div>
      )}

      {/* Notes */}
      <div style={{ ...sectionTitle, marginTop: 8 }}>NOTES</div>
      <div style={notesBox}>
        {notes && notes.trim() ? (
          <div style={{
            fontSize: 17, color: TEXT,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.35,
          }}>
            {notes.trim()}
          </div>
        ) : (
          /* Three write-on lines, not six. With all three asset tables on the
             first page there is only room for three: the other three rendered
             past the bottom edge of the 850px card and were silently clipped,
             overflowing the card by 63px. */
          [...Array(3)].map((_, i) => (
            <div key={i} style={{ borderBottom: `1px solid ${BORDER_MED}`, height: 22, marginBottom: 2 }} />
          ))
        )}
      </div>

      <div style={footerStyle}>Generated by DCS:OPT | VMFA-224(AW)</div>
    </div>
  );
}
