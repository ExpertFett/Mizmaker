/**
 * ATIS Configurator — configure SRS ATIS broadcasts for airbases.
 *
 * Generates a Lua script that uses DCS's built-in Airbase.getByName() for
 * positioning and STTS (SRS) for text-to-speech broadcast. Adds the script
 * as a trigger via the trigger store, same as the script library.
 */

import { useState, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useTriggerStore } from '../../store/triggerStore';
import { getTriggers, saveTriggers } from '../../api/client';
import { getAirbaseComms, atisForAirbase } from '../../data/airbaseComms';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface AtisEntry {
  airbaseName: string;     // DCS internal name (key for Airbase.getByName)
  displayName: string;     // Spoken/printed name — defaults to airbaseName,
                           // overridable for prettier ATIS broadcast text
                           // ('Edwards Air Force Base' vs 'KEDW' or
                           // 'Krasnodar Pashkovsky International').
  initials: string;        // Short identifier (ICAO / squadron code) shown
                           // on the brief and used as the prefix in the
                           // ATIS info text. e.g. 'EDW', 'KRR', 'BTM'.
  freq: string;            // MHz
  modulation: 'AM' | 'FM';
  coalition: 0 | 1 | 2;    // 0=all, 1=red, 2=blue
  enabled: boolean;
  /** Where the freq came from when this entry was first created.
   *  'db'        — airbaseComms.ts had a published value (DCS-canonical
   *                Caucasus ATIS, etc.) — pilot can trust it matches
   *                the in-game broadcast.
   *  'suggested' — deterministic-by-name UHF suggestion in 250-270 MHz
   *                range; no published value, but stable across sessions.
   *  'custom'    — user manually edited the freq away from db/suggested.
   *  Used to render the "DB" / "AUTO" / "EDIT" badge next to the freq
   *  input + decide what "Reset" does. */
  freqSource: 'db' | 'suggested' | 'custom';
}

/** Compact pill that tells the user where the ATIS frequency on a row
 *  came from. Helps pilots tell "this is the canonical DCS value" from
 *  "we made this up but it's stable" from "I edited this myself". */
function FreqSourceBadge({ source }: { source: 'db' | 'suggested' | 'custom' }) {
  const cfg = {
    db:        { label: 'DB',     bg: '#1a3a1a', border: '#2a5a2a', fg: '#3fb950',
                 title: 'Frequency from the airbase comms database — matches DCS' },
    suggested: { label: 'AUTO',   bg: '#2a2e1a', border: '#4a4a2a', fg: '#d29922',
                 title: 'Suggested UHF frequency (deterministic by airbase name) — no published DCS value in the database for this field' },
    custom:    { label: 'EDIT',   bg: '#1a2a3a', border: '#2a4a6a', fg: '#6ab4f0',
                 title: 'Customised — you edited this away from the default' },
  }[source];
  return (
    <span
      title={cfg.title}
      style={{
        padding: '1px 6px',
        borderRadius: 3,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        color: cfg.fg,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.5,
        flexShrink: 0,
      }}
    >
      {cfg.label}
    </span>
  );
}

/** Build a sensible default initials string from a DCS airbase name.
 *  'Krasnodar-Pashkovsky' -> 'KP', 'Anapa-Vityazevo' -> 'AV',
 *  single-word names -> first 3 uppercase letters. */
function defaultInitials(name: string): string {
  const tokens = name.split(/[\s\-_]+/).filter(Boolean);
  if (tokens.length >= 2) {
    return tokens.slice(0, 3).map((t) => t[0].toUpperCase()).join('');
  }
  return name.slice(0, 3).toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const cardStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #4a4a4a', borderRadius: 6,
  padding: 12, marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  background: '#262626', border: '1px solid #4a4a4a', borderRadius: 4,
  color: '#e0e0e0', fontSize: 12, padding: '4px 8px', fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: 'pointer', minWidth: 70,
};

const btnDanger: React.CSSProperties = {
  background: 'rgba(217, 80, 80, 0.1)', border: '1px solid rgba(217, 80, 80, 0.2)',
  borderRadius: 4, color: '#d95050', fontSize: 11, padding: '4px 8px',
  cursor: 'pointer', fontFamily: 'inherit',
};

const btnSuccess: React.CSSProperties = {
  background: 'rgba(63, 185, 80, 0.15)', border: '1px solid rgba(63, 185, 80, 0.3)',
  borderRadius: 4, color: '#3fb950', fontSize: 13, padding: '8px 20px',
  cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
};

const checkboxStyle: React.CSSProperties = {
  accentColor: '#4a8fd4', width: 16, height: 16, cursor: 'pointer',
};

/* ------------------------------------------------------------------ */
/* Script generator                                                    */
/* ------------------------------------------------------------------ */

function generateAtisScript(entries: AtisEntry[]): string {
  const active = entries.filter((e) => e.enabled);
  if (active.length === 0) return '';

  const configs = active.map((e) => {
    // Parse runways from airbaseComms
    const comms = getAirbaseComms(e.airbaseName);
    const rwyStr = comms?.runways || '';
    // Parse runway designators (e.g., "08/26" → 8, 26)…
    const rwyNums = rwyStr.split(/[/,]/).map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    // …and emit HEADINGS (designator × 10 → {80, 260}). getActiveRunway
    // compares against wind direction in degrees, and the broadcast formatter
    // prints rwy/10 as the "%02d" designator. Storing the raw designator broke
    // BOTH: wind selection compared 8° vs 080°, and "08" printed as "01".
    // (Pre-beta audit P2.)
    const rwyHeadings = rwyNums.map((n) => n * 10);
    const rwyLua = rwyHeadings.length > 0 ? `{ ${rwyHeadings.join(', ')} }` : '{}';
    const elev = comms?.elevation ? Math.round(comms.elevation * 0.3048) : 0; // ft to meters

    // `name` stays as the DCS internal name so Airbase.getByName() finds
    // the in-game object. `displayName` is what the broadcast says (the
    // pretty / spoken form) — falls back to `name` if user hasn't
    // customised. `initials` (ICAO/squadron code) prefixes the broadcast.
    const displayName = e.displayName || e.airbaseName;
    const initials = e.initials || defaultInitials(e.airbaseName);
    // freq is user-editable — strip to digits/dot so a stray quote or empty
    // value can't break the generated Lua string. (Pre-beta audit P2.)
    const safeFreq = (e.freq || '').replace(/[^0-9.]/g, '') || '0';
    return [
      `  {`,
      `    name        = "${e.airbaseName}",`,
      `    displayName = "${displayName.replace(/"/g, '\\"')}",`,
      `    initials    = "${initials.replace(/"/g, '\\"')}",`,
      `    freq        = "${safeFreq}",`,
      `    modulation  = "${e.modulation}",`,
      `    coalition   = ${e.coalition},`,
      `    runways     = ${rwyLua},`,
      `    elevation   = ${elev},`,
      `  },`,
    ].join('\n');
  });

  return [
    '-- ══════════════════════════════════════════════════════════════',
    '-- SRS ATIS — Auto-generated by DCS:OPT',
    '-- STTS.lua DO_SCRIPT_FILE trigger is auto-added at TIME > 1s',
    '-- Requires: DCS-SRS-ExternalAudio.exe (ships with SRS)',
    '-- Requires: os/io desanitized in MissionScripting.lua',
    '-- ══════���═══════════════════════════��═══════════════════════════',
    '',
    'local ATIS_STATIONS = {',
    ...configs.map((c) => c),
    '}',
    '',
    'local ATIS_VOICE = {',
    '  speed   = 0.9,',
    '  gender  = "female",',
    '  culture = "en-US",',
    '  google  = false,',
    '}',
    '',
    'local ATIS_INTERVAL = 30  -- seconds between broadcasts',
    '',
    'local PHONETIC = {"Alpha","Bravo","Charlie","Delta","Echo","Foxtrot","Golf",',
    '  "Hotel","India","Juliet","Kilo","Lima","Mike","November","Oscar","Papa",',
    '  "Quebec","Romeo","Sierra","Tango","Uniform","Victor","Whiskey","X-ray",',
    '  "Yankee","Zulu"}',
    '',
    'local function getInfoLetter()',
    '  return PHONETIC[math.floor(timer.getAbsTime() / 1800) % 26 + 1]',
    'end',
    '',
    'local function getActiveRunway(runways, windDir)',
    '  if not runways or #runways == 0 then return nil end',
    '  local best, bestDiff = nil, 999',
    '  for _, rwy in ipairs(runways) do',
    '    local diff = math.abs(((windDir - rwy) + 180) % 360 - 180)',
    '    if diff < bestDiff then bestDiff = diff; best = rwy end',
    '  end',
    '  return best',
    'end',
    '',
    'local function buildAtis(cfg, pos)',
    '  local alt = cfg.elevation or 0',
    '',
    '  local wind = atmosphere.getWind({ x = pos.x, y = alt + 10, z = pos.z })',
    '  local windSpd = math.sqrt(wind.x * wind.x + wind.z * wind.z)',
    '  local windDir = math.deg(math.atan2(wind.z, wind.x))',
    '  windDir = (windDir + 180) % 360',
    '  windDir = math.floor((windDir + 5) / 10) * 10',
    '  if windDir == 0 then windDir = 360 end',
    '  local windKts = math.floor(windSpd * 1.94384 + 0.5)',
    '',
    '  local temp, pressure = atmosphere.getTemperatureAndPressure({',
    '    x = pos.x, y = alt, z = pos.z',
    '  })',
    '  local tempC = math.floor(temp - 273.15)',
    '  local qnh = math.floor(pressure / 100 + 0.5)',
    '  local inhg = string.format("%.2f", pressure / 3386.39)',
    '',
    '  local wx = env.mission.weather',
    '  local clouds = wx.clouds or {}',
    '  local baseFt = math.floor((clouds.base or 0) * 3.281)',
    '  local density = clouds.density or 0',
    '  local vis = (wx.visibility and wx.visibility.distance) or 9999',
    '',
    '  local skyStr',
    '  if density <= 0 then skyStr = "Sky clear"',
    '  elseif density <= 2 then skyStr = string.format("Few clouds at %d feet", baseFt)',
    '  elseif density <= 4 then skyStr = string.format("Scattered clouds at %d feet", baseFt)',
    '  elseif density <= 7 then skyStr = string.format("Broken clouds at %d feet", baseFt)',
    '  else skyStr = string.format("Overcast at %d feet", baseFt) end',
    '',
    '  local fogStr = ""',
    '  if wx.fog and wx.fog.visibility and wx.fog.visibility < 6000 then',
    '    fogStr = string.format(" Fog, visibility %d meters.", wx.fog.visibility)',
    '  end',
    '',
    '  local precip = ""',
    '  local cp = clouds.iprecptns or 0',
    '  if cp == 1 then precip = " Rain in the area."',
    '  elseif cp == 2 then precip = " Thunderstorm activity." end',
    '',
    '  local info = getInfoLetter()',
    '  local rwy = getActiveRunway(cfg.runways, windDir)',
    '  local rwyStr = ""',
    '  if rwy then rwyStr = string.format(" Active runway %02d.", math.floor(rwy / 10 + 0.5)) end',
    '',
    '  local windStr',
    '  if windKts < 1 then windStr = "Wind calm"',
    '  elseif windKts < 4 then windStr = string.format("Wind variable at %d knots", windKts)',
    '  else windStr = string.format("Wind %03d at %d knots", windDir, windKts) end',
    '',
    '  return string.format(',
    '    "%s ATIS information %s. %s. " ..',
    '    "Visibility %d meters. %s.%s%s%s " ..',
    '    "Temperature %d celsius, dewpoint %d. " ..',
    '    "Altimeter %s inches, Q N H %d hectopascals. " ..',
    '    "Advise on initial contact you have information %s.",',
    '    cfg.name, info, windStr,',
    '    vis, skyStr, precip, fogStr, rwyStr,',
    '    tempC, tempC - 8,',
    '    inhg, qnh,',
    '    info',
    '  )',
    'end',
    '',
    'local function broadcastStation(cfg)',
    '  local ab = Airbase.getByName(cfg.name)',
    '  if not ab then',
    '    env.info("[ATIS] Airbase not found: " .. cfg.name)',
    '    return',
    '  end',
    '  local pos = ab:getPoint()',
    '',
    '  local ok, msg = pcall(buildAtis, cfg, pos)',
    '  if not ok then',
    '    env.info("[ATIS] Error at " .. cfg.name .. ": " .. tostring(msg))',
    '    return',
    '  end',
    '',
    '  STTS.TextToSpeech(',
    '    msg, cfg.freq, cfg.modulation, "1.0",',
    '    cfg.name .. " ATIS", cfg.coalition,',
    '    pos,',
    '    ATIS_VOICE.speed, ATIS_VOICE.gender, ATIS_VOICE.culture,',
    '    nil, ATIS_VOICE.google',
    '  )',
    '',
    '  env.info(string.format("[ATIS] %s — Info %s on %s %s",',
    '    cfg.name, getInfoLetter(), cfg.freq, cfg.modulation))',
    'end',
    '',
    '-- Broadcast loop for all stations',
    'local function atisLoop(_, t)',
    '  for _, cfg in ipairs(ATIS_STATIONS) do',
    '    local ok2, err2 = pcall(broadcastStation, cfg)',
    '    if not ok2 then env.info("[ATIS] Station error: " .. tostring(err2)) end',
    '  end',
    '  return t + ATIS_INTERVAL',
    'end',
    '',
    'timer.scheduleFunction(atisLoop, nil, timer.getTime() + 5)',
    `env.info("[ATIS] Initialized ${active.length} station(s)")`,
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function AtisConfigTab() {
  const airbases = useMissionStore((s) => s.airbases);
  const sessionId = useMissionStore((s) => s.sessionId);
  const rules = useTriggerStore((s) => s.rules);
  const [entries, setEntries] = useState<AtisEntry[]>([]);
  const [added, setAdded] = useState(false);

  // Get sorted airbases with ATIS data available
  const airbaseOptions = useMemo(() => {
    return [...airbases]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((ab) => {
        const comms = getAirbaseComms(ab.name);
        return { name: ab.name, coalition: ab.coalition, comms };
      });
  }, [airbases]);

  const handleAddAirbase = useCallback((name: string) => {
    if (entries.some((e) => e.airbaseName === name)) return;
    const { freq, source } = atisForAirbase(name);
    setEntries((prev) => [...prev, {
      airbaseName: name,
      displayName: name,                  // user can override to prettier form
      initials: defaultInitials(name),    // user can override to ICAO
      freq: freq.toFixed(3),
      modulation: 'AM',
      coalition: 0,
      enabled: true,
      freqSource: source,
    }]);
    setAdded(false);
  }, [entries]);

  /** Restore the freq column to whatever atisForAirbase() returns —
   *  DB-known if available, suggested otherwise. Useful when a user
   *  edited the freq and wants to revert. */
  const handleResetFreq = useCallback((name: string) => {
    const { freq, source } = atisForAirbase(name);
    setEntries((prev) => prev.map((e) =>
      e.airbaseName === name
        ? { ...e, freq: freq.toFixed(3), freqSource: source }
        : e,
    ));
    setAdded(false);
  }, []);

  const handleRemove = useCallback((name: string) => {
    setEntries((prev) => prev.filter((e) => e.airbaseName !== name));
    setAdded(false);
  }, []);

  const handleUpdate = useCallback((name: string, updates: Partial<AtisEntry>) => {
    setEntries((prev) => prev.map((e) => e.airbaseName === name ? { ...e, ...updates } : e));
    setAdded(false);
  }, []);

  const script = useMemo(() => generateAtisScript(entries), [entries]);
  const activeCount = entries.filter((e) => e.enabled).length;

  const handleAddToTriggers = useCallback(async () => {
    if (!sessionId || activeCount === 0) return;

    try {
      // Load current triggers from backend
      const data = await getTriggers(sessionId);
      const currentRules = data.rules || [];
      let nextId = currentRules.reduce((max: number, r: { id: number }) => Math.max(max, r.id), 0);

      const newRules = [...currentRules];

      // Auto-add STTS.lua DO_SCRIPT_FILE trigger if not already present
      const hasStts = currentRules.some((r: { actions: { type: string; params: Record<string, unknown> }[] }) =>
        r.actions?.some((a) =>
          a.type === 'DO_SCRIPT_FILE' && typeof a.params.file === 'string' &&
          a.params.file.toLowerCase().includes('stts')
        )
      );

      if (!hasStts) {
        nextId += 1;
        newRules.push({
          id: nextId,
          name: 'STTS.lua (SRS)',
          enabled: true,
          oneTime: false,
          eventType: 'once' as const,
          conditions: [{ type: 'TIME_MORE_THAN', params: { seconds: 1 } }],
          actions: [{ type: 'DO_SCRIPT_FILE', params: { file: 'STTS.lua' } }],
        });
      }

      // Create the ATIS rule
      nextId += 1;
      const atisRule = {
        id: nextId,
        name: `SRS ATIS (${activeCount} station${activeCount !== 1 ? 's' : ''})`,
        enabled: true,
        oneTime: false,
        eventType: 'once' as const,
        conditions: [{ type: 'TIME_MORE_THAN', params: { seconds: 2 } }],
        actions: [{ type: 'DO_SCRIPT', params: { lua: script } }],
      };

      newRules.push(atisRule);

      // Save back to backend
      await saveTriggers(sessionId, { rules: newRules });

      // Update local store so TriggerTab reflects the change
      useTriggerStore.getState().replaceRulesAfterSave(newRules, atisRule.id);

      setAdded(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Failed to add ATIS trigger: ${msg}`);
    }
  }, [sessionId, script, activeCount]);

  // Check if ATIS trigger already exists
  const existingAtis = rules.some((r) => r.name.startsWith('SRS ATIS'));

  return (
    <div style={{ maxWidth: 700 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: '#e0e0e0', marginBottom: 4 }}>
        ATIS Configurator
      </h2>
      <p style={{ fontSize: 12, color: '#aaaaaa', marginBottom: 16 }}>
        Configure SRS ATIS broadcasts for airbases.
        A <strong style={{ color: '#e0e0e0' }}>STTS.lua</strong> DO_SCRIPT_FILE trigger will be added automatically if not already present.
      </p>

      {existingAtis && !added && (
        <div style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 4,
          background: 'rgba(210, 153, 34, 0.1)', border: '1px solid rgba(210, 153, 34, 0.3)',
          fontSize: 12, color: '#d29922',
        }}>
          An SRS ATIS trigger already exists. Adding another will create a duplicate.
        </div>
      )}

      {/* Airbase selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select
          id="atis-airbase-select"
          style={{ ...selectStyle, flex: 1 }}
          defaultValue=""
          onChange={(e) => { if (e.target.value) { handleAddAirbase(e.target.value); e.target.value = ''; } }}
        >
          <option value="" disabled>+ Add airbase...</option>
          {airbaseOptions
            .filter((ab) => !entries.some((e) => e.airbaseName === ab.name))
            .map((ab) => (
              <option key={ab.name} value={ab.name}>
                {ab.name} {ab.comms?.atis ? `(ATIS ${ab.comms.atis.toFixed(1)})` : '(no default ATIS)'}
              </option>
            ))}
        </select>
      </div>

      {/* Configured stations */}
      {entries.length === 0 && (
        <div style={{
          padding: '24px 16px', background: 'rgba(74, 143, 212, 0.04)',
          borderRadius: 6, border: '1px solid #4a4a4a', textAlign: 'center',
          color: '#aaaaaa', fontSize: 13,
        }}>
          No ATIS stations configured. Select an airbase above to add one.
        </div>
      )}

      {entries.map((entry) => {
        const comms = getAirbaseComms(entry.airbaseName);
        return (
          <div key={entry.airbaseName} style={{
            ...cardStyle,
            opacity: entry.enabled ? 1 : 0.5,
            borderColor: entry.enabled ? '#4a4a4a' : '#222222',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  onChange={(e) => handleUpdate(entry.airbaseName, { enabled: e.target.checked })}
                  style={checkboxStyle}
                />
                <strong style={{ color: '#e0e0e0', fontSize: 14 }}>
                  {entry.displayName || entry.airbaseName}
                </strong>
                {entry.initials && entry.initials !== entry.airbaseName.slice(0, entry.initials.length).toUpperCase() && (
                  <span style={{ fontSize: 11, color: '#fbb941',
                                 fontFamily: "'B612 Mono', monospace",
                                 letterSpacing: 0.5 }}>{entry.initials}</span>
                )}
                {comms?.runways && (
                  <span style={{ fontSize: 11, color: '#aaaaaa' }}>RWY {comms.runways}</span>
                )}
                {comms?.elevation != null && (
                  <span style={{ fontSize: 11, color: '#aaaaaa' }}>{comms.elevation}ft</span>
                )}
              </div>
              <button style={btnDanger} onClick={() => handleRemove(entry.airbaseName)}>Remove</button>
            </div>

            {/* Spoken/printed name + ICAO row — both backfill from
                airbaseName when missing so existing saved entries still
                render. Wide inputs so long names like 'Krasnodar
                Pashkovsky International' or 'Sukhumi-Babushara' fit. */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center',
                          flexWrap: 'wrap', marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: '#aaaaaa',
                              display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 280 }}>
                Spoken name:
                <input
                  type="text"
                  value={entry.displayName ?? entry.airbaseName}
                  onChange={(e) => handleUpdate(entry.airbaseName, { displayName: e.target.value })}
                  style={{ ...inputStyle, flex: 1, minWidth: 200 }}
                  title="Used in the ATIS broadcast text and the brief"
                />
              </label>
              <label style={{ fontSize: 11, color: '#aaaaaa',
                              display: 'flex', alignItems: 'center', gap: 4 }}>
                Initials / ICAO:
                <input
                  type="text"
                  value={entry.initials ?? defaultInitials(entry.airbaseName)}
                  onChange={(e) => handleUpdate(entry.airbaseName, { initials: e.target.value.toUpperCase() })}
                  maxLength={6}
                  style={{ ...inputStyle, width: 90, fontFamily: "'B612 Mono', monospace" }}
                  title="Short identifier (ICAO or squadron code)"
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, color: '#aaaaaa', display: 'flex', alignItems: 'center', gap: 4 }}>
                Freq (MHz):
                <input
                  type="text"
                  value={entry.freq}
                  onChange={(e) => handleUpdate(entry.airbaseName, {
                    freq: e.target.value,
                    // Once a user types in the box the value is no longer
                    // "from the database" or "auto-suggested" — track it
                    // so the badge + Reset button mean what they say.
                    freqSource: 'custom',
                  })}
                  style={{ ...inputStyle, width: 80 }}
                />
                <FreqSourceBadge source={entry.freqSource ?? 'custom'} />
                {entry.freqSource !== 'db' && (
                  <button
                    onClick={() => handleResetFreq(entry.airbaseName)}
                    title="Restore the database / suggested frequency"
                    style={{
                      background: 'transparent',
                      border: '1px solid #3a3a3a',
                      borderRadius: 3,
                      color: '#aaaaaa',
                      cursor: 'pointer',
                      fontSize: 10,
                      padding: '2px 6px',
                      fontFamily: 'inherit',
                    }}
                  >
                    Reset
                  </button>
                )}
              </label>

              <label style={{ fontSize: 11, color: '#aaaaaa', display: 'flex', alignItems: 'center', gap: 4 }}>
                Mod:
                <select
                  value={entry.modulation}
                  onChange={(e) => handleUpdate(entry.airbaseName, { modulation: e.target.value as 'AM' | 'FM' })}
                  style={selectStyle}
                >
                  <option value="AM">AM</option>
                  <option value="FM">FM</option>
                </select>
              </label>

              <label style={{ fontSize: 11, color: '#aaaaaa', display: 'flex', alignItems: 'center', gap: 4 }}>
                Coalition:
                <select
                  value={entry.coalition}
                  onChange={(e) => handleUpdate(entry.airbaseName, { coalition: Number(e.target.value) as 0 | 1 | 2 })}
                  style={selectStyle}
                >
                  <option value={0}>All</option>
                  <option value={1}>Red</option>
                  <option value={2}>Blue</option>
                </select>
              </label>
            </div>
          </div>
        );
      })}

      {/* Add to Triggers button */}
      {entries.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            style={added ? { ...btnSuccess, opacity: 0.6, cursor: 'default' } : btnSuccess}
            onClick={handleAddToTriggers}
            disabled={added || activeCount === 0}
          >
            {added ? 'Added to Triggers' : `Add ATIS to Triggers (${activeCount} station${activeCount !== 1 ? 's' : ''})`}
          </button>
          {added && (
            <span style={{ fontSize: 12, color: '#3fb950' }}>
              Go to Miz Edit &gt; Triggers to see the generated script
            </span>
          )}
        </div>
      )}

      {/* Script preview */}
      {entries.length > 0 && activeCount > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ fontSize: 12, color: '#aaaaaa', cursor: 'pointer' }}>
            Preview generated script ({script.split('\n').length} lines)
          </summary>
          <pre style={{
            marginTop: 8, padding: 12, background: '#060d14', borderRadius: 4,
            border: '1px solid #4a4a4a', fontSize: 10, color: '#cccccc',
            overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap',
          }}>
            {script}
          </pre>
        </details>
      )}
    </div>
  );
}
