/**
 * Transponder Card (v1.19.82) — kneeboard reference for the squadron's
 * IFF/transponder SOP. Renders the per-flight Mode 1/2/3 squawk plan
 * pilots dial in by hand (DCS doesn't store transponder codes in the
 * .miz, so this is reference-only — there's nothing to write back).
 *
 * Driven by the active SOP's `transponder` block (populated by the AI
 * extractor from a "Transponder SOP" card image). Only renders when the
 * SOP carries a plan; KneeboardTab self-skips otherwise.
 */

import React from 'react';
import type { SopTransponder } from '../sop/types';
import { MissionDateLine } from './cardStyles';
import type { MissionOverviewData } from '../types/mission';

interface TransponderCardProps {
  transponder: SopTransponder;
  squadron?: string;
  overview?: MissionOverviewData;
}

const W = 600;
const H = 850;
const FONT = "'Arial', sans-serif";
const MONO = "'B612 Mono', 'Consolas', monospace";
const BG = 'var(--kb-bg, #1a1a1a)';
const BORDER = 'var(--kb-border, #444)';
const BORDER_MED = 'var(--kb-border-med, #555)';
const BORDER_LIGHT = 'var(--kb-border-light, #666)';
const TEXT = 'var(--kb-text, #e0e0e0)';
const TEXT_BRIGHT = 'var(--kb-text-bright, #fff)';
const TEXT_MUTED = 'var(--kb-text-muted, #ccc)';
const ACCENT = '#ffa500';
const TH_BG = 'var(--kb-th-bg, #333)';

const thStyle: React.CSSProperties = {
  backgroundColor: TH_BG,
  color: TEXT_MUTED,
  padding: '4px 6px',
  textAlign: 'center',
  border: `1px solid ${BORDER_MED}`,
  fontWeight: 'bold',
  fontSize: 14,
};

const tdStyle: React.CSSProperties = {
  padding: '4px 6px',
  border: `1px solid ${BORDER}`,
  color: TEXT,
  fontSize: 14,
};

const monoCell: React.CSSProperties = {
  ...tdStyle,
  textAlign: 'center',
  fontFamily: MONO,
  color: ACCENT,
  fontWeight: 'bold',
  letterSpacing: 1,
};

// Fixed 850px canvas fits ~20 rows under the header/banner. Cap and
// show a "+N more" footer rather than silently clipping the bottom.
const ROW_CAP = 20;

export function TransponderCard({ transponder, squadron, overview }: TransponderCardProps) {
  const allRows = transponder.assignments ?? [];
  const rows = allRows.slice(0, ROW_CAP);
  const overflow = allRows.length - rows.length;

  return (
    <div style={{
      width: W,
      height: H,
      backgroundColor: BG,
      border: `1px solid ${BORDER}`,
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: FONT,
      color: TEXT,
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{
        textAlign: 'center',
        borderBottom: `2px solid ${BORDER_LIGHT}`,
        paddingBottom: 6,
        marginBottom: 10,
      }}>
        <div style={{ fontSize: 24, fontWeight: 'bold', color: TEXT_BRIGHT, letterSpacing: 1 }}>
          TRANSPONDER / IFF
        </div>
        {squadron && <div style={{ fontSize: 13, color: TEXT_MUTED, marginTop: 2 }}>{squadron}</div>}
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Mission-wide Mode 1 / Mode 4 banner */}
      {(transponder.mode1 || transponder.mode4 != null) && (
        <div style={{
          display: 'flex',
          gap: 18,
          justifyContent: 'center',
          marginBottom: 10,
          fontSize: 15,
        }}>
          {transponder.mode1 && (
            <span>MODE 1: <span style={{ fontFamily: MONO, color: ACCENT, fontWeight: 'bold' }}>{transponder.mode1}</span></span>
          )}
          {transponder.mode4 != null && (
            <span>MODE 4: <span style={{ fontFamily: MONO, color: transponder.mode4 ? '#3fb950' : TEXT_MUTED, fontWeight: 'bold' }}>{transponder.mode4 ? 'ON' : 'OFF'}</span></span>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 16, textAlign: 'center', marginTop: 40 }}>
          No transponder assignments in SOP.
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: '30%' }}>FLIGHT</th>
                <th style={{ ...thStyle, width: '14%' }}>M1</th>
                <th style={{ ...thStyle, width: '18%' }}>M2</th>
                <th style={{ ...thStyle, width: '18%' }}>M3</th>
                <th style={{ ...thStyle, width: '20%' }}>NOTES</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a, i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, fontWeight: 'bold' }}>{a.flight}</td>
                  <td style={monoCell}>{a.mode1 || '—'}</td>
                  <td style={monoCell}>{a.mode2 || '—'}</td>
                  <td style={monoCell}>{a.mode3 || '—'}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: TEXT_MUTED }}>{a.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {overflow > 0 && (
            <div style={{ fontSize: 12, color: TEXT_MUTED, textAlign: 'center', marginTop: 6 }}>
              +{overflow} more flight{overflow === 1 ? '' : 's'} in SOP
            </div>
          )}
        </div>
      )}

      {transponder.notes && (
        <div style={{ marginTop: 8, fontSize: 12, color: TEXT_MUTED, fontStyle: 'italic' }}>
          {transponder.notes}
        </div>
      )}

      <div style={{ fontSize: 10, color: TEXT_MUTED, textAlign: 'center', marginTop: 6, opacity: 0.7 }}>
        Set in cockpit — DCS does not preset transponder codes.
      </div>
    </div>
  );
}
