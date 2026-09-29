/**
 * AEGIS IADS setup-script generator.
 *
 * The AEGIS panel used to stop at renaming groups: the bundled engine got a
 * DO SCRIPT FILE load, but nothing ever called `AEGIS:New(side, {...})` or
 * `:Activate()`, and every IADS group had been flipped to late activation
 * with nothing to activate it. Net result: no IADS in game. This module
 * builds the missing per-coalition setup script.
 *
 * All of this runs ONCE at mission start. It adds no per-tick server work —
 * the engine's own poll loop is unchanged.
 *
 * Defaults below MIRROR the constants in
 * backend/assets/scripts/aegis-iads-v0.8.4-beta.lua (the bundled engine,
 * v0.8.4-beta+opt.1 — includes the DCS:OPT min-range / AGL-floor fixes).
 * Only keys that differ from the engine default are emitted, so the script
 * stays short and a future engine default change still takes effect.
 */

export type AegisOptionValue = number | boolean | string;

export interface AegisOptionDef {
  key: string;
  label: string;
  group: 'Core' | 'EMCON' | 'HARM reaction' | 'Alert' | 'EA / jamming';
  default: AegisOptionValue;
  unit?: string;
  help?: string;
  /** shown in the main form; everything else lives under Advanced */
  primary?: boolean;
  choices?: string[];
}

export const AEGIS_OPTIONS: AegisOptionDef[] = [
  // Core
  { key: 'defaultZone', label: 'Default engagement zone', group: 'Core', default: 'WEZ', choices: ['WEZ', 'NEZ'], primary: true,
    help: 'WEZ = shoot at max range. NEZ = hold fire until the no-escape zone (ambush). Per-site -NEZ/-WEZ suffixes override.' },
  { key: 'altFloorAGL', label: 'Altitude floor is AGL', group: 'Core', default: true, primary: true,
    help: 'Engine fix (v0.8.4+opt.1): SAM minimum altitude measured above the ground, not sea level. Off = old MSL behaviour, where terrain height counted against low flyers.' },
  { key: 'minRangeEnabled', label: 'Minimum-range dead zone', group: 'Core', default: true, primary: true,
    help: 'Engine fix (v0.8.4+opt.1): a dark site will not wake up for a target inside its minimum range. Sites already hot keep tracking it.' },
  { key: 'ewPollInterval', label: 'EW poll interval', group: 'Core', default: 10, unit: 's',
    help: 'How often each sector reads its EW picture. Lower = faster cueing, more server work.' },
  { key: 'alertTimeout', label: 'Alert timeout', group: 'Core', default: 60, unit: 's' },
  { key: 'autoAssociateRange', label: 'EW→SAM association range', group: 'Core', default: 40, unit: 'NM' },
  { key: 'pdAssociateRange', label: 'PD→parent association range', group: 'Core', default: 5, unit: 'NM' },
  { key: 'ewDetectionRange', label: 'EW detection cap (all EW)', group: 'Core', default: 0, unit: 'NM',
    help: '0 = no cap (DCS radar model decides). Per-site -DET suffix overrides.' },
  // EMCON
  { key: 'emconOnMin', label: 'Silent phase min', group: 'EMCON', default: 30, unit: 's', primary: true },
  { key: 'emconOnMax', label: 'Silent phase max', group: 'EMCON', default: 120, unit: 's', primary: true },
  { key: 'emconOffMin', label: 'Sweep phase min', group: 'EMCON', default: 15, unit: 's' },
  { key: 'emconOffMax', label: 'Sweep phase max', group: 'EMCON', default: 45, unit: 's' },
  { key: 'emconDetectDelay', label: 'Detect delay after radar on', group: 'EMCON', default: 5, unit: 's' },
  { key: 'emconReengageMin', label: 'Re-enter EMCON min', group: 'EMCON', default: 10, unit: 's' },
  { key: 'emconReengageMax', label: 'Re-enter EMCON max', group: 'EMCON', default: 30, unit: 's' },
  { key: 'emconStartupJitter', label: 'Startup jitter', group: 'EMCON', default: 60, unit: 's' },
  { key: 'emconDoubleSweepPct', label: 'Double-sweep chance', group: 'EMCON', default: 15, unit: '%' },
  { key: 'emconEarlyTermPct', label: 'Quick-peek chance', group: 'EMCON', default: 20, unit: '%' },
  { key: 'emconThreatScale', label: 'Silent scale after threat seen', group: 'EMCON', default: 0.5, unit: '×' },
  { key: 'emconRelaxedScale', label: 'Silent scale after empty sweeps', group: 'EMCON', default: 1.5, unit: '×' },
  { key: 'emconSpookEnabled', label: 'Neighbour spook', group: 'EMCON', default: false, primary: true,
    help: 'A SAM dying makes nearby sites go quiet for a while.' },
  { key: 'emconSpookDuration', label: 'Spook duration', group: 'EMCON', default: 120, unit: 's' },
  // HARM
  { key: 'harmReactionDelayMin', label: 'Crew reaction min', group: 'HARM reaction', default: 6, unit: 's' },
  { key: 'harmReactionDelayMax', label: 'Crew reaction max', group: 'HARM reaction', default: 9, unit: 's' },
  { key: 'harmCooldownMin', label: 'Go-dark min', group: 'HARM reaction', default: 45, unit: 's', primary: true },
  { key: 'harmCooldownMax', label: 'Go-dark max', group: 'HARM reaction', default: 90, unit: 's', primary: true },
  { key: 'harmMaxCooldown', label: 'Go-dark hard cap', group: 'HARM reaction', default: 180, unit: 's' },
  { key: 'harmStayHotDuration', label: 'Self-protect stay-hot window', group: 'HARM reaction', default: 30, unit: 's' },
  { key: 'harmLastDitchMin', label: 'PD last-ditch min', group: 'HARM reaction', default: 8, unit: 's' },
  { key: 'harmLastDitchMax', label: 'PD last-ditch max', group: 'HARM reaction', default: 12, unit: 's' },
  { key: 'harmPanicPct', label: 'Self-protect panic chance', group: 'HARM reaction', default: 15, unit: '%' },
  { key: 'harmBraveryPct', label: 'Stay-hot bravery chance', group: 'HARM reaction', default: 5, unit: '%' },
  { key: 'harmMultiThresholdMin', label: 'Saturation threshold min', group: 'HARM reaction', default: 4, unit: 'ARMs' },
  { key: 'harmMultiThresholdMax', label: 'Saturation threshold max', group: 'HARM reaction', default: 8, unit: 'ARMs' },
  { key: 'harmMultiWindow', label: 'Saturation window', group: 'HARM reaction', default: 15, unit: 's' },
  { key: 'harmDetectionRange', label: 'ARM detection range', group: 'HARM reaction', default: 40, unit: 'NM' },
  // Alert
  { key: 'alertFrustrationMin', label: 'Frustration drop-out min', group: 'Alert', default: 30, unit: 's' },
  { key: 'alertFrustrationMax', label: 'Frustration drop-out max', group: 'Alert', default: 60, unit: 's' },
  { key: 'alertFrustrationStayPct', label: 'Stays hot anyway chance', group: 'Alert', default: 10, unit: '%' },
  // EA
  { key: 'eaEnabled', label: 'EA jammer framework', group: 'EA / jamming', default: true, primary: true,
    help: 'Scans the opposing side for EA- named aircraft groups.' },
  { key: 'hojEnabled', label: 'Home-on-jam', group: 'EA / jamming', default: true, primary: true },
  { key: 'hojBasePct', label: 'HOJ base chance per peek', group: 'EA / jamming', default: 0.07, unit: 'p' },
  { key: 'hojWindowMin', label: 'HOJ window min', group: 'EA / jamming', default: 75, unit: 's' },
  { key: 'hojWindowMax', label: 'HOJ window max', group: 'EA / jamming', default: 120, unit: 's' },
  { key: 'hojCooldown', label: 'HOJ cooldown', group: 'EA / jamming', default: 60, unit: 's' },
  { key: 'jamDetectionDelayMin', label: 'Jam detection min', group: 'EA / jamming', default: 1, unit: 's' },
  { key: 'jamDetectionDelayMax', label: 'Jam detection max', group: 'EA / jamming', default: 3, unit: 's' },
  { key: 'eaEmitterMemory', label: 'Emitter memory', group: 'EA / jamming', default: 60, unit: 's' },
];

const DEFAULTS: Record<string, AegisOptionValue> =
  Object.fromEntries(AEGIS_OPTIONS.map((o) => [o.key, o.default]));

export type AegisPresetId = 'default' | 'training' | 'hard';

/** Starting points, not doctrine — every value stays editable afterwards. */
export const AEGIS_PRESETS: Record<AegisPresetId, { label: string; help: string; values: Record<string, AegisOptionValue> }> = {
  default: { label: 'Engine defaults', help: 'The bundled AEGIS v0.8.4 tuning.', values: {} },
  training: {
    label: 'Training (forgiving)',
    help: 'Longer silences, longer go-dark after HARM, no home-on-jam. For new SEAD flyers.',
    values: { emconOnMin: 60, emconOnMax: 180, harmCooldownMin: 60, harmCooldownMax: 120, harmPanicPct: 30, harmBraveryPct: 0, hojEnabled: false },
  },
  hard: {
    label: 'Hard (disciplined crews)',
    help: 'Shorter silences, quicker back on air after HARM, neighbour spook on.',
    values: { emconOnMin: 20, emconOnMax: 75, harmCooldownMin: 30, harmCooldownMax: 60, harmPanicPct: 5, harmBraveryPct: 10, alertFrustrationMin: 60, alertFrustrationMax: 120, emconSpookEnabled: true },
  },
};

export interface AegisScriptOptions {
  debug: boolean;
  /** AddF10Menu uses missionCommands (EVERY player, both sides) — it hands the
   *  opposing coalition this side's IADS status. Mission-maker testing only. */
  f10Menu: boolean;
  /** StartMapDebug paints every site on the F10 map for everyone — dev only. */
  mapDebug: boolean;
}

export const DEFAULT_SCRIPT_OPTIONS: AegisScriptOptions = { debug: false, f10Menu: false, mapDebug: false };

export function presetValues(id: AegisPresetId): Record<string, AegisOptionValue> {
  return { ...DEFAULTS, ...AEGIS_PRESETS[id].values };
}

/** Keys whose value differs from the engine default (what gets emitted). */
export function changedOptions(values: Record<string, AegisOptionValue>): [string, AegisOptionValue][] {
  return AEGIS_OPTIONS
    .filter((o) => values[o.key] !== undefined && values[o.key] !== o.default)
    .map((o) => [o.key, values[o.key]]);
}

function luaString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

function luaValue(v: AegisOptionValue): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  return luaString(v);
}

/** Min/max pairs the engine feeds to math.random — min > max errors in Lua. */
const RANGE_PAIRS: [string, string][] = [
  ['emconOnMin', 'emconOnMax'], ['emconOffMin', 'emconOffMax'],
  ['emconReengageMin', 'emconReengageMax'], ['harmReactionDelayMin', 'harmReactionDelayMax'],
  ['harmCooldownMin', 'harmCooldownMax'], ['harmLastDitchMin', 'harmLastDitchMax'],
  ['harmMultiThresholdMin', 'harmMultiThresholdMax'], ['alertFrustrationMin', 'alertFrustrationMax'],
  ['hojWindowMin', 'hojWindowMax'], ['jamDetectionDelayMin', 'jamDetectionDelayMax'],
];

/** Human-readable problems with a value set (empty = OK to emit). */
export function validateOptions(values: Record<string, AegisOptionValue>): string[] {
  const errs: string[] = [];
  for (const [lo, hi] of RANGE_PAIRS) {
    const a = values[lo], b = values[hi];
    if (typeof a === 'number' && typeof b === 'number' && a > b) {
      const la = AEGIS_OPTIONS.find((o) => o.key === lo)?.label ?? lo;
      errs.push(`${la} (${a}) is greater than its max (${b})`);
    }
  }
  for (const o of AEGIS_OPTIONS) {
    const v = values[o.key];
    if (typeof o.default === 'number' && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
      errs.push(`${o.label} must be a number ≥ 0`);
    }
  }
  return errs;
}

export interface AegisSetupInput {
  side: 'red' | 'blue';
  /** Every AEGIS-named group on this side — activated before AEGIS starts. */
  groupNames: string[];
  /** Explicit PD → parent SAM links (auto-association handles the rest). */
  pdLinks: { pd: string; parent: string }[];
  values: Record<string, AegisOptionValue>;
  script: AegisScriptOptions;
}

/** Name of the trigger rule carrying the setup for one side. */
export function aegisSetupRuleName(side: string): string {
  return `AEGIS Setup (${side})`;
}

export function buildAegisSetupLua(input: AegisSetupInput): string {
  const { side, groupNames, pdLinks, values, script } = input;
  const opts = changedOptions(values);
  if (script.debug) opts.push(['debug', true]);
  const cfg = opts.length
    ? '{\n' + opts.map(([k, v]) => `      ${k} = ${luaValue(v)},`).join('\n') + '\n    }'
    : '{}';
  const names = groupNames.map((n) => `    ${luaString(n)},`).join('\n');
  const links = pdLinks.map((l) => `    iads:AddPointDefense(${luaString(l.pd)}, ${luaString(l.parent)})`).join('\n');

  return [
    `-- ${aegisSetupRuleName(side)} - generated by DCS:OPT. Re-apply the AEGIS panel to regenerate.`,
    `-- Runs once. Activates the IADS groups (the panel sets them to late activation)`,
    `-- then starts AEGIS one second later so the groups exist when it scans.`,
    `do`,
    `  if not AEGIS then`,
    `    env.error("[AEGIS setup] AEGIS engine not loaded - check the AEGIS IADS DO SCRIPT FILE trigger")`,
    `    return`,
    `  end`,
    `  local names = {`,
    names,
    `  }`,
    `  for _, n in ipairs(names) do`,
    `    local g = Group.getByName(n)`,
    `    if g then`,
    `      g:activate()`,
    `      pcall(function() g:enableEmission(false) end)`,
    `    else`,
    `      env.warning("[AEGIS setup] group not found: " .. n)`,
    `    end`,
    `  end`,
    `  timer.scheduleFunction(function()`,
    `    local iads = AEGIS:New(${luaString(side)}, ${cfg})`,
    `    if not iads then return end`,
    ...(links ? [links] : []),
    `    iads:Activate()`,
    ...(script.f10Menu ? [`    iads:AddF10Menu()`] : []),
    ...(script.mapDebug ? [`    iads:StartMapDebug(15)`] : []),
    `  end, nil, timer.getTime() + 1)`,
    `end`,
    '',
  ].join('\n');
}
