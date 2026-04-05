/**
 * Mission Options tab — displays DCS forcedOptions from the .miz file.
 * Read-only view of what the mission maker configured in the ME.
 */

import { useMissionStore } from '../../store/missionStore';
import type { MissionOptions } from '../../types/mission';

/* ------------------------------------------------------------------ */
/* Human-readable mappings for DCS option values                       */
/* ------------------------------------------------------------------ */

const LABELS_MAP: Record<number, string> = {
  0: 'Full',
  1: 'Abbreviated',
  2: 'Dot Only',
  3: 'Neutral Dot',
  4: 'Off',
};

const CIV_TRAFFIC_MAP: Record<number, string> = {
  0: 'Off',
  1: 'Low',
  2: 'Medium',
  3: 'High',
};

const GEFFECT_MAP: Record<number, string> = {
  0: 'None',
  1: 'Realistic (w/ recovery)',
  2: 'Realistic (lethal)',
};

const OPTIONS_VIEW_MAP: Record<number, string> = {
  0: 'All',
  1: 'Fog of War',
  2: 'Map Only',
  3: 'My Aircraft',
};

/** Organized option definitions for display */
interface OptionDef {
  key: string;
  label: string;
  category: string;
  format: 'bool' | 'enum' | 'raw';
  enumMap?: Record<number, string>;
  /** If true, "enabled" is the restrictive/hard setting */
  hardWhenTrue?: boolean;
}

const OPTION_DEFS: OptionDef[] = [
  // Flight Model
  { key: 'easyFlight',   label: 'Easy Flight',          category: 'Flight Model',   format: 'bool' },
  { key: 'fuel',         label: 'Unlimited Fuel',        category: 'Flight Model',   format: 'bool' },
  { key: 'immortal',     label: 'Immortal',              category: 'Flight Model',   format: 'bool' },
  { key: 'geffect',      label: 'G-Effects',             category: 'Flight Model',   format: 'enum', enumMap: GEFFECT_MAP },
  { key: 'wakeTurbulence', label: 'Wake Turbulence',     category: 'Flight Model',   format: 'bool' },
  { key: 'birds',        label: 'Bird Strikes',          category: 'Flight Model',   format: 'bool' },
  { key: 'accidental_failures', label: 'Random Failures', category: 'Flight Model', format: 'bool' },
  { key: 'permitCrash',  label: 'Permit Crash Recovery', category: 'Flight Model',   format: 'bool' },

  // Views & HUD
  { key: 'externalViews', label: 'External Views',       category: 'Views & HUD',    format: 'bool' },
  { key: 'padlock',       label: 'Padlock',              category: 'Views & HUD',    format: 'bool' },
  { key: 'optionsView',   label: 'F10 Map View',         category: 'Views & HUD',    format: 'enum', enumMap: OPTIONS_VIEW_MAP },
  { key: 'miniHUD',       label: 'Mini HUD',             category: 'Views & HUD',    format: 'bool' },
  { key: 'labels',        label: 'Labels',               category: 'Views & HUD',    format: 'enum', enumMap: LABELS_MAP },

  // Comms & Traffic
  { key: 'easyComms',     label: 'Easy Comms',           category: 'Comms & Traffic', format: 'bool' },
  { key: 'civTraffic',    label: 'Civilian Traffic',      category: 'Comms & Traffic', format: 'enum', enumMap: CIV_TRAFFIC_MAP },
  { key: 'userMarks',     label: 'User Marks',           category: 'Comms & Traffic', format: 'bool' },

  // AI
  { key: 'easyRadar',     label: 'Easy Radar',           category: 'AI & Sensors',   format: 'bool' },
  { key: 'RBDAI',         label: 'Battle Damage AI',     category: 'AI & Sensors',   format: 'bool' },
];

const CATEGORY_ORDER = ['Flight Model', 'Views & HUD', 'Comms & Traffic', 'AI & Sensors'];

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const sectionStyle: React.CSSProperties = {
  marginBottom: 20,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#4a8fd4',
  textTransform: 'uppercase',
  letterSpacing: 1,
  padding: '6px 0',
  borderBottom: '1px solid #1a3a5a',
  marginBottom: 8,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 12px',
  borderRadius: 4,
  fontSize: 13,
};

const altRow: React.CSSProperties = {
  ...rowStyle,
  background: 'rgba(74, 143, 212, 0.04)',
};

const labelStyle: React.CSSProperties = {
  color: '#ccdae8',
};

const tagOn: React.CSSProperties = {
  padding: '2px 10px',
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  background: 'rgba(63, 185, 80, 0.15)',
  color: '#3fb950',
  border: '1px solid rgba(63, 185, 80, 0.25)',
};

const tagOff: React.CSSProperties = {
  padding: '2px 10px',
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  background: 'rgba(217, 80, 80, 0.1)',
  color: '#d95050',
  border: '1px solid rgba(217, 80, 80, 0.2)',
};

const tagEnum: React.CSSProperties = {
  padding: '2px 10px',
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 600,
  background: 'rgba(74, 143, 212, 0.12)',
  color: '#4a8fd4',
  border: '1px solid rgba(74, 143, 212, 0.25)',
};

const tagUnset: React.CSSProperties = {
  padding: '2px 10px',
  borderRadius: 10,
  fontSize: 11,
  color: '#5a7a8a',
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

function formatValue(def: OptionDef, opts: MissionOptions) {
  const val = opts[def.key];
  if (val === undefined || val === null) {
    return <span style={tagUnset}>Not Set (Player Default)</span>;
  }
  if (def.format === 'bool') {
    const isOn = Boolean(val);
    return <span style={isOn ? tagOn : tagOff}>{isOn ? 'ON' : 'OFF'}</span>;
  }
  if (def.format === 'enum' && def.enumMap) {
    const label = def.enumMap[val as number] ?? String(val);
    return <span style={tagEnum}>{label}</span>;
  }
  return <span style={tagEnum}>{String(val)}</span>;
}

export function MissionOptionsTab() {
  const missionOptions = useMissionStore((s) => s.missionOptions);
  const overview = useMissionStore((s) => s.overview);

  const hasAnyOption = Object.keys(missionOptions).length > 0;

  // Group defined options by category
  const grouped = new Map<string, OptionDef[]>();
  for (const cat of CATEGORY_ORDER) grouped.set(cat, []);
  for (const def of OPTION_DEFS) {
    const list = grouped.get(def.category) || [];
    list.push(def);
    grouped.set(def.category, list);
  }

  // Collect any unknown keys not in OPTION_DEFS
  const knownKeys = new Set(OPTION_DEFS.map((d) => d.key));
  const extras = Object.entries(missionOptions).filter(([k]) => !knownKeys.has(k));

  return (
    <div style={{ maxWidth: 700 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: '#ccdae8', marginBottom: 4 }}>
        Mission Options
      </h2>
      <p style={{ fontSize: 12, color: '#5a7a8a', marginBottom: 20 }}>
        Forced options set by the mission maker in the DCS Mission Editor.
        {overview?.sortie && <span> &mdash; <strong style={{ color: '#ccdae8' }}>{overview.sortie}</strong></span>}
      </p>

      {!hasAnyOption && (
        <div style={{
          padding: '24px 16px',
          background: 'rgba(74, 143, 212, 0.04)',
          borderRadius: 6,
          border: '1px solid #1a3a5a',
          textAlign: 'center',
          color: '#5a7a8a',
          fontSize: 13,
        }}>
          No forced options detected in this mission.<br />
          All settings will use each player's local defaults.
        </div>
      )}

      {CATEGORY_ORDER.map((cat) => {
        const defs = grouped.get(cat) || [];
        return (
          <div key={cat} style={sectionStyle}>
            <div style={sectionTitleStyle}>{cat}</div>
            {defs.map((def, i) => (
              <div key={def.key} style={i % 2 === 0 ? rowStyle : altRow}>
                <span style={labelStyle}>{def.label}</span>
                {formatValue(def, missionOptions)}
              </div>
            ))}
          </div>
        );
      })}

      {extras.length > 0 && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Other</div>
          {extras.map(([key, val], i) => (
            <div key={key} style={i % 2 === 0 ? rowStyle : altRow}>
              <span style={labelStyle}>{key}</span>
              <span style={tagEnum}>{String(val)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
