/**
 * SOP Comms Card — shared (mission-wide) kneeboard card synthesised
 * from the active SOP. Pilots get a printable cockpit reference that
 * matches the squadron's standard freq/TACAN/laser plan without anyone
 * retyping the SOP.
 *
 * Layout (600x850 fixed):
 *  - Header: SOP name + squadron + theater/date
 *  - Flight callsigns + their default radio
 *  - Mission comms (Strike/Marshal/Tower/etc.)
 *  - Tankers (callsign / freq / TACAN)
 *  - Support assets (AWACS / JTAC / etc.)
 *  - Footer block: GUARD freq + laser base + free-form notes excerpt
 *
 * Overflow strategy: each table caps at a fixed row count and shows a
 * "+N more" hint if the SOP has additional entries. v1 keeps it to a
 * single 600x850 card. If users hit the cap regularly we can paginate
 * (see SupportAssetsCard for the page-count pattern).
 */

import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle,
  cell, th, BORDER, BORDER_MED, TEXT, DIM, ACCENT, ROW_ALT, footerStyle,
  MissionDateLine,
} from './cardStyles';
import type { SOP } from '../sop/types';
import type { MissionOverviewData } from '../types/mission';

interface SopCommsCardProps {
  sop: SOP;
  overview?: MissionOverviewData;
}

const FLIGHT_ROW_CAP = 8;
const COMMS_ROW_CAP = 8;
const TANKER_ROW_CAP = 4;
const SUPPORT_ROW_CAP = 4;

function fmtFreq(mhz: number | undefined): string {
  if (!mhz || mhz <= 0) return '—';
  return mhz.toFixed(3);
}

function fmtMod(mod: 'AM' | 'FM' | undefined): string {
  return mod ?? 'AM';
}

function fmtTacan(ch: number | undefined, band: 'X' | 'Y' | undefined, callsign?: string): string {
  if (!ch) return '—';
  return `${ch}${band ?? 'X'}${callsign ? ' ' + callsign : ''}`;
}

export function SopCommsCard({ sop, overview }: SopCommsCardProps) {
  // Sort flights by SOP priority so the most-used callsigns sit on top
  // of the printed card. Filter out empty rows (an SOP can carry blank
  // placeholders from the editor).
  const flights = [...sop.flights]
    .filter((f) => f.callsign)
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  const flightsShown = flights.slice(0, FLIGHT_ROW_CAP);
  const flightsExtra = Math.max(0, flights.length - FLIGHT_ROW_CAP);

  // Mission comms minus guard (guard gets its own footer block so it's
  // visible at a glance, not buried in the comms table).
  const guardEntry = sop.comms.find((c) => /guard/i.test(c.role));
  const comms = sop.comms.filter((c) => !/guard/i.test(c.role));
  const commsShown = comms.slice(0, COMMS_ROW_CAP);
  const commsExtra = Math.max(0, comms.length - COMMS_ROW_CAP);

  const tankers = sop.tankers ?? [];
  const tankersShown = tankers.slice(0, TANKER_ROW_CAP);
  const tankersExtra = Math.max(0, tankers.length - TANKER_ROW_CAP);

  const support = sop.supportAssets ?? [];
  const supportShown = support.slice(0, SUPPORT_ROW_CAP);
  const supportExtra = Math.max(0, support.length - SUPPORT_ROW_CAP);

  const guardFreq = guardEntry?.frequency ?? 243.0;
  const guardMod = guardEntry?.modulation ?? 'AM';

  // Notes get clipped to ~140 chars so a long SOP doesn't blow the
  // bottom of the card. The full notes live in the brief; this is a
  // cockpit reference.
  const notes = (sop.notes || '').trim();
  const notesShort = notes.length > 140 ? notes.slice(0, 137).trimEnd() + '…' : notes;

  return (
    <div style={{ ...cardRoot, position: 'relative' }}>
      <div style={headerStyle}>
        <div style={titleStyle}>SOP COMMS</div>
        <div style={subtitleStyle}>
          {sop.name}{sop.squadron ? ` | ${sop.squadron}` : ''}
        </div>
        {overview && (
          <MissionDateLine
            date={overview.date}
            startTime={overview.start_time}
            theater={overview.theater}
            showTheater
          />
        )}
      </div>

      {/* Flight callsigns */}
      <div style={sectionTitle}>FLIGHT CALLSIGNS</div>
      {flightsShown.length === 0 ? (
        <div style={{ ...cell, border: 'none', color: DIM, fontStyle: 'italic' }}>
          No flight callsigns defined in SOP
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 4 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>CALLSIGN</th>
              <th style={{ ...th, width: 130 }}>FREQ</th>
              <th style={{ ...th, width: 60 }}>MOD</th>
            </tr>
          </thead>
          <tbody>
            {flightsShown.map((f, i) => (
              <tr key={`${f.callsign}-${i}`} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                <td style={{ ...cell, color: ACCENT, fontWeight: 600 }}>{f.callsign}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{fmtFreq(f.defaultFreq)}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{fmtMod(f.defaultMod)}</td>
              </tr>
            ))}
            {flightsExtra > 0 && (
              <tr>
                <td colSpan={3} style={{ ...cell, color: DIM, fontStyle: 'italic', textAlign: 'center' }}>
                  +{flightsExtra} more in SOP
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {/* Mission comms */}
      <div style={sectionTitle}>MISSION COMMS</div>
      {commsShown.length === 0 ? (
        <div style={{ ...cell, border: 'none', color: DIM, fontStyle: 'italic' }}>
          No mission comms defined in SOP
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 4 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>ROLE</th>
              <th style={{ ...th, width: 130 }}>FREQ</th>
              <th style={{ ...th, width: 60 }}>MOD</th>
            </tr>
          </thead>
          <tbody>
            {commsShown.map((c, i) => (
              <tr key={`${c.role}-${i}`} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                <td style={{ ...cell, color: ACCENT, fontWeight: 600 }}>{c.role}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{fmtFreq(c.frequency)}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{fmtMod(c.modulation)}</td>
              </tr>
            ))}
            {commsExtra > 0 && (
              <tr>
                <td colSpan={3} style={{ ...cell, color: DIM, fontStyle: 'italic', textAlign: 'center' }}>
                  +{commsExtra} more in SOP
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {/* Tankers — only render the section if SOP has any */}
      {tankersShown.length > 0 && (
        <>
          <div style={sectionTitle}>TANKERS</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 4 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>CALLSIGN</th>
                <th style={{ ...th, width: 110 }}>FREQ</th>
                <th style={{ ...th, width: 130 }}>TACAN</th>
              </tr>
            </thead>
            <tbody>
              {tankersShown.map((t, i) => (
                <tr key={`${t.callsign}-${i}`} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                  <td style={{ ...cell, color: ACCENT, fontWeight: 600 }}>{t.callsign}</td>
                  <td style={{ ...cell, textAlign: 'center' }}>{fmtFreq(t.frequency)}</td>
                  <td style={{ ...cell, textAlign: 'center' }}>{fmtTacan(t.tacanChannel, t.tacanBand, t.tacanCallsign)}</td>
                </tr>
              ))}
              {tankersExtra > 0 && (
                <tr>
                  <td colSpan={3} style={{ ...cell, color: DIM, fontStyle: 'italic', textAlign: 'center' }}>
                    +{tankersExtra} more in SOP
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {/* Support assets — AWACS, JTAC, FAC, etc. */}
      {supportShown.length > 0 && (
        <>
          <div style={sectionTitle}>SUPPORT</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 4 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left', width: 100 }}>ROLE</th>
                <th style={{ ...th, textAlign: 'left' }}>CALLSIGN</th>
                <th style={{ ...th, width: 110 }}>FREQ</th>
              </tr>
            </thead>
            <tbody>
              {supportShown.map((a, i) => (
                <tr key={`${a.callsign}-${i}`} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                  <td style={{ ...cell, color: ACCENT, fontWeight: 600 }}>{a.role || '—'}</td>
                  <td style={cell}>{a.callsign}</td>
                  <td style={{ ...cell, textAlign: 'center' }}>{fmtFreq(a.frequency)}</td>
                </tr>
              ))}
              {supportExtra > 0 && (
                <tr>
                  <td colSpan={3} style={{ ...cell, color: DIM, fontStyle: 'italic', textAlign: 'center' }}>
                    +{supportExtra} more in SOP
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {/* Quick-reference strip — guard + laser base side-by-side. These
          two values are the ones a pilot reaches for most often during
          a flight, so they get a dedicated chunky display. */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 6,
          marginBottom: 4,
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
          <div style={{ fontSize: 13, color: DIM, fontWeight: 600, letterSpacing: 0.5 }}>GUARD</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: ACCENT, fontFamily: 'monospace' }}>
            {fmtFreq(guardFreq)} {fmtMod(guardMod)}
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
          <div style={{ fontSize: 13, color: DIM, fontWeight: 600, letterSpacing: 0.5 }}>LASER BASE</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: ACCENT, fontFamily: 'monospace' }}>
            {sop.laserCodeBase != null ? sop.laserCodeBase : '—'}
          </div>
        </div>
      </div>

      {/* Notes excerpt — only if the SOP has any. Clipped at 140 chars
          so the card stays one page. */}
      {notesShort && (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            background: 'var(--kb-bg, #1a1a1a)',
            padding: '5px 8px',
            fontSize: 14,
            color: TEXT,
            flexShrink: 0,
            marginBottom: 4,
            lineHeight: 1.3,
          }}
        >
          <span style={{ color: DIM, fontWeight: 600, marginRight: 6 }}>NOTES:</span>
          {notesShort}
        </div>
      )}

      <div style={footerStyle}>
        SOP Card | Generated by DCS:OPT
      </div>
    </div>
  );
}
