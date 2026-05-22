import { useState, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import { useSopStore } from '../../sop/sopStore';
import { isCarrierGroup, getAirRoleLabel } from '../../utils/groups';
import { detectCarrierIcls, allocateIcls } from '../../utils/carrierDefaults';

/** Extract a number from a group name/type for TACAN channel derivation.
 *  Tankers: "Texaco 3-1" -> 31, "Shell 1-1" -> 11
 *  Carriers: "CVN-72" -> 72, unit type "CVN_73" -> 73
 */
function deriveChannel(name: string, unitType: string, role: 'tanker' | 'carrier'): number {
  if (role === 'carrier') {
    const cvnNameMatch = name.match(/(?:CVN|LHA|LHD)[- _]?(\d+)/i);
    if (cvnNameMatch) return parseInt(cvnNameMatch[1], 10);
    const cvnTypeMatch = unitType.match(/(?:CVN|LHA|LHD)[- _]?(\d+)/i);
    if (cvnTypeMatch) return parseInt(cvnTypeMatch[1], 10);
    const hullMap: Record<string, number> = {
      stennis: 74, vinson: 70, roosevelt: 71, lincoln: 72, washington: 73,
      truman: 75, reagan: 76, bush: 77, ford: 78, kennedy: 79,
      tarawa: 1, saipan: 2, nassau: 4, bataan: 5, bonhomme: 6, wasp: 1,
    };
    const lowerName = (name + ' ' + unitType).toLowerCase();
    for (const [ship, hull] of Object.entries(hullMap)) {
      if (lowerName.includes(ship)) return hull;
    }
    return 0;
  }
  const flightMatch = name.match(/(\d+)-(\d+)/);
  if (flightMatch) return parseInt(flightMatch[1] + flightMatch[2], 10);
  const trailingMatch = name.match(/(\d+)\s*$/);
  if (trailingMatch) return parseInt(trailingMatch[1], 10);
  return 0;
}

function clampChannel(ch: number): number {
  if (ch < 1 || ch > 126) return 0;
  return ch;
}

/** LHA/LHD types don't have ICLS capability */
function hasIclsCapability(unitType: string, groupName: string): boolean {
  const combined = (groupName + ' ' + unitType).toLowerCase();
  if (/lha|lhd|tarawa|wasp/i.test(combined)) return false;
  return true;
}

interface TacanRow {
  groupId: number;
  groupName: string;
  type: string;
  role: 'tanker' | 'carrier';
  coalition: string;
  channel: number;
  band: string;
  callsign: string;
  /** ICLS channel (carriers only, 0 = unset) */
  iclsCh: number;
  /** Whether this carrier type supports ICLS */
  hasIcls: boolean;
}

export function TacanTab() {
  const groups = useMissionStore((s) => s.groups);
  const addEdit = useEditStore((s) => s.addEdit);
  const activeSop = useSopStore((s) => s.activeId ? s.sops.find((x) => x.id === s.activeId) || null : null);
  const [overrides, setOverrides] = useState<Map<number, Partial<TacanRow>>>(new Map());
  const [result, setResult] = useState('');

  // Find all tankers and carriers
  const tacanGroups = useMemo<TacanRow[]>(() => {
    const rows: TacanRow[] = [];
    for (const g of groups) {
      const airRole = getAirRoleLabel(g);
      const carrier = isCarrierGroup(g);
      if (airRole === 'REFUEL' || carrier) {
        const existing = g.tacan;
        const isCarr = !!carrier;
        rows.push({
          groupId: g.groupId,
          groupName: g.groupName,
          type: g.units[0]?.type || g.category,
          role: isCarr ? 'carrier' : 'tanker',
          coalition: g.coalition,
          channel: existing?.channel || 0,
          band: existing?.band || 'X',
          callsign: existing?.callsign || '',
          iclsCh: isCarr ? (g.icls?.channel || 0) : 0,
          hasIcls: isCarr ? hasIclsCapability(g.units[0]?.type || '', g.groupName) : false,
        });
      }
    }
    return rows;
  }, [groups]);

  const getRow = (groupId: number): TacanRow => {
    const base = tacanGroups.find((r) => r.groupId === groupId)!;
    const ov = overrides.get(groupId);
    return ov ? { ...base, ...ov } : base;
  };

  const updateField = (groupId: number, field: keyof TacanRow, value: string | number) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const existing = next.get(groupId) || {};
      next.set(groupId, { ...existing, [field]: value });
      return next;
    });
  };

  const handleAutoAssign = useCallback(() => {
    const next = new Map<number, Partial<TacanRow>>();
    const usedChannels = new Set<number>();
    let fallbackCh = 30;
    // ICLS allocator — looks up canonical hull values (Stennis=7, Ike=11
    // etc.) and avoids collisions across carriers in the same mission.
    // Replaces the old sequential 1, 2, 3… assignment that ignored
    // squadron SOP conventions.
    const usedIcls = new Set<number>();

    // Build SOP lookup: tanker callsign (case-insensitive first word) -> SOP entry
    const sopTankerMap = new Map<string, { channel: number; band: 'X' | 'Y'; callsign?: string }>();
    if (activeSop?.tankers) {
      for (const t of activeSop.tankers) {
        if (t.tacanChannel != null) {
          sopTankerMap.set(
            t.callsign.toLowerCase(),
            { channel: t.tacanChannel, band: t.tacanBand || 'Y', callsign: t.tacanCallsign },
          );
        }
      }
    }

    const derived: { row: TacanRow; ch: number; cs: string; band: string; fromSop: boolean }[] = [];
    let sopHits = 0;
    for (const row of tacanGroups) {
      let ch = 0;
      let cs = '';
      let band: string = row.role === 'tanker' ? 'Y' : 'X';
      let fromSop = false;

      // For tankers, try the SOP first
      if (row.role === 'tanker') {
        // Match the first word of the group name against SOP tanker callsigns
        const firstWord = row.groupName.split(/[-\s]/)[0].toLowerCase();
        const sopTanker = sopTankerMap.get(firstWord);
        if (sopTanker) {
          ch = sopTanker.channel;
          band = sopTanker.band;
          cs = sopTanker.callsign || row.groupName.replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase() || 'TKR';
          fromSop = true;
          sopHits++;
        }
      }

      // Fallback to derived values if SOP didn't match
      if (!fromSop) {
        ch = clampChannel(deriveChannel(row.groupName, row.type, row.role));
        cs = row.groupName.replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase()
          || (row.role === 'carrier' ? 'CVN' : 'TKR');
      }
      derived.push({ row, ch, cs, band, fromSop });
    }

    for (const { row, ch, cs, band } of derived) {
      let finalCh = ch;
      if (finalCh === 0 || usedChannels.has(finalCh)) {
        while (usedChannels.has(fallbackCh) || fallbackCh < 1) fallbackCh++;
        finalCh = fallbackCh;
        fallbackCh++;
      }
      if (finalCh > 126) finalCh = 126;
      usedChannels.add(finalCh);

      const partial: Partial<TacanRow> = { channel: finalCh, band, callsign: cs };
      if (row.hasIcls) {
        const preferred = detectCarrierIcls(row.type, row.groupName);
        const icls = allocateIcls(preferred, usedIcls);
        usedIcls.add(icls);
        partial.iclsCh = icls;
      }
      next.set(row.groupId, partial);
    }

    setOverrides(next);
    setResult(
      `Auto-assigned ${tacanGroups.length} TACAN channels` +
      (sopHits > 0 ? ` — ${sopHits} from SOP "${activeSop!.name}"` : ''),
    );
  }, [tacanGroups, activeSop]);

  const handleApply = useCallback(() => {
    if (overrides.size === 0) { setResult('No changes to apply'); return; }
    let count = 0;
    let skipped = 0;
    for (const [groupId] of overrides) {
      const row = getRow(groupId);
      const group = groups.find((g) => g.groupId === groupId);
      if (!group) continue;
      const unitId = group.units[0]?.unitId;
      if (!unitId) continue;

      // A TACAN channel must be an integer 1-126. A blank/0/NaN value is a
      // dead beacon, so skip it (and report) rather than silently writing an
      // inert channel the planner believes they set. (Pre-beta audit P2.)
      const ch = Number(row.channel);
      if (!Number.isInteger(ch) || ch < 1 || ch > 126) { skipped++; continue; }

      // Apply TACAN
      addEdit({
        unitId,
        groupId,
        field: 'tacan',
        value: {
          channel: ch,
          band: row.band,
          callsign: row.callsign,
        },
      } as any);

      // Apply ICLS if carrier with ICLS capability and channel set
      if (row.hasIcls && row.iclsCh > 0) {
        addEdit({
          unitId,
          groupId,
          field: 'icls',
          value: { channel: row.iclsCh },
        } as any);
      }

      count++;
    }
    setResult(
      `Applied TACAN${carriers.length > 0 ? ' + ICLS' : ''} to ${count} group${count !== 1 ? 's' : ''}` +
      (skipped > 0 ? ` — skipped ${skipped} with no valid channel (1-126)` : ''),
    );
  }, [overrides, tacanGroups, groups, addEdit]);

  const tankers = tacanGroups.filter((r) => r.role === 'tanker');
  const carriers = tacanGroups.filter((r) => r.role === 'carrier');

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>TACAN / ICLS / Beacon</h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#aaaaaa' }}>
        Assign TACAN channels to tankers and carriers, and ICLS channels to carriers. Auto-assign avoids conflicts.
        ACLS is enabled automatically on CVN carriers when ICLS is active — configure it in Carrier Setup if using MOOSE.
      </p>

      {tacanGroups.length === 0 ? (
        <div style={{ color: '#aaaaaa', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>
          No tankers or carriers found in this mission.
        </div>
      ) : (
        <>
          <button
            onClick={handleAutoAssign}
            title={activeSop && activeSop.tankers && activeSop.tankers.length > 0
              ? `Tanker TACANs come from SOP "${activeSop.name}" when callsigns match. Others fall back to auto-derivation.`
              : 'Auto-assign TACAN channels based on group name / hull number'}
            style={{
              background: '#4a4a4a', border: '1px solid #4a8fd4', borderRadius: 4,
              color: '#4a8fd4', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              padding: '8px 16px', marginBottom: 8, width: '100%',
            }}
          >
            Auto-Assign All Channels{activeSop && activeSop.tankers && activeSop.tankers.length > 0 ? ' (SOP)' : ''}
          </button>
          {activeSop && activeSop.tankers && activeSop.tankers.length > 0 && (
            <div style={{ fontSize: 11, color: '#d29922', marginBottom: 16 }}>
              Using SOP "{activeSop.name}" — tankers matching{' '}
              {activeSop.tankers.filter((t) => t.tacanChannel != null).map((t) => t.callsign).join(', ')}{' '}
              will get their SOP TACAN channel.
            </div>
          )}

          {tankers.length > 0 && (
            <>
              <SectionHeader title="Tankers" count={tankers.length} color="#d29922" />
              {tankers.map((row) => (
                <TacanRowEditor key={row.groupId} row={getRow(row.groupId)} onChange={updateField} />
              ))}
            </>
          )}

          {carriers.length > 0 && (
            <>
              <SectionHeader title="Carriers" count={carriers.length} color="#a371f7" />
              {carriers.map((row) => (
                <CarrierRowEditor key={row.groupId} row={getRow(row.groupId)} onChange={updateField} />
              ))}
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #3a3a3a', marginTop: 16 }}>
            <button
              onClick={handleApply}
              disabled={overrides.size === 0}
              style={{
                background: overrides.size > 0 ? '#d29922' : '#3a3a3a',
                border: 'none', borderRadius: 4, color: '#1a1a1a',
                cursor: overrides.size > 0 ? 'pointer' : 'not-allowed',
                fontSize: 14, fontWeight: 600, padding: '8px 16px',
              }}
            >
              Apply Changes
            </button>
            <span style={{ color: '#aaaaaa', fontSize: 13 }}>
              {overrides.size} group{overrides.size !== 1 ? 's' : ''} modified
            </span>
          </div>

          {result && (
            <div style={{ padding: '8px 12px', background: 'rgba(63, 185, 80, 0.1)', border: '1px solid #3fb950', borderRadius: 4, color: '#3fb950', fontSize: 13, marginTop: 8 }}>
              {result}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeader({ title, count, color }: { title: string; count: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 8px' }}>
      <span style={{ color, fontWeight: 600, fontSize: 14 }}>{title}</span>
      <span style={{
        color, fontSize: 11, background: `${color}15`, border: `1px solid ${color}30`,
        borderRadius: 10, padding: '1px 8px', fontWeight: 600,
      }}>{count}</span>
    </div>
  );
}

/** Tanker row — TACAN only */
function TacanRowEditor({
  row,
  onChange,
}: {
  row: TacanRow;
  onChange: (groupId: number, field: keyof TacanRow, value: string | number) => void;
}) {
  const roleColor = '#d29922';
  return (
    <div style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.groupName}
        </div>
        <div style={{ color: '#aaaaaa', fontSize: 11 }}>{row.type}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <label style={fieldLabelInline}>CH</label>
        <input
          type="number"
          value={row.channel || ''}
          onChange={(e) => onChange(row.groupId, 'channel', parseInt(e.target.value, 10) || 0)}
          min={1} max={126}
          style={chInputStyle}
        />
        <select
          value={row.band}
          onChange={(e) => onChange(row.groupId, 'band', e.target.value)}
          style={{ ...bandSelectStyle, color: roleColor }}
        >
          <option value="X">X</option>
          <option value="Y">Y</option>
        </select>
        <input
          value={row.callsign}
          onChange={(e) => onChange(row.groupId, 'callsign', e.target.value.toUpperCase().slice(0, 3))}
          maxLength={3}
          placeholder="ID"
          style={csInputStyle}
        />
      </div>
    </div>
  );
}

/** Carrier row — TACAN + ICLS + ACLS */
function CarrierRowEditor({
  row,
  onChange,
}: {
  row: TacanRow;
  onChange: (groupId: number, field: keyof TacanRow, value: string | number) => void;
}) {
  return (
    <div style={{ ...rowStyle, flexDirection: 'column', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {row.groupName}
          </div>
          <div style={{ color: '#aaaaaa', fontSize: 11 }}>{row.type}</div>
        </div>
      </div>

      {/* TACAN row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={beaconLabel}>TACAN</span>
        <label style={fieldLabelInline}>CH</label>
        <input
          type="number"
          value={row.channel || ''}
          onChange={(e) => onChange(row.groupId, 'channel', parseInt(e.target.value, 10) || 0)}
          min={1} max={126}
          style={chInputStyle}
        />
        <select
          value={row.band}
          onChange={(e) => onChange(row.groupId, 'band', e.target.value)}
          style={{ ...bandSelectStyle, color: '#a371f7' }}
        >
          <option value="X">X</option>
          <option value="Y">Y</option>
        </select>
        <input
          value={row.callsign}
          onChange={(e) => onChange(row.groupId, 'callsign', e.target.value.toUpperCase().slice(0, 3))}
          maxLength={3}
          placeholder="ID"
          style={csInputStyle}
        />
      </div>

      {/* ICLS row */}
      {row.hasIcls ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ ...beaconLabel, background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.3)' }}>
            ICLS
          </span>
          <label style={fieldLabelInline}>CH</label>
          <input
            type="number"
            value={row.iclsCh || ''}
            onChange={(e) => onChange(row.groupId, 'iclsCh', parseInt(e.target.value, 10) || 0)}
            min={1} max={20}
            style={chInputStyle}
          />
          <span style={{ color: '#aaaaaa', fontSize: 11 }}>
            (1-20)
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ ...beaconLabel, opacity: 0.4 }}>ICLS</span>
          <span style={{ color: '#aaaaaa', fontSize: 11 }}>N/A (LHA/LHD)</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
  background: '#0a1218', borderRadius: 6, border: '1px solid #222222', marginBottom: 6,
};

const fieldLabelInline: React.CSSProperties = { color: '#aaaaaa', fontSize: 11 };

const chInputStyle: React.CSSProperties = {
  width: 52, background: '#262626', border: '1px solid #3a3a3a', borderRadius: 4,
  color: '#e0e0e0', fontSize: 13, padding: '4px 6px', fontFamily: "'B612 Mono', monospace", textAlign: 'center',
};

const bandSelectStyle: React.CSSProperties = {
  width: 42, background: '#262626', border: '1px solid #3a3a3a', borderRadius: 4,
  fontSize: 13, padding: '4px 2px', fontWeight: 600,
};

const csInputStyle: React.CSSProperties = {
  width: 48, background: '#262626', border: '1px solid #3a3a3a', borderRadius: 4,
  color: '#e0e0e0', fontSize: 13, padding: '4px 6px', fontFamily: "'B612 Mono', monospace", textAlign: 'center',
};

const beaconLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 3,
  background: 'rgba(163, 113, 247, 0.1)', color: '#a371f7',
  border: '1px solid rgba(163, 113, 247, 0.3)', minWidth: 42, textAlign: 'center',
};
