/**
 * Mission Goals Card — shared (mission-wide) kneeboard card.
 *
 * Pilots get a printable cockpit reference of the squadron's mission
 * objectives, grouped by side (BLUE / RED / NEUTRAL / ALL) so a flight
 * lead can sanity-check what they're trying to accomplish on the way to
 * the merge. Mirrors the GoalsTab editor and pulls from the same store
 * (useGoalsStore), so what you see in the editor is what prints.
 *
 * Layout (600x850 fixed):
 *  - Header: GOALS title + squadron/theater/date
 *  - Summary strip: total goal count + total points sum
 *  - One section per side that has goals (BLUE / RED / NEUTRAL / ALL).
 *    Empty sides are omitted entirely so a single-coalition mission
 *    doesn't show three blank tables.
 *  - Each row: ordinal | objective text | points
 *
 * Overflow strategy: per-side table caps at MAX_ROWS_PER_SIDE so a
 * mission with 30 BLUE goals doesn't blow the bottom of the card.
 * Excess rows show a "+N more" hint at the bottom of that side's
 * table — matches the SopCommsCard pattern. v1 keeps it to a single
 * 600x850 card; if users hit the cap regularly we can paginate.
 */

import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle,
  cell, th, BORDER_MED, TEXT, DIM, ACCENT, ROW_ALT, footerStyle,
  MissionDateLine,
} from './cardStyles';
import type { MissionGoal, GoalSide } from '../store/goalsStore';
import type { MissionOverviewData } from '../types/mission';

interface GoalsCardProps {
  goals: MissionGoal[];
  /** Squadron / SOP name shown in the header subtitle.  Optional —
   *  falls back to a plain "MISSION GOALS" header when unknown. */
  squadron?: string;
  overview?: MissionOverviewData;
}

const MAX_ROWS_PER_SIDE = 8;

// Side metadata in the order we render. ALL is last because it
// represents cross-coalition objectives (e.g. "all aircraft RTB by
// 1900Z") and reads more naturally as a footer-like section.
const SIDE_ORDER: GoalSide[] = ['blue', 'red', 'neutral', 'all'];

const SIDE_LABEL: Record<GoalSide, string> = {
  blue: 'BLUE OBJECTIVES',
  red: 'RED OBJECTIVES',
  neutral: 'NEUTRAL OBJECTIVES',
  all: 'ALL SIDES',
};

const SIDE_COLOR: Record<GoalSide, string> = {
  blue: '#4a8fd4',
  red: '#d95050',
  neutral: '#aaaaaa',
  all: '#3fb950',
};

function fmtPoints(n: number): string {
  if (!n) return '—';
  return String(n);
}

export function GoalsCard({ goals, squadron, overview }: GoalsCardProps) {
  const total = goals.length;
  const totalPoints = goals.reduce((s, g) => s + (g.points || 0), 0);

  // Group by side. Filter out empty-text rows because the editor
  // can carry blank placeholders that the user hasn't filled in yet.
  const bySide: Record<GoalSide, MissionGoal[]> = {
    blue: [],
    red: [],
    neutral: [],
    all: [],
  };
  for (const g of goals) {
    if (!g.text.trim()) continue;
    bySide[g.side].push(g);
  }

  const populatedSides = SIDE_ORDER.filter((s) => bySide[s].length > 0);

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>MISSION GOALS</div>
        {squadron && (
          <div style={subtitleStyle}>{squadron}</div>
        )}
        {overview && (
          <MissionDateLine
            date={overview.date}
            startTime={overview.start_time}
            theater={overview.theater}
            showTheater
          />
        )}
      </div>

      {/* Summary strip — total goal count + total points. Mirrors the
          editor's totals strip so pilots and planners are reading the
          same number. */}
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
          <div style={{ fontSize: 13, color: DIM, fontWeight: 600, letterSpacing: 0.5 }}>GOALS</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: ACCENT, fontFamily: 'monospace' }}>
            {total > 0 ? total : '—'}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            border: `1px solid ${BORDER_MED}`,
            background: 'var(--kb-surface, #222)',
            padding: '6px 10px',
          }}
        >
          <div style={{ fontSize: 13, color: DIM, fontWeight: 600, letterSpacing: 0.5 }}>TOTAL POINTS</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: ACCENT, fontFamily: 'monospace' }}>
            {totalPoints > 0 ? totalPoints : '—'}
          </div>
        </div>
      </div>

      {/* No goals defined — surface a placeholder so the card doesn't
          look broken. The user explicitly checked the box, so a blank
          page would be confusing. */}
      {populatedSides.length === 0 ? (
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
          No mission goals defined. Add objectives in the Goals tab.
        </div>
      ) : (
        populatedSides.map((side) => {
          const list = bySide[side];
          const shown = list.slice(0, MAX_ROWS_PER_SIDE);
          const extra = Math.max(0, list.length - MAX_ROWS_PER_SIDE);
          const accent = SIDE_COLOR[side];

          return (
            <div key={side} style={{ marginBottom: 6, flexShrink: 0 }}>
              {/* Per-side title gets the side's accent color so a quick
                  glance separates BLUE from RED on a multi-side mission. */}
              <div style={{ ...sectionTitle, color: accent }}>
                {SIDE_LABEL[side]} ({list.length})
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 4 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 36 }}>#</th>
                    <th style={{ ...th, textAlign: 'left' }}>OBJECTIVE</th>
                    <th style={{ ...th, width: 70 }}>PTS</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((g, i) => (
                    <tr key={g.id} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                      <td style={{ ...cell, textAlign: 'center', color: accent, fontWeight: 700 }}>
                        {i + 1}
                      </td>
                      <td
                        style={{
                          ...cell,
                          color: TEXT,
                          // Allow the objective to wrap so longish text
                          // ("Destroy SA-11 site at bullseye 035/22")
                          // doesn't clip. The card height is fixed but
                          // that's okay — overflow:hidden on cardRoot
                          // handles the bottom edge gracefully.
                          whiteSpace: 'normal',
                          fontWeight: 500,
                        }}
                      >
                        {g.text}
                      </td>
                      <td style={{ ...cell, textAlign: 'center', fontFamily: 'monospace' }}>
                        {fmtPoints(g.points)}
                      </td>
                    </tr>
                  ))}
                  {extra > 0 && (
                    <tr>
                      <td colSpan={3} style={{ ...cell, color: DIM, fontStyle: 'italic', textAlign: 'center' }}>
                        +{extra} more in goals list
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })
      )}

      <div style={footerStyle}>
        Goals Card | Generated by DCS Mission Planner
      </div>
    </div>
  );
}
