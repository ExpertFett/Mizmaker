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
  /** ICLS channel */
  iclsCh: number;
  /** TIW speed (kts) */
  tiwSpeed: number;
  /** BRC offset (degrees, e.g., -9 for angled deck CVN, 0 for LHA) */
  brcOffset: number;
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

const HULL_DB: Record<string, { label: string; callsign: string; tacan: number; brcOffset: number; tiwSpeed: number }> = {
  'CVN-70': { label: 'CVN', callsign: 'Rough Rider', tacan: 70, brcOffset: -9, tiwSpeed: 25 },
  'CVN-71': { label: 'CVN', callsign: 'Rough Rider', tacan: 71, brcOffset: -9, tiwSpeed: 25 },
  'CVN-72': { label: 'CVN', callsign: 'Rough Rider', tacan: 72, brcOffset: -9, tiwSpeed: 25 },
  'CVN-73': { label: 'CVN', callsign: 'Rough Rider', tacan: 73, brcOffset: -9, tiwSpeed: 25 },
  'CVN-74': { label: 'CVN', callsign: 'Rough Rider', tacan: 74, brcOffset: -9, tiwSpeed: 25 },
  'CVN-75': { label: 'CVN', callsign: 'Rough Rider', tacan: 75, brcOffset: -9, tiwSpeed: 25 },
  stennis:  { label: 'CVN', callsign: 'Rough Rider', tacan: 74, brcOffset: -9, tiwSpeed: 25 },
  vinson:   { label: 'CVN', callsign: 'Rough Rider', tacan: 70, brcOffset: -9, tiwSpeed: 25 },
  forrestal:{ label: 'CVN', callsign: 'Rough Rider', tacan: 59, brcOffset: -9, tiwSpeed: 25 },
  tarawa:   { label: 'LHA', callsign: 'Proud Eagle', tacan: 1, brcOffset: 0, tiwSpeed: 10 },
  'LHA-1':  { label: 'LHA', callsign: 'Proud Eagle', tacan: 1, brcOffset: 0, tiwSpeed: 10 },
};

function detectCarrierInfo(g: MissionGroup): Partial<CarrierConfig> {
  const name = g.groupName.toLowerCase();
  const utype = (g.units[0]?.type || '').toLowerCase();
  const combined = name + ' ' + utype;

  for (const [key, data] of Object.entries(HULL_DB)) {
    if (combined.includes(key.toLowerCase())) {
      return { ...data, tacanCh: data.tacan, tacanCallsign: data.label, iclsCh: 2 };
    }
  }

  // Fallback: detect type
  if (/lha|lhd|tarawa/i.test(combined)) {
    return { label: 'LHA', callsign: 'Eagle', tacanCh: 1, tacanCallsign: 'LHA', brcOffset: 0, tiwSpeed: 10, iclsCh: 2 };
  }
  return { label: 'CVN', callsign: 'Carrier', tacanCh: 72, tacanCallsign: 'CVN', brcOffset: -9, tiwSpeed: 25, iclsCh: 2 };
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
      lines.push(`  ${varName}:AddTurnIntoWind(t_start, t_end, ${c.tiwSpeed}, false, ${c.brcOffset})`);
      lines.push(`  MESSAGE:New("99 ${c.callsign} Turning, at time " .. t_start .. " until " .. t_end):ToAll()`);
      lines.push('end');
      lines.push('');
    }

    // Beacon toggle functions
    const beacons = [
      { name: 'TACAN', offFlag: fb, onFlag: fb + 1 },
      { name: 'ICLS', offFlag: fb + 2, onFlag: fb + 3 },
      { name: 'LINK 4', offFlag: fb + 4, onFlag: fb + 5 },
      { name: 'ACLS', offFlag: fb + 6, onFlag: fb + 7 },
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
    lines.push(`local ${menuVar}_bcn = MENU_COALITION:New(coalition.side.BLUE, "Beacons", ${menuVar})`);
    for (const b of ['TACAN', 'ICLS', 'LINK4', 'ACLS']) {
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

    for (const g of carrierGroups) {
      const info = detectCarrierInfo(g);
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
        iclsCh: info.iclsCh || 2,
        tiwSpeed: info.tiwSpeed || 25,
        brcOffset: info.brcOffset ?? -9,
        rescueHeloGroup: '',
        rescueModex: 42,
        flagBase,
      });
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

  // Rename carrier group
  const handleRenameGroup = useCallback((groupId: number, newName: string) => {
    updateConfig(groupId, 'groupName', newName);
    const group = carrierGroups.find((g) => g.groupId === groupId);
    if (group) {
      const unitNamesObj: Record<number, string> = {};
      for (const u of group.units) {
        unitNamesObj[u.unitId] = u.name;
      }
      addEdit({
        groupId,
        field: 'groupRename',
        value: { groupId, newGroupName: newName, unitNames: unitNamesObj },
      } as any);
    }
  }, [addEdit, carrierGroups, updateConfig]);

  if (carrierGroups.length === 0) {
    return (
      <div style={{ color: '#5a7a8a', fontSize: 14, padding: 16 }}>
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
          <div style={{ fontSize: 13, color: '#5a7a8a' }}>
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
        <div style={{ color: '#5a7a8a', fontSize: 13, padding: '10px 0' }}>
          Click "Detect Carriers" to scan the mission for carrier groups.
        </div>
      )}

      {configs.map((c) => (
        <div key={c.groupId} style={{
          marginBottom: 10, padding: '12px 14px',
          background: '#0a1218', borderRadius: 6, border: '1px solid #12202e',
        }}>
          {/* Carrier header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{
              background: '#4a8fd4', color: '#080f1c', fontSize: 11, fontWeight: 700,
              padding: '2px 8px', borderRadius: 3,
            }}>
              {c.label}
            </span>
            <span style={{ color: '#5a7a8a', fontSize: 12 }}>{c.unitType}</span>
          </div>

          {/* Editable fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
            <Field label="Group Name" value={c.groupName}
              onChange={(v) => handleRenameGroup(c.groupId, v)} />
            <Field label="Callsign / Radio Name" value={c.callsign}
              onChange={(v) => updateConfig(c.groupId, 'callsign', v)} />
            <Field label="Menu Label" value={c.label}
              onChange={(v) => updateConfig(c.groupId, 'label', v)} />
            <NumField label="TACAN Channel" value={c.tacanCh} min={1} max={126}
              onChange={(v) => updateConfig(c.groupId, 'tacanCh', v)} />
            <Field label="TACAN Callsign" value={c.tacanCallsign}
              onChange={(v) => updateConfig(c.groupId, 'tacanCallsign', v)} />
            <NumField label="ICLS Channel" value={c.iclsCh} min={1} max={20}
              onChange={(v) => updateConfig(c.groupId, 'iclsCh', v)} />
            <NumField label="TIW Speed (kts)" value={c.tiwSpeed} min={5} max={35}
              onChange={(v) => updateConfig(c.groupId, 'tiwSpeed', v)} />
            <NumField label="BRC Offset (deg)" value={c.brcOffset} min={-15} max={15}
              onChange={(v) => updateConfig(c.groupId, 'brcOffset', v)} />
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
          background: '#0a1218', borderRadius: 6, border: '1px solid #12202e',
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
              background: '#060d14', border: '1px solid #1a2a3a', borderRadius: 4,
              padding: '10px 12px', fontSize: 11, color: '#8fa8c0',
              fontFamily: "'Consolas', monospace", maxHeight: 400, overflow: 'auto',
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
  fontSize: 11, color: '#5a7a8a', marginBottom: 3, fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  color: '#ccdae8',
  fontSize: 13,
  padding: '5px 8px',
  outline: 'none',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const btnStyle: React.CSSProperties = {
  background: '#1a2a3a',
  border: '1px solid #2a3a4a',
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
  border: '1px solid #2a3a4a',
  borderRadius: 3,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 11,
  padding: '3px 10px',
  fontFamily: 'inherit',
};
