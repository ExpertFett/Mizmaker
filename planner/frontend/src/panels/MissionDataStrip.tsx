/**
 * Mission Data Strip — preview pass, not yet committed.
 *
 * Fixed 28px bar pinned to the top of the editor, visible on every
 * tab and mode. Shows what the floating Weather panel does today
 * (mission date, time, theater, QNH, surface wind) but as fixed
 * cockpit-instrument-cluster chrome instead of a map-overlay panel.
 *
 * Fable design-review recommendation #2: "Promote the instrument
 * panel to a fixed Zulu-first mission-data strip on every tab." The
 * panel today shows `21:30:00L` (`WeatherPanel.tsx:107`) while every
 * kneeboard / brief is Zulu-first — this resolves the convention
 * clash by always leading with Zulu and showing local as the
 * parenthetical secondary.
 *
 * All values come from missionStore.overview; the strip auto-hides
 * when no mission is loaded so the upload screen stays clean.
 */

import { useState } from 'react';
import { useMissionStore } from '../store/missionStore';
import { msToKnots } from '../utils/conversions';
import { GuidePanel } from './GuidePanel';

const BG = '#0a1218';
const BORDER = '#1f2c3d';
const LABEL = '#5a6f88';
const VALUE = '#cfd7e3';
const ACCENT = '#4a8fd4';
const MONO = "'B612 Mono', 'Consolas', monospace";

function fmtZulu(secondsSinceMidnight: number): string {
  const total = Math.max(0, Math.floor(secondsSinceMidnight));
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total / 60) % 60);
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}Z`;
}

function fmtLocal(secondsSinceMidnight: number): string {
  // Mission "start_time" is in mission-local seconds since midnight in
  // the same DCS sense Zulu uses (DCS doesn't model timezone offsets).
  // We show it explicitly as L so the convention is unambiguous.
  const total = Math.max(0, Math.floor(secondsSinceMidnight));
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total / 60) % 60);
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}L`;
}

function fmtDate(iso: string): string {
  // Accept either 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS'. Render as
  // 'DD MMM YYYY' (military-standard short date).
  if (!iso) return '';
  const datePart = iso.split(' ')[0];
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const mo = months[parseInt(m[2], 10) - 1] || m[2];
  return `${m[3]} ${mo} ${m[1]}`;
}

function fmtWind(dirRad: number, speedMs: number): string {
  // Direction in the .miz is the radians the wind is BLOWING TO. Pilots
  // expect direction the wind is COMING FROM (meteorological convention)
  // so we add 180°. Same flip RouteCard / WeatherPanel already do.
  const meteoDeg = ((((dirRad * 180) / Math.PI) + 180) % 360 + 360) % 360;
  const kts = Math.round(msToKnots(speedMs));
  return `${String(Math.round(meteoDeg)).padStart(3, '0')}°/${String(kts).padStart(2, '0')}kt`;
}

function fmtTheater(t: string): string {
  if (!t) return '';
  return t.toUpperCase();
}

interface CellProps {
  label: string;
  value: string;
  sub?: string;
}

interface ModeSegmentedProps {
  mode: 'editing' | 'planning' | 'live';
  onChange: (m: 'editing' | 'planning' | 'live') => void;
}

function ModeSegmented({ mode, onChange }: ModeSegmentedProps) {
  const modes: { id: 'editing' | 'planning' | 'live'; label: string; title: string }[] = [
    { id: 'editing', label: 'Editor',  title: 'Editing mode (full editor)' },
    { id: 'planning', label: 'Plan',   title: 'Planning mode (no .miz editing)' },
    { id: 'live', label: 'Live',       title: 'Live server / Olympus bridge' },
  ];
  return (
    <div style={{
      display: 'flex',
      borderLeft: `1px solid ${BORDER}`,
      borderRight: `1px solid ${BORDER}`,
      height: 30,
      paddingLeft: 6,
    }}>
      {modes.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            title={m.title}
            style={{
              background: active ? 'rgba(74,143,212,0.18)' : 'transparent',
              border: 'none',
              borderBottom: active ? '2px solid #4a8fd4' : '2px solid transparent',
              color: active ? '#cfd7e3' : LABEL,
              padding: '0 18px',
              fontSize: 11,
              fontFamily: MONO,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: 'uppercase',
              cursor: 'pointer',
              height: 30,
              minWidth: 64,
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function Cell({ label, value, sub }: CellProps) {
  if (!value) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8,
      paddingRight: 22, borderRight: `1px solid ${BORDER}`,
      paddingLeft: 22,
    }}>
      <span style={{
        fontSize: 9, color: LABEL, fontWeight: 600,
        letterSpacing: 1, textTransform: 'uppercase',
      }}>{label}</span>
      <span style={{
        fontFamily: MONO, fontSize: 13, color: VALUE, fontWeight: 500,
        letterSpacing: 0.3,
      }}>{value}</span>
      {sub && (
        <span style={{
          fontFamily: MONO, fontSize: 11, color: LABEL,
        }}>{sub}</span>
      )}
    </div>
  );
}

interface MissionDataStripProps {
  mode?: 'editing' | 'planning' | 'live';
  onModeChange?: (m: 'editing' | 'planning' | 'live') => void;
}

export function MissionDataStrip({ mode, onModeChange }: MissionDataStripProps = {}) {
  const overview = useMissionStore((s) => s.overview);
  const [guideOpen, setGuideOpen] = useState(false);
  // NOTE: do NOT return null when overview is missing — the strip
  // carries the Editor/Plan/Live mode switcher, and rendering nothing
  // would strand the user in whatever mode they're in. Data cells
  // individually skip when their value is absent.

  const w = overview?.weather?.wind?.atGround;
  const linkStyle: React.CSSProperties = {
    fontSize: 11, fontFamily: MONO, color: LABEL,
    background: 'transparent', border: 'none', cursor: 'pointer',
    padding: '0 12px', height: 30, display: 'inline-flex',
    alignItems: 'center', textDecoration: 'none',
    borderLeft: `1px solid ${BORDER}`,
    letterSpacing: 0.5, textTransform: 'uppercase',
  };
  return (
    <div style={{
      background: BG,
      borderBottom: `1px solid ${BORDER}`,
      height: 30,
      display: 'flex',
      alignItems: 'center',
      paddingLeft: 8,
      flexShrink: 0,
      fontFamily: "'Arial', sans-serif",
    }}>
      <div style={{
        fontFamily: MONO,
        fontSize: 10,
        color: ACCENT,
        fontWeight: 700,
        letterSpacing: 2,
        paddingRight: 14,
        borderRight: `1px solid ${BORDER}`,
        paddingLeft: 6,
      }}>
        DCS:OPT
      </div>
      {overview && (
        <>
          <Cell label="Theater" value={fmtTheater(overview.theater)} />
          <Cell label="Date"    value={fmtDate(overview.date)} />
          <Cell label="Time"    value={fmtZulu(overview.start_time)}
                                sub={`(${fmtLocal(overview.start_time)})`} />
          {overview.weather && (
            <>
              <Cell label="QNH"  value={`${overview.weather.qnh_inhg?.toFixed(2)}"`} />
              {w && <Cell label="Wind" value={fmtWind(w.dir, w.speed)} />}
              <Cell label="Temp" value={`${Math.round(overview.weather.temperature_c)}°C`} />
            </>
          )}
        </>
      )}
      <div style={{ flex: 1 }} />
      {mode && onModeChange && <ModeSegmented mode={mode} onChange={onModeChange} />}
      {/* Help + Discord rolled into the strip as text links instead of
          floating "chat-widget" circles that read as Intercom (the
          single most un-cockpit element on screen, per Fable review). */}
      <button
        onClick={() => setGuideOpen(true)}
        onMouseEnter={(e) => { e.currentTarget.style.color = VALUE; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = LABEL; }}
        style={linkStyle}
      >
        Help
      </button>
      <a
        href="https://discord.gg/4UQDxBkc4S"
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={(e) => { e.currentTarget.style.color = VALUE; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = LABEL; }}
        style={linkStyle}
      >
        Discord
      </a>
      {guideOpen && <GuidePanel onClose={() => setGuideOpen(false)} />}
    </div>
  );
}
