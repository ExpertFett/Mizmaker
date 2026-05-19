/**
 * Mission Options tab — edit DCS forcedOptions for the .miz file.
 * Changes are saved into the miz on export.
 */

import { useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';

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

const ICONS_THEME_MAP: Record<string, string> = {
  nato:    'NATO',
  russian: 'Russian',
  generic: 'Generic',
};

interface OptionDef {
  key: string;
  label: string;
  category: string;
  format: 'bool' | 'enum' | 'strenum';
  enumMap?: Record<number, string>;
  strEnumMap?: Record<string, string>;
}

const OPTION_DEFS: OptionDef[] = [
  // Flight Model
  { key: 'easyFlight',         label: 'Easy Flight',          category: 'Flight Model',    format: 'bool' },
  { key: 'fuel',               label: 'Unlimited Fuel',       category: 'Flight Model',    format: 'bool' },
  { key: 'weapons',            label: 'Unlimited Weapons',    category: 'Flight Model',    format: 'bool' },
  { key: 'immortal',           label: 'Immortal',             category: 'Flight Model',    format: 'bool' },
  { key: 'geffect',            label: 'G-Effects',            category: 'Flight Model',    format: 'enum', enumMap: GEFFECT_MAP },
  { key: 'wakeTurbulence',     label: 'Wake Turbulence',      category: 'Flight Model',    format: 'bool' },
  { key: 'birds',              label: 'Bird Strikes',         category: 'Flight Model',    format: 'bool' },
  { key: 'accidental_failures', label: 'Random Failures',     category: 'Flight Model',    format: 'bool' },
  { key: 'permitCrash',        label: 'Permit Crash Recovery', category: 'Flight Model',   format: 'bool' },
  { key: 'helicopterSimplifiedFlightModel',
                                label: 'Helo Simplified Flight Model',
                                                              category: 'Flight Model',    format: 'bool' },

  // Views & HUD
  { key: 'externalViews',      label: 'External Views',       category: 'Views & HUD',     format: 'bool' },
  { key: 'spectatorExternalViews',
                                label: 'Spectator External Views',
                                                              category: 'Views & HUD',     format: 'bool' },
  { key: 'padlock',            label: 'Padlock',              category: 'Views & HUD',     format: 'bool' },
  { key: 'optionsView',        label: 'F10 Map View',         category: 'Views & HUD',     format: 'enum', enumMap: OPTIONS_VIEW_MAP },
  { key: 'miniHUD',            label: 'Mini HUD',             category: 'Views & HUD',     format: 'bool' },
  { key: 'labels',             label: 'Labels',               category: 'Views & HUD',     format: 'enum', enumMap: LABELS_MAP },
  { key: 'iconsTheme',         label: 'Icons Theme',          category: 'Views & HUD',     format: 'strenum', strEnumMap: ICONS_THEME_MAP },

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
  fontSize: 12, fontWeight: 600, color: '#d49a30', textTransform: 'uppercase',
  letterSpacing: 1, padding: '6px 0', borderBottom: '1px solid #4a5258', marginBottom: 8,
};

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '7px 12px', borderRadius: 4, fontSize: 13,
};

const altRow: React.CSSProperties = { ...rowStyle, background: 'rgba(74, 143, 212, 0.04)' };

const selectStyle: React.CSSProperties = {
  background: '#6e7c83', border: '1px solid #4a5258', borderRadius: 4,
  color: '#1a1f25', fontSize: 12, padding: '4px 8px', cursor: 'pointer',
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
        background: isOn ? 'rgba(63, 185, 80, 0.25)' : isOff ? 'rgba(217, 80, 80, 0.2)' : '#4a5258',
        border: `1px solid ${isOn ? 'rgba(63, 185, 80, 0.4)' : isOff ? 'rgba(217, 80, 80, 0.3)' : '#4a5258'}`,
        transition: 'all 0.15s',
      }}>
        {/* Knob */}
        <div style={{
          width: 16, height: 16, borderRadius: '50%', position: 'absolute', top: 2,
          left: isOn ? 24 : isUnset ? 12 : 2,
          background: isOn ? '#3fb950' : isOff ? '#d95050' : '#3a4248',
          transition: 'all 0.15s',
        }} />
      </div>
      {/* Label */}
      <span style={{
        fontSize: 11, fontWeight: 600, minWidth: 55,
        color: isOn ? '#3fb950' : isOff ? '#d95050' : '#3a4248',
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
  // Strip-required-modules toggle (v0.9.32) — lives in editStore
  // because it's a download-time decision, not a mission-state
  // value. Surfaced here because users associate "compatibility"
  // with the mission options tab.
  const stripRequiredModules = useEditStore((s) => s.stripRequiredModules);
  const setStripRequiredModules = useEditStore((s) => s.setStripRequiredModules);

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

  // Supercarrier sub-options live one level deeper:
  //   forcedOptions.Supercarrier.{deck_crew, speakers_enabled}
  // Defaults to ON when absent — DCS treats the missing key as "render
  // deck crew / play 5MC". This used to live on the Carriers tab; moved
  // here in v0.9.2 because it's a mission-wide forced option, not a
  // per-carrier setting.
  const scOpts = (missionOptions?.Supercarrier as
    | { deck_crew?: boolean; speakers_enabled?: boolean }
    | undefined) || {};
  const setSupercarrierOpt = useCallback(
    (key: 'deck_crew' | 'speakers_enabled', value: boolean) => {
      const prev = (missionOptions?.Supercarrier as Record<string, unknown>) || {};
      setMissionOptions({
        ...missionOptions,
        Supercarrier: { ...prev, [key]: value },
      });
    },
    [missionOptions, setMissionOptions],
  );

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
      <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1a1f25', marginBottom: 4 }}>
        Mission Options
      </h2>
      <p style={{ fontSize: 12, color: '#3a4248', marginBottom: 4 }}>
        Force options for all players in this mission. Changes are written to the .miz on export.
        {overview?.sortie && <span> &mdash; <strong style={{ color: '#1a1f25' }}>{overview.sortie}</strong></span>}
      </p>
      <p style={{ fontSize: 11, color: '#3a4248', marginBottom: 20 }}>
        <strong style={{ color: '#d49a30' }}>NOT SET</strong> = uses each player's local settings &nbsp;|&nbsp;
        <strong style={{ color: '#3fb950' }}>ON</strong> = forced enabled &nbsp;|&nbsp;
        <strong style={{ color: '#d95050' }}>OFF</strong> = forced disabled
      </p>

      {/* Compatibility section — non-forcedOptions stuff that
          affects how the .miz is repackaged on download. Sits at
          the top so it's visible without scrolling past the tri-
          state toggle wall. (v0.9.32) */}
      <div
        style={{
          marginBottom: 20,
          padding: '10px 14px',
          background: '#6e7c83',
          border: '1px solid #1a2a3a',
          borderRadius: 6,
        }}
      >
        <div
          style={{
            fontSize: 11, color: '#5a6268', textTransform: 'uppercase',
            letterSpacing: 1, fontWeight: 600, marginBottom: 8,
          }}
        >
          Compatibility
        </div>
        <label
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            fontSize: 13, cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={stripRequiredModules}
            onChange={(e) => setStripRequiredModules(e.target.checked)}
            style={{ accentColor: '#d49a30', marginTop: 2 }}
          />
          <span>
            <span style={{ color: '#1a1f25', fontWeight: 600 }}>
              Strip required modules on download
            </span>
            <span style={{ color: '#5a6268', display: 'block', fontSize: 12, marginTop: 2 }}>
              Empties the .miz's <code style={{ color: '#1a1f25' }}>requiredModules</code> block
              so anyone can load the mission, regardless of which DCS mods they have installed.
              On by default — turn off if your mission genuinely needs a specific mod and you
              want DCS to enforce it.
            </span>
          </span>
        </label>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const defs = grouped.get(cat) || [];
        return (
          <div key={cat} style={sectionStyle}>
            <div style={sectionTitleStyle}>{cat}</div>
            {defs.map((def, i) => (
              <div key={def.key} style={i % 2 === 0 ? rowStyle : altRow}>
                <span style={{ color: '#1a1f25' }}>{def.label}</span>
                {def.format === 'bool' ? (
                  <TriToggle
                    value={missionOptions[def.key] as boolean | undefined}
                    onChange={(v) => setOption(def.key, v)}
                  />
                ) : def.format === 'strenum' ? (
                  <StrEnumSelect
                    value={missionOptions[def.key] as string | undefined}
                    enumMap={def.strEnumMap!}
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

      {/* Supercarrier — only meaningful on missions with a CVN, but the
          forcedOptions key is mission-wide so it lives here, not on the
          per-carrier Carriers tab. Two-state plain checkbox (no NOT SET)
          because DCS' default-when-absent IS true; users picking OFF
          want the 5MC silenced or the deck cleared. */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Supercarrier (Modules)</div>
        <p style={{ fontSize: 11, color: '#5a6268', padding: '0 12px 8px', margin: 0 }}>
          Mission-wide rendering toggles for the DCS Supercarrier module.
          Default to ON when not set in the .miz; flip OFF to silence the
          5MC PA system or hide deck crew (e.g. for cinematic recovery
          videos).
        </p>
        {([
          { key: 'deck_crew',         label: 'Render Deck Crew' },
          { key: 'speakers_enabled',  label: '5MC PA System' },
        ] as const).map((opt, i) => {
          const checked = scOpts[opt.key] !== false;  // missing -> ON
          return (
            <div key={opt.key} style={i % 2 === 0 ? rowStyle : altRow}>
              <span style={{ color: '#1a1f25' }}>{opt.label}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setSupercarrierOpt(opt.key, e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <span style={{
                  fontSize: 11, fontWeight: 600, minWidth: 30,
                  color: checked ? '#3fb950' : '#3a4248',
                }}>
                  {checked ? 'ON' : 'OFF'}
                </span>
              </label>
            </div>
          );
        })}
      </div>
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

/** Same shape as EnumSelect but the values are strings (DCS uses both
 *  forms across different forcedOptions fields — iconsTheme is a string
 *  enum, optionsView/civTraffic are numbers). */
function StrEnumSelect({ value, enumMap, onChange }: {
  value: string | undefined;
  enumMap: Record<string, string>;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <select
      value={value === undefined ? '__unset__' : value}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '__unset__' ? undefined : v);
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
