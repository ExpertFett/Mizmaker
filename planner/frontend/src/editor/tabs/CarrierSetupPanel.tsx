import { useState, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import { isCarrierGroup } from '../../utils/groups';
import type { MissionGroup } from '../../types/mission';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface CarrierConfig {
  groupId: number;
  groupName: string;
  unitType: string;
  coalition: string;
  /** Short label for menus and messages: "CVN", "LHA", etc. */
  label: string;
  /** Callsign / radio name: "Rough Rider", "Proud Eagle" */
  callsign: string;
  /** TACAN channel */
  tacanCh: number;
  /** TACAN band */
  tacanBand: string;
  /** TACAN callsign */
  tacanCallsign: string;
  /** ICLS channel (0 = N/A for LHA/LHD) */
  iclsCh: number;
  /** ACLS enabled */
  aclsEnabled: boolean;
  /** Has ICLS capability */
  hasIcls: boolean;
  /** TIW speed (kts) */
  tiwSpeed: number;
  /** Rescue helo group name (if found) */
  rescueHeloGroup: string;
  /** Rescue helo modex */
  rescueModex: number;
  /** USERFLAG base number for beacon/light triggers */
  flagBase: number;
}

/* ------------------------------------------------------------------ */
/* Known carrier data                                                  */
/* ------------------------------------------------------------------ */

interface HullData {
  label: string;
  callsign: string;
  tacan: number;
  /** Default ICLS channel for this hull (squadron SOP convention).
   *  0 / undefined = no ICLS (LHA, LHD, surface fleet). */
  icls?: number;
  tiwSpeed: number;
  hasIcls: boolean;
}

const HULL_DB: Record<string, HullData> = {
  // ICLS values follow common DCS squadron conventions (CSG-3 / Hornet
  // School SOP-style). The exact mapping varies between squadrons but
  // having a hull-specific default beats the old sequential 1, 2, 3...
  // assignment that ignored real-world conventions. When two carriers
  // in the same mission would share an ICLS, _detectIclsForCarrier()
  // (below) increments to avoid the conflict.
  'CVN-69':   { label: 'CVN', callsign: 'Ike',           tacan: 69, icls: 11, tiwSpeed: 25, hasIcls: true},
  'CVN-70':   { label: 'CVN', callsign: 'Golden Eagle',  tacan: 70, icls: 9,  tiwSpeed: 25, hasIcls: true},
  'CVN-71':   { label: 'CVN', callsign: 'Rough Rider',   tacan: 71, icls: 9,  tiwSpeed: 25, hasIcls: true},
  'CVN-72':   { label: 'CVN', callsign: 'Lucky Abe',     tacan: 72, icls: 7,  tiwSpeed: 25, hasIcls: true},
  'CVN-73':   { label: 'CVN', callsign: 'Blue Ghost',    tacan: 73, icls: 5,  tiwSpeed: 25, hasIcls: true},
  'CVN-74':   { label: 'CVN', callsign: 'Rough Rider',   tacan: 74, icls: 7,  tiwSpeed: 25, hasIcls: true},
  'CVN-75':   { label: 'CVN', callsign: 'Lone Warrior',  tacan: 75, icls: 11, tiwSpeed: 25, hasIcls: true},
  'CVN-76':   { label: 'CVN', callsign: 'Gipper',        tacan: 76, icls: 13, tiwSpeed: 25, hasIcls: true},
  'CVN-77':   { label: 'CVN', callsign: 'Avenger',       tacan: 77, icls: 13, tiwSpeed: 25, hasIcls: true},
  'CVN-78':   { label: 'CVN', callsign: 'Old Ironsides', tacan: 78, icls: 15, tiwSpeed: 25, hasIcls: true},
  'CVN-79':   { label: 'CVN', callsign: 'Big John',      tacan: 79, icls: 17, tiwSpeed: 25, hasIcls: true},
  stennis:    { label: 'CVN', callsign: 'Rough Rider',   tacan: 74, icls: 7,  tiwSpeed: 25, hasIcls: true},
  vinson:     { label: 'CVN', callsign: 'Golden Eagle',  tacan: 70, icls: 9,  tiwSpeed: 25, hasIcls: true},
  lincoln:    { label: 'CVN', callsign: 'Lucky Abe',     tacan: 72, icls: 7,  tiwSpeed: 25, hasIcls: true},
  washington: { label: 'CVN', callsign: 'Blue Ghost',    tacan: 73, icls: 5,  tiwSpeed: 25, hasIcls: true},
  roosevelt:  { label: 'CVN', callsign: 'Rough Rider',   tacan: 71, icls: 9,  tiwSpeed: 25, hasIcls: true},
  truman:     { label: 'CVN', callsign: 'Lone Warrior',  tacan: 75, icls: 11, tiwSpeed: 25, hasIcls: true},
  eisenhower: { label: 'CVN', callsign: 'Ike',           tacan: 69, icls: 11, tiwSpeed: 25, hasIcls: true},
  forrestal:  { label: 'CV',  callsign: 'Forrestal',     tacan: 59, icls: 1,  tiwSpeed: 25, hasIcls: true},
  tarawa:     { label: 'LHA', callsign: 'Proud Eagle',   tacan: 1,  icls: 0,  tiwSpeed: 10, hasIcls: false},
  'LHA-1':    { label: 'LHA', callsign: 'Proud Eagle',   tacan: 1,  icls: 0,  tiwSpeed: 10, hasIcls: false},
  wasp:       { label: 'LHD', callsign: 'Stinger',       tacan: 1,  icls: 0,  tiwSpeed: 10, hasIcls: false},
  'LHD-1':    { label: 'LHD', callsign: 'Stinger',       tacan: 1,  icls: 0,  tiwSpeed: 10, hasIcls: false},
};

function detectCarrierInfo(g: MissionGroup): Partial<CarrierConfig> {
  const name = g.groupName.toLowerCase();
  const utype = (g.units[0]?.type || '').toLowerCase();
  const combined = name + ' ' + utype;
  // Normalize separators: "CVN 73" and "CVN_73" both become "CVN-73" for matching
  const normalized = combined.replace(/[\s_]/g, '-');

  for (const [key, data] of Object.entries(HULL_DB)) {
    if (normalized.includes(key.toLowerCase())) {
      return {
        label: data.label,
        callsign: data.callsign,
        tacanCh: data.tacan,
        tacanCallsign: data.label,
        // Forward the canonical ICLS for this hull. The handleDetect
        // collision pass below dedups when a multi-carrier mission
        // would otherwise land two carriers on the same channel.
        iclsCh: data.icls,
        tiwSpeed: data.tiwSpeed,
        hasIcls: data.hasIcls,
        aclsEnabled: data.hasIcls,
      };
    }
  }

  // Dynamic extraction: if group name has "CVN <number>" but wasn't in HULL_DB
  const cvnMatch = normalized.match(/cvn-?(\d+)/);
  if (cvnMatch) {
    const hull = parseInt(cvnMatch[1], 10);
    return {
      label: 'CVN', callsign: 'Carrier', tacanCh: hull > 0 && hull <= 126 ? hull : 72,
      tacanCallsign: 'CVN', tiwSpeed: 25, hasIcls: true, aclsEnabled: true,
    };
  }

  // Fallback: detect type
  if (/lha|lhd|tarawa|wasp/i.test(combined)) {
    return { label: 'LHA', callsign: 'Eagle', tacanCh: 1, tacanCallsign: 'LHA', tiwSpeed: 10, hasIcls: false, aclsEnabled: false };
  }
  return { label: 'CVN', callsign: 'Carrier', tacanCh: 72, tacanCallsign: 'CVN', tiwSpeed: 25, hasIcls: true, aclsEnabled: true };
}

/* ------------------------------------------------------------------ */
/* Script generator                                                    */
/* ------------------------------------------------------------------ */

function generateMooseCarrierScript(configs: CarrierConfig[]): string {
  const lines: string[] = [
    '-- MOOSE Carrier Control Script (Auto-Generated)',
    '-- Requires: MOOSE framework loaded via DO_SCRIPT_FILE BEFORE this script',
    '-- Load order: TIME MORE > 2 (after Moose_.lua)',
    '',
    '_SETTINGS:SetPlayerMenuOff()',
    '',
  ];

  for (let ci = 0; ci < configs.length; ci++) {
    const c = configs[ci];
    const varName = c.label.replace(/[^A-Za-z0-9]/g, '') + (ci > 0 ? String(ci + 1) : '');
    const heloVar = `rescue_${varName}`;
    const fb = c.flagBase;

    lines.push(`-- ═══════════════════════════════════════════════════════════`);
    lines.push(`-- ${c.label} — "${c.callsign}" (Group: ${c.groupName})`);
    lines.push(`-- ═══════════════════════════════════════════════════════════`);
    lines.push('');

    // Rescue helo
    if (c.rescueHeloGroup) {
      lines.push(`local ${heloVar} = RESCUEHELO:New("${c.groupName}", "${c.rescueHeloGroup}")`);
      lines.push(`${heloVar}:SetModex(${c.rescueModex})`);
      lines.push(`${heloVar}:__Start(1)`);
      lines.push('');
    }

    // NAVYGROUP
    lines.push(`${varName} = NAVYGROUP:New("${c.groupName}")`);
    lines.push(`${varName}:Activate()`);
    lines.push('');

    // TIW functions
    const durations = [
      { min: 30, label: '30 minutes' },
      { min: 60, label: '60 minutes' },
      { min: 90, label: '90 minutes' },
      { min: 120, label: '2 hours' },
      { min: 240, label: '4 hours' },
      { min: 480, label: '8 hours' },
    ];

    // Stop TIW
    lines.push(`function ${varName}_stopTIW()`);
    lines.push(`  ${varName}:TurnIntoWindStop()`);
    lines.push(`  MESSAGE:New("99 ${c.callsign} recovery operations complete, returning to base course"):ToAll()`);
    lines.push('end');
    lines.push('');

    // Duration TIW functions
    for (const d of durations) {
      const fnName = `${varName}_tiw_${d.min}`;
      lines.push(`function ${fnName}()`);
      lines.push('  local timenow = timer.getAbsTime()');
      lines.push(`  local timeend = timenow + ${d.min} * 60`);
      lines.push('  local t_start = UTILS.SecondsToClock(timenow, false)');
      lines.push('  local t_end = UTILS.SecondsToClock(timeend, false)');
      lines.push(`  ${varName}:AddTurnIntoWind(t_start, t_end, ${c.tiwSpeed})`);
      lines.push(`  MESSAGE:New("99 ${c.callsign} Turning, at time " .. t_start .. " until " .. t_end):ToAll()`);
      lines.push('end');
      lines.push('');
    }

    // Beacon toggle functions (ICLS/LINK4/ACLS only for CVN types)
    const beacons = [
      { name: 'TACAN', offFlag: fb, onFlag: fb + 1 },
      ...(c.hasIcls ? [
        { name: 'ICLS', offFlag: fb + 2, onFlag: fb + 3 },
        { name: 'LINK 4', offFlag: fb + 4, onFlag: fb + 5 },
      ] : []),
      ...(c.aclsEnabled ? [
        { name: 'ACLS', offFlag: fb + 6, onFlag: fb + 7 },
      ] : []),
    ];

    for (const b of beacons) {
      lines.push(`function ${varName}_${b.name.replace(/\s/g, '')}_off()`);
      lines.push(`  USERFLAG:New('${b.offFlag}'):Set(true)`);
      lines.push(`  MESSAGE:New("${c.label} ${b.name} Deactivated", 30):ToAll()`);
      lines.push('end');
      lines.push(`function ${varName}_${b.name.replace(/\s/g, '')}_on()`);
      lines.push(`  USERFLAG:New('${b.onFlag}'):Set(true)`);
      lines.push(`  MESSAGE:New("${c.label} ${b.name} Restarted", 30):ToAll()`);
      lines.push('end');
      lines.push('');
    }

    // Light functions
    const lights = [
      { name: 'Off', flag: fb + 10 },
      { name: 'Auto', flag: fb + 11 },
      { name: 'Navigation', flag: fb + 12 },
      { name: 'Launch', flag: fb + 13 },
      { name: 'Recovery', flag: fb + 14 },
    ];

    for (const l of lights) {
      lines.push(`function ${varName}_lights_${l.name.toLowerCase()}()`);
      lines.push(`  USERFLAG:New('${l.flag}'):Set(true)`);
      lines.push(`  MESSAGE:New("${c.label} Lights Set To ${l.name}", 30):ToAll()`);
      lines.push('end');
    }
    lines.push('');
  }

  // ═══ Build F10 Menu Tree ═══
  lines.push('-- ═══════════════════════════════════════════════════════════');
  lines.push('-- F10 Radio Menu');
  lines.push('-- ═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('local TopMenu = MENU_COALITION:New(coalition.side.BLUE, "Carrier Menus")');
  lines.push('');

  for (let ci = 0; ci < configs.length; ci++) {
    const c = configs[ci];
    const varName = c.label.replace(/[^A-Za-z0-9]/g, '') + (ci > 0 ? String(ci + 1) : '');
    const menuVar = `Menu_${varName}`;

    lines.push(`-- ${c.label} menu`);
    lines.push(`local ${menuVar} = MENU_COALITION:New(coalition.side.BLUE, "${c.label}", TopMenu)`);

    // TIW submenu
    lines.push(`local ${menuVar}_tiw = MENU_COALITION:New(coalition.side.BLUE, "Turn Into Wind", ${menuVar})`);
    lines.push(`MENU_COALITION_COMMAND:New(coalition.side.BLUE, "Stop Recovery", ${menuVar}_tiw, ${varName}_stopTIW)`);
    for (const d of [30, 60, 90, 120, 240, 480]) {
      const label = d < 120 ? `${d} minutes` : `${d / 60} hours`;
      lines.push(`MENU_COALITION_COMMAND:New(coalition.side.BLUE, "TIW ${label}", ${menuVar}_tiw, ${varName}_tiw_${d})`);
    }

    // Beacons submenu
    const beaconList = ['TACAN'];
    if (c.hasIcls) { beaconList.push('ICLS'); beaconList.push('LINK4'); }
    if (c.aclsEnabled) beaconList.push('ACLS');

    lines.push(`local ${menuVar}_bcn = MENU_COALITION:New(coalition.side.BLUE, "Beacons", ${menuVar})`);
    for (const b of beaconList) {
      const bClean = b.replace(/\s/g, '');
      lines.push(`local ${menuVar}_${bClean} = MENU_COALITION:New(coalition.side.BLUE, "${b}", ${menuVar}_bcn)`);
      lines.push(`MENU_COALITION_COMMAND:New(coalition.side.BLUE, "Deactivate ${b}", ${menuVar}_${bClean}, ${varName}_${bClean}_off)`);
      lines.push(`MENU_COALITION_COMMAND:New(coalition.side.BLUE, "Restart ${b}", ${menuVar}_${bClean}, ${varName}_${bClean}_on)`);
    }

    // Lights submenu
    lines.push(`local ${menuVar}_lgt = MENU_COALITION:New(coalition.side.BLUE, "Lights", ${menuVar})`);
    for (const l of ['Off', 'Auto', 'Navigation', 'Launch', 'Recovery']) {
      lines.push(`MENU_COALITION_COMMAND:New(coalition.side.BLUE, "Lights ${l}", ${menuVar}_lgt, ${varName}_lights_${l.toLowerCase()})`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function CarrierSetupPanel() {
  const groups = useMissionStore((s) => s.groups);
  const addEdit = useEditStore((s) => s.addEdit);
  const [configs, setConfigs] = useState<CarrierConfig[]>([]);
  const [generated, setGenerated] = useState(false);
  const [scriptPreview, setScriptPreview] = useState(false);
  const [script, setScript] = useState('');
  const [copied, setCopied] = useState(false);

  // Detect carriers
  const carrierGroups = useMemo(() =>
    groups.filter((g) => isCarrierGroup(g)),
  [groups]);

  // Auto-detect configs when carriers change
  const handleDetect = useCallback(() => {
    const result: CarrierConfig[] = [];
    let flagBase = 1;

    // Track ICLS channels already assigned in this mission so two
    // carriers don't collide on the same channel. Real-world squadron
    // SOPs sometimes share ICLS between carriers (Stennis + Lincoln
    // both 7) but that only works when they're far apart. In a single
    // mission, deconflict.
    const usedIcls = new Set<number>();
    const nextFreeIcls = (preferred: number | undefined): number => {
      // Walk odd channels first (1, 3, 5, …, 19), then evens, until we
      // find one not in use. Odd-only is closer to the SOP convention
      // (5/7/9/11/13 are the canonical carrier channels).
      const candidates = preferred && preferred > 0
        ? [preferred, ...[1,3,5,7,9,11,13,15,17,19,2,4,6,8,10,12,14,16,18,20].filter((c) => c !== preferred)]
        : [1,3,5,7,9,11,13,15,17,19,2,4,6,8,10,12,14,16,18,20];
      for (const c of candidates) {
        if (!usedIcls.has(c)) return c;
      }
      return preferred || 1; // shouldn't reach here in any sane mission
    };

    for (const g of carrierGroups) {
      const info = detectCarrierInfo(g);
      const hasIcls = info.hasIcls ?? true;
      const iclsCh = hasIcls ? nextFreeIcls(info.iclsCh) : 0;
      if (iclsCh > 0) usedIcls.add(iclsCh);
      result.push({
        groupId: g.groupId,
        groupName: g.groupName,
        unitType: g.units[0]?.type || '',
        coalition: g.coalition,
        label: info.label || 'CVN',
        callsign: info.callsign || 'Carrier',
        tacanCh: info.tacanCh || 72,
        tacanBand: 'X',
        tacanCallsign: info.tacanCallsign || 'CVN',
        iclsCh,
        aclsEnabled: info.aclsEnabled ?? hasIcls,
        hasIcls,
        tiwSpeed: info.tiwSpeed || 25,
        rescueHeloGroup: '',
        rescueModex: 42,
        flagBase,
      });
      // ICLS already tracked in usedIcls above — no separate counter needed.
      flagBase += 20; // 20 flags per carrier
    }

    setConfigs(result);
    setGenerated(false);
  }, [carrierGroups]);

  // Update a config field
  const updateConfig = useCallback((groupId: number, field: keyof CarrierConfig, value: string | number) => {
    setConfigs((prev) => prev.map((c) =>
      c.groupId === groupId ? { ...c, [field]: value } : c
    ));
    setGenerated(false);
  }, []);

  // Generate script
  const handleGenerate = useCallback(() => {
    const lua = generateMooseCarrierScript(configs);
    setScript(lua);
    setGenerated(true);
    setScriptPreview(true);
  }, [configs]);

  // Copy to clipboard
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [script]);

  // Add to trigger library
  const handleAddToTriggers = useCallback(() => {
    addEdit({
      field: 'addTrigger',
      value: {
        name: 'Carrier Control (MOOSE)',
        lua: script,
        comment: `Auto-generated for: ${configs.map((c) => `${c.label} "${c.callsign}"`).join(', ')}`,
      },
    } as any);
  }, [addEdit, script, configs]);


  if (carrierGroups.length === 0) {
    return (
      <div style={{ color: '#aaaaaa', fontSize: 14, padding: 16 }}>
        No carrier groups (CVN, LHA, LHD) found in this mission.
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#4a8fd4', marginBottom: 4 }}>
            Carrier Control Setup
          </div>
          <div style={{ fontSize: 13, color: '#aaaaaa' }}>
            Configure carriers and generate a MOOSE carrier control script with F10 menus.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleDetect} style={btnStyle}>
            {configs.length > 0 ? 'Re-detect' : 'Detect Carriers'}
          </button>
          {configs.length > 0 && (
            <button onClick={handleGenerate} style={generateBtnStyle}>
              Generate Script
            </button>
          )}
        </div>
      </div>

      {/* Config cards */}
      {configs.length === 0 && (
        <div style={{ color: '#aaaaaa', fontSize: 13, padding: '10px 0' }}>
          Click "Detect Carriers" to scan the mission for carrier groups.
        </div>
      )}

      {configs.map((c) => (
        <div key={c.groupId} style={{
          marginBottom: 10, padding: '12px 14px',
          background: '#0a1218', borderRadius: 6, border: '1px solid #222222',
        }}>
          {/* Carrier header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{
              background: '#4a8fd4', color: '#1a1a1a', fontSize: 11, fontWeight: 700,
              padding: '2px 8px', borderRadius: 3,
            }}>
              {c.label}
            </span>
            <span style={{ color: '#aaaaaa', fontSize: 12 }}>{c.unitType}</span>
          </div>

          {/* Group name (read-only — use Renamer tab to change) */}
          <div style={{ marginBottom: 8 }}>
            <div style={fieldLabel}>Group Name</div>
            <div style={{ fontSize: 13, color: '#e0e0e0', padding: '5px 0' }}>
              {c.groupName}
              <span style={{ color: '#aaaaaa', fontSize: 11, marginLeft: 8 }}>
                (use Renamer tab to edit)
              </span>
            </div>
          </div>

          {/* Editable fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
            <Field label="Callsign / Radio Name" value={c.callsign}
              onChange={(v) => updateConfig(c.groupId, 'callsign', v)} />
            <Field label="Menu Label" value={c.label}
              onChange={(v) => updateConfig(c.groupId, 'label', v)} />
            <NumField label={`TACAN Channel (${c.tacanCh}X)`} value={c.tacanCh} min={1} max={126}
              onChange={(v) => updateConfig(c.groupId, 'tacanCh', v)} />
            <Field label="TACAN Callsign" value={c.tacanCallsign}
              onChange={(v) => updateConfig(c.groupId, 'tacanCallsign', v)} />
            {c.hasIcls ? (
              <NumField label="ICLS Channel" value={c.iclsCh} min={1} max={20}
                onChange={(v) => updateConfig(c.groupId, 'iclsCh', v)} />
            ) : (
              <div>
                <div style={fieldLabel}>ICLS</div>
                <div style={{ fontSize: 12, color: '#aaaaaa', padding: '5px 0' }}>N/A ({c.label})</div>
              </div>
            )}
            {c.hasIcls && (
              <div>
                <div style={fieldLabel}>ACLS</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '5px 0' }}>
                  <input type="checkbox" checked={c.aclsEnabled}
                    onChange={(e) => updateConfig(c.groupId, 'aclsEnabled', e.target.checked ? 1 : 0)}
                    style={{ accentColor: '#4a8fd4' }} />
                  <span style={{ fontSize: 13, color: c.aclsEnabled ? '#e0e0e0' : '#aaaaaa' }}>
                    {c.aclsEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
              </div>
            )}
            <NumField label="TIW Speed (kts)" value={c.tiwSpeed} min={5} max={35}
              onChange={(v) => updateConfig(c.groupId, 'tiwSpeed', v)} />
            <Field label="Rescue Helo Group" value={c.rescueHeloGroup}
              onChange={(v) => updateConfig(c.groupId, 'rescueHeloGroup', v)}
              placeholder="Leave blank if none" />
            <NumField label="Rescue Modex" value={c.rescueModex} min={0} max={999}
              onChange={(v) => updateConfig(c.groupId, 'rescueModex', v)} />
            <NumField label="Flag Base #" value={c.flagBase} min={1} max={9999}
              onChange={(v) => updateConfig(c.groupId, 'flagBase', v)} />
          </div>
        </div>
      ))}

      {/* Script preview */}
      {generated && (
        <div style={{
          marginTop: 12, padding: '12px 14px',
          background: '#0a1218', borderRadius: 6, border: '1px solid #222222',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#3fb950' }}>
              Script Generated
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setScriptPreview(!scriptPreview)} style={smallBtnStyle}>
                {scriptPreview ? 'Hide Preview' : 'Show Preview'}
              </button>
              <button onClick={handleCopy} style={{ ...smallBtnStyle, color: copied ? '#3fb950' : '#4a8fd4' }}>
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
              <button onClick={handleAddToTriggers} style={{ ...smallBtnStyle, color: '#d29922', borderColor: '#d29922' }}>
                Add to Triggers
              </button>
            </div>
          </div>
          {scriptPreview && (
            <pre style={{
              background: '#060d14', border: '1px solid #3a3a3a', borderRadius: 4,
              padding: '10px 12px', fontSize: 11, color: '#cccccc',
              fontFamily: "'B612 Mono', 'Consolas', monospace", maxHeight: 400, overflow: 'auto',
              whiteSpace: 'pre-wrap', lineHeight: 1.5,
            }}>
              {script}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <div style={fieldLabel}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}

function NumField({ label, value, onChange, min, max }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <div>
      <div style={fieldLabel}>{label}</div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...inputStyle, width: 80 }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const fieldLabel: React.CSSProperties = {
  fontSize: 11, color: '#aaaaaa', marginBottom: 3, fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  color: '#e0e0e0',
  fontSize: 13,
  padding: '5px 8px',
  outline: 'none',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const btnStyle: React.CSSProperties = {
  background: '#3a3a3a',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 13,
  padding: '6px 12px',
  fontFamily: 'inherit',
};

const generateBtnStyle: React.CSSProperties = {
  background: '#1a3a1a',
  border: '1px solid #3fb950',
  borderRadius: 4,
  color: '#3fb950',
  cursor: 'pointer',
  fontSize: 13,
  padding: '6px 14px',
  fontWeight: 600,
  fontFamily: 'inherit',
};

const smallBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 11,
  padding: '3px 10px',
  fontFamily: 'inherit',
};
