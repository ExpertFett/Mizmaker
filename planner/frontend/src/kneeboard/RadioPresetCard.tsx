/**
 * Radio Preset Card (v1.19.77) — per-airframe kneeboard card rendering
 * the SOP comm plan's button maps in the squadron's own card format:
 * paired columns per radio, each Button | Freq Mod | ID.
 *
 * Modelled on the wing's hand-made Tomcat/Hornet preset cards — the
 * goal is that OPT GENERATES this card from the comm plan so nobody
 * maintains preset spreadsheets by hand again. One card per airframe;
 * every flight of that type gets the same card (fixed buttons are the
 * wing contract).
 */

import React from 'react';
import type { CommPlan, CommNet, RadioButtonMap } from '../sop/types';
import { MissionDateLine } from './cardStyles';
import type { MissionOverviewData } from '../types/mission';

interface RadioPresetCardProps {
  aircraft: string;
  plan: CommPlan;
  overview?: MissionOverviewData;
  /** Card heading; defaults to a cleaned-up airframe name. */
  title?: string;
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

/** Friendly airframe display names for the card title. */
const AIRFRAME_TITLES: Record<string, string> = {
  'FA-18C_hornet': 'HORNET',
  'F-14B': 'TOMCAT',
  'F-14A-135-GR': 'TOMCAT',
  'F-16C_50': 'VIPER',
  'F-15ESE': 'STRIKE EAGLE',
  'A-10C_2': 'HAWG',
  'A-10C': 'HAWG',
  'AV8BNA': 'HARRIER',
  'AH-64D_BLK_II': 'APACHE',
};

function airframeTitle(aircraft: string): string {
  return AIRFRAME_TITLES[aircraft] || aircraft.replace(/_/g, ' ').toUpperCase();
}

function netCell(net: CommNet | undefined): { freq: string; id: string } {
  if (!net) return { freq: '', id: '' };
  if (net.kind === 'radio' && net.frequency) {
    return { freq: `${net.frequency.toFixed(3)} ${net.modulation ?? 'AM'}`, id: net.name };
  }
  if (net.kind !== 'radio') {
    return {
      freq: `MIDS ${net.kind === 'midsA' ? 'A' : 'B'}${net.midsChannel ? ` ${net.midsChannel}` : ''}`,
      id: net.name,
    };
  }
  return { freq: '', id: net.name };
}

const thStyle: React.CSSProperties = {
  backgroundColor: TH_BG,
  color: TEXT_MUTED,
  padding: '3px 6px',
  textAlign: 'center',
  border: `1px solid ${BORDER_MED}`,
  fontWeight: 'bold',
  fontSize: 14,
};

const tdStyle: React.CSSProperties = {
  padding: '2px 6px',
  border: `1px solid ${BORDER}`,
  color: TEXT,
  fontSize: 14,
};

export function RadioPresetCard({ aircraft, plan, overview, title }: RadioPresetCardProps) {
  const maps: RadioButtonMap[] = plan.maps
    .filter((m) => m.aircraft === aircraft)
    .sort((a, b) => a.radio - b.radio);
  const netById = new Map(plan.nets.map((n) => [n.id, n]));

  // Row count = the deepest programmed button across this airframe's
  // radios (min 20 so the card shape matches the hand-made originals).
  const maxButton = Math.max(
    20,
    ...maps.map((m) => Math.max(0, ...Object.keys(m.buttons).map(Number))),
  );

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
          {title || `${airframeTitle(aircraft)} RADIO PRESETS`}
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {maps.length === 0 ? (
        <div style={{ color: TEXT_MUTED, fontSize: 16, textAlign: 'center', marginTop: 40 }}>
          No comm plan button maps for {aircraft}.
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
          }}>
            <thead>
              <tr>
                {maps.map((m) => (
                  <React.Fragment key={`h-${m.radio}`}>
                    <th style={{ ...thStyle, width: '7%' }}>PB</th>
                    <th style={{ ...thStyle, width: '21%' }}>{m.radioLabel || `Radio ${m.radio}`}</th>
                    <th style={{ ...thStyle, width: '22%' }}>ID</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxButton }, (_, i) => i + 1).map((pb) => (
                <tr key={pb}>
                  {maps.map((m) => {
                    const net = m.buttons[pb] ? netById.get(m.buttons[pb]) : undefined;
                    const cell = netCell(net);
                    return (
                      <React.Fragment key={`${m.radio}-${pb}`}>
                        <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold', color: ACCENT, fontFamily: MONO }}>
                          {pb}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center', fontFamily: MONO, fontSize: 13, whiteSpace: 'nowrap' }}>
                          {cell.freq}
                        </td>
                        <td style={{ ...tdStyle, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {cell.id}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
