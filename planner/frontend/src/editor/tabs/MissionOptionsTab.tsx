/**
 * Mission Options tab — edit DCS forcedOptions for the .miz file.
 * Changes are saved into the miz on export.
 */

import { useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';

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

interface OptionDef {
  key: string;
  label: string;
  category: string;
  format: 'bool' | 'enum';
  enumMap?: Record<number, string>;
}

const OPTION_DEFS: OptionDef[] = [
  // Flight Model
  { key: 'easyFlight',         label: 'Easy Flight',          category: 'Flight Model',    format: 'bool' },
  { key: 'fuel',               label: 'Unlimited Fuel',       category: 'Flight Model',    format: 'bool' },
  { key: 'immortal',           label: 'Immortal',             category: 'Flight Model',    format: 'bool' },
  { key: 'geffect',            label: 'G-Effects',            category: 'Flight Model',    format: 'enum', enumMap: GEFFECT_MAP },
  { key: 'wakeTurbulence',     label: 'Wake Turbulence',      category: 'Flight Model',    format: 'bool' },
  { key: 'birds',              label: 'Bird Strikes',         category: 'Flight Model',    format: 'bool' },
  { key: 'accidental_failures', label: 'Random Failures',     category: 'Flight Model',    format: 'bool' },
  { key: 'permitCrash',        label: 'Permit Crash Recovery', category: 'Flight Model',   format: 'bool' },

  // Views & HUD
  { key: 'externalViews',      label: 'External Views',       category: 'Views & HUD',     format: 'bool' },
  { key: 'padlock',            label: 'Padlock',              category: 'Views & HUD',     format: 'bool' },
  { key: 'optionsView',        label: 'F10 Map View',         category: 'Views & HUD',     format: 'enum', enumMap: OPTIONS_VIEW_MAP },
  { key: 'miniHUD',            label: 'Mini HUD',             category: 'Views & HUD',     format: 'bool' },
  { key: 'labels',             label: 'Labels',               category: 'Views & HUD',     format: 'enum', enumMap: LABELS_MAP },

  // Comms & Traffic
  { key: 'easyComms',          label: 'Easy Comms',           category: 'Comms & Traffic',  format: 'bool' },
  { key: 'civTraffic',         label: 'Civilian Traffic',     category: 'Comms & Traffic',  format: 'enum', enumMap: CIV_TRAFFIC_MAP },
  { key: 'userMarks',          label: 'User Marks',           category: 'Comms & Traffic',  format: 'bool' },

  // AI
  { key: 'easyRadar',          label: 'Easy Radar',           category: 'AI & Sensors',     format: 'bool' },
  { key: 'RBDAI',              label: 'Battle Damage AI',     category: 'AI & Sensors',     format: 'bool' },
];

const CATEGORY_ORDER = ['Flight Model', 'Views & HUD', 'Comms & Traffic', 'AI & Sensors'];

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const sectionStyle: React.CSSProperties = { marginBottom: 20 };

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#4a8fd4', textTransform: 'uppercase',
  letterSpacing: 1, padding: '6px 0', borderBottom: '1px solid #4a4a4a', marginBottom: 8,
};

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '7px 12px', borderRadius: 4, fontSize: 13,
};

const altRow: React.CSSProperties = { ...rowStyle, background: 'rgba(74, 143, 212, 0.04)' };

const selectStyle: React.CSSProperties = {
  background: '#262626', border: '1px solid #4a4a4a', borderRadius: 4,
  color: '#e0e0e0', fontSize: 12, padding: '4px 8px', cursor: 'pointer',
  fontFamily: 'inherit', minWidth: 140,
};

/* ------------------------------------------------------------------ */
/* Toggle switch component                                             */
/* ------------------------------------------------------------------ */

function TriToggle({ value, onChange }: {
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
}) {
  // Three states: undefined (not set) → true (ON) → false (OFF) → undefined ...
  const cycle = () => {
    if (value === undefined) onChange(true);
    else if (value === true) onChange(false);
    else onChange(undefined);
  };

  const isOn = value === true;
  const isOff = value === false;
  const isUnset = value === undefined;

  return (
    <button onClick={cycle} style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
    }}>
      {/* Track */}
      <div style={{
        width: 44, height: 22, borderRadius: 11, position: 'relative',
        background: isOn ? 'rgba(63, 185, 80, 0.25)' : isOff ? 'rgba(217, 80, 80, 0.2)' : '#3a3a3a',
        border: `1px solid ${isOn ? 'rgba(63, 185, 80, 0.4)' : isOff ? 'rgba(217, 80, 80, 0.3)' : '#3a3a3a'}`,
        transition: 'all 0.15s',
      }}>
        {/* Knob */}
        <div style={{
          width: 16, height: 16, borderRadius: '50%', position: 'absolute', top: 2,
          left: isOn ? 24 : isUnset ? 12 : 2,
          background: isOn ? '#3fb950' : isOff ? '#d95050' : '#aaaaaa',
          transition: 'all 0.15s',
        }} />
      </div>
      {/* Label */}
      <span style={{
        fontSize: 11, fontWeight: 600, minWidth: 55,
        color: isOn ? '#3fb950' : isOff ? '#d95050' : '#aaaaaa',
      }}>
        {isOn ? 'ON' : isOff ? 'OFF' : 'NOT SET'}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function MissionOptionsTab() {
  const missionOptions = useMissionStore((s) => s.missionOptions);
  const setMissionOptions = useMissionStore((s) => s.setMissionOptions);
  const overview = useMissionStore((s) => s.overview);

  const setOption = useCallback((key: string, value: unknown) => {
    if (value === undefined) {
      // Remove the key (unset it)
      const next = { ...missionOptions };
      delete next[key];
      setMissionOptions(next);
    } else {
      setMissionOptions({ ...missionOptions, [key]: value });
    }
  }, [missionOptions, setMissionOptions]);

  // Group defined options by category
  const grouped = new Map<string, OptionDef[]>();
  for (const cat of CATEGORY_ORDER) grouped.set(cat, []);
  for (const def of OPTION_DEFS) {
    const list = grouped.get(def.category) || [];
    list.push(def);
    grouped.set(def.category, list);
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: '#e0e0e0', marginBottom: 4 }}>
        Mission Options
      </h2>
      <p style={{ fontSize: 12, color: '#aaaaaa', marginBottom: 4 }}>
        Force options for all players in this mission. Changes are written to the .miz on export.
        {overview?.sortie && <span> &mdash; <strong style={{ color: '#e0e0e0' }}>{overview.sortie}</strong></span>}
      </p>
      <p style={{ fontSize: 11, color: '#aaaaaa', marginBottom: 20 }}>
        <strong style={{ color: '#4a8fd4' }}>NOT SET</strong> = uses each player's local settings &nbsp;|&nbsp;
        <strong style={{ color: '#3fb950' }}>ON</strong> = forced enabled &nbsp;|&nbsp;
        <strong style={{ color: '#d95050' }}>OFF</strong> = forced disabled
      </p>

      {CATEGORY_ORDER.map((cat) => {
        const defs = grouped.get(cat) || [];
        return (
          <div key={cat} style={sectionStyle}>
            <div style={sectionTitleStyle}>{cat}</div>
            {defs.map((def, i) => (
              <div key={def.key} style={i % 2 === 0 ? rowStyle : altRow}>
                <span style={{ color: '#e0e0e0' }}>{def.label}</span>
                {def.format === 'bool' ? (
                  <TriToggle
                    value={missionOptions[def.key] as boolean | undefined}
                    onChange={(v) => setOption(def.key, v)}
                  />
                ) : (
                  <EnumSelect
                    value={missionOptions[def.key] as number | undefined}
                    enumMap={def.enumMap!}
                    onChange={(v) => setOption(def.key, v)}
                  />
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Enum dropdown with "Not Set" option                                 */
/* ------------------------------------------------------------------ */

function EnumSelect({ value, enumMap, onChange }: {
  value: number | undefined;
  enumMap: Record<number, string>;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <select
      value={value === undefined ? '__unset__' : String(value)}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '__unset__' ? undefined : Number(v));
      }}
      style={selectStyle}
    >
      <option value="__unset__">Not Set (Player Default)</option>
      {Object.entries(enumMap).map(([k, label]) => (
        <option key={k} value={k}>{label}</option>
      ))}
    </select>
  );
}
