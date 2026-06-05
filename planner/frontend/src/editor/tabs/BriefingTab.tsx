/**
 * Briefing & Situation tab — edit mission briefing text fields with auto-fill.
 *
 * Reads sortie, descriptionText, blue/red task descriptions from the mission.
 * Auto-fill generates a briefing from parsed mission data (groups, weather,
 * airbases, time, threats).
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import { Button } from '../../components/Button';
import { isCarrierGroup, getAirRoleLabel } from '../../utils/groups';

/* ------------------------------------------------------------------ */
/* Auto-fill generator                                                 */
/* ------------------------------------------------------------------ */

function generateBriefing(store: ReturnType<typeof useMissionStore.getState>): {
  sortie: string;
  description: string;
  blueTask: string;
  redTask: string;
} {
  const { overview, groups, threats, airbases } = store;
  const wx = overview?.weather;
  const date = overview?.date || '';
  const startSec = overview?.start_time || 0;
  const theater = overview?.theater || 'Unknown';

  // Time formatting
  const hours = Math.floor(startSec / 3600);
  const mins = Math.floor((startSec % 3600) / 60);
  const timeLocal = `${String(hours).padStart(2, '0')}${String(mins).padStart(2, '0')}L`;
  const timeZulu = `${String(hours).padStart(2, '0')}${String(mins).padStart(2, '0')}Z`;

  // Coalition breakdowns
  const blueGroups = groups.filter((g) => g.coalition === 'blue');
  const redGroups = groups.filter((g) => g.coalition === 'red');

  const blueAir = blueGroups.filter((g) => g.category === 'plane' || g.category === 'helicopter');
  const blueGround = blueGroups.filter((g) => g.category === 'vehicle');
  const blueShips = blueGroups.filter((g) => g.category === 'ship');

  const redAir = redGroups.filter((g) => g.category === 'plane' || g.category === 'helicopter');
  const redGround = redGroups.filter((g) => g.category === 'vehicle');
  const redSam = threats.filter((t) => t.coalition === 'red');

  // Player flights
  const playerGroups = blueAir.filter((g) => g.units.some((u) => u.skill === 'Client' || u.skill === 'Player'));
  const playerSummary = playerGroups.map((g) => {
    const type = g.units[0]?.type || 'Unknown';
    const count = g.units.length;
    const role = getAirRoleLabel(g) || g.task;
    return `  - ${g.groupName}: ${count}x ${type} (${role})`;
  }).join('\\n');

  // Tankers & carriers
  const tankers = blueGroups.filter((g) => getAirRoleLabel(g) === 'REFUEL');
  const carriers = blueGroups.filter((g) => isCarrierGroup(g));

  // Blue airbases
  const blueAirbases = airbases.filter((a) => a.coalition === 'blue' || a.coalition === 'neutral');

  // Weather summary
  let wxSummary = '';
  if (wx) {
    const windDir = wx.wind?.atGround?.dir || 0;
    const windSpd = Math.round((wx.wind?.atGround?.speed || 0) * 1.94384);
    const tempC = wx.temperature_c || 15;
    const visKm = Math.round((wx.visibility_m || 80000) / 1000);
    const cloudBase = Math.round((wx.clouds_base_m || 0) * 3.281);
    const density = wx.clouds_density || 0;

    let skyStr = 'Clear';
    if (density > 7) skyStr = `Overcast at ${cloudBase}ft`;
    else if (density > 4) skyStr = `Broken at ${cloudBase}ft`;
    else if (density > 2) skyStr = `Scattered at ${cloudBase}ft`;
    else if (density > 0) skyStr = `Few at ${cloudBase}ft`;

    const qnh = wx.qnh_hpa || 1013;
    wxSummary = [
      `Wind ${String(windDir).padStart(3, '0')}/${windSpd}kt`,
      `Temp ${tempC}C`,
      `Vis ${visKm}km`,
      skyStr,
      `QNH ${qnh}hPa / ${wx.qnh_inhg || '29.92'}"`,
    ].join(', ');
  }

  // Threat summary
  const threatTypes = new Map<string, number>();
  for (const t of redSam) {
    const name = t.name.replace(/^SAM\s*/i, '');
    threatTypes.set(name, (threatTypes.get(name) || 0) + 1);
  }
  const threatLines = [...threatTypes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `  - ${count}x ${name}`)
    .join('\\n');

  // --- Build sortie name ---
  const sortie = overview?.sortie || `${theater} Operations`;

  // --- Build description (situation) ---
  const descParts: string[] = [];
  descParts.push(`SITUATION BRIEFING`);
  descParts.push(`Theater: ${theater}`);
  descParts.push(`Date: ${date}  Time: ${timeLocal} (${timeZulu})`);
  descParts.push(`Weather: ${wxSummary}`);
  descParts.push('');
  descParts.push(`FORCES:`);
  descParts.push(`Blue: ${blueAir.length} air groups, ${blueGround.length} ground groups, ${blueShips.length} naval groups`);
  descParts.push(`Red: ${redAir.length} air groups, ${redGround.length} ground groups`);
  if (redSam.length > 0) {
    descParts.push('');
    descParts.push(`THREAT LAYDOWN (${redSam.length} SAM/AAA):`);
    descParts.push(threatLines);
  }
  if (blueAirbases.length > 0) {
    descParts.push('');
    descParts.push(`AVAILABLE AIRBASES: ${blueAirbases.map((a) => a.name).join(', ')}`);
  }

  // --- Build blue task ---
  const blueParts: string[] = [];
  blueParts.push('BLUE COALITION TASK ORDER');
  blueParts.push('');
  if (playerGroups.length > 0) {
    blueParts.push(`PLAYER FLIGHTS (${playerGroups.length}):`);
    blueParts.push(playerSummary);
    blueParts.push('');
  }
  if (tankers.length > 0) {
    blueParts.push(`SUPPORT:`);
    for (const t of tankers) {
      // t.frequency is already in MHz from the backend extractor — do NOT divide
      const freq = t.frequency ? `${t.frequency.toFixed(3)} MHz ${t.modulation === 0 ? 'AM' : 'FM'}` : '';
      const tacan = t.tacan ? `TACAN ${t.tacan.channel}${t.tacan.band}` : '';
      blueParts.push(`  - ${t.groupName}: ${t.units[0]?.type || 'Tanker'} ${[freq, tacan].filter(Boolean).join(' / ')}`);
    }
    blueParts.push('');
  }
  if (carriers.length > 0) {
    blueParts.push(`CARRIER OPS:`);
    for (const c of carriers) {
      const tacan = c.tacan ? `TACAN ${c.tacan.channel}${c.tacan.band}` : '';
      const icls = c.icls ? `ICLS CH${c.icls.channel}` : '';
      blueParts.push(`  - ${c.groupName}: ${c.units[0]?.type || 'Carrier'} ${[tacan, icls].filter(Boolean).join(' / ')}`);
    }
    blueParts.push('');
  }
  blueParts.push('Accomplish assigned tasking. RTB when winchester or bingo.');

  // --- Build red task ---
  const redParts: string[] = [];
  redParts.push('RED COALITION');
  redParts.push('');
  redParts.push(`Air: ${redAir.length} groups`);
  redParts.push(`Ground: ${redGround.length} groups`);
  if (redSam.length > 0) {
    redParts.push(`IADS: ${redSam.length} SAM/AAA sites`);
  }
  redParts.push('');
  redParts.push('Defend assigned sectors. Engage blue coalition forces.');

  return {
    sortie,
    description: descParts.join('\\n'),
    blueTask: blueParts.join('\\n'),
    redTask: redParts.join('\\n'),
  };
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const cardStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #4a4a4a', borderRadius: 6,
  padding: 14, marginBottom: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#aaaaaa', marginBottom: 6, display: 'block',
};

const textareaStyle: React.CSSProperties = {
  width: '100%', minHeight: 120, background: '#0a1218', border: '1px solid #3a3a3a',
  borderRadius: 4, color: '#e0e0e0', fontSize: 12, padding: '8px 10px',
  fontFamily: "'Consolas', 'Courier New', monospace", lineHeight: 1.5,
  resize: 'vertical', boxSizing: 'border-box',
};

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0a1218', border: '1px solid #3a3a3a',
  borderRadius: 4, color: '#e0e0e0', fontSize: 13, padding: '6px 10px',
  fontFamily: 'inherit', boxSizing: 'border-box',
};

// btnStyle was extracted into <Button> in src/components/Button.tsx

const btnApply: React.CSSProperties = {
  background: 'rgba(63, 185, 80, 0.15)', border: '1px solid rgba(63, 185, 80, 0.3)',
  borderRadius: 4, color: '#3fb950', fontSize: 13, padding: '8px 20px',
  cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function BriefingTab() {
  const overview = useMissionStore((s) => s.overview);
  const sessionId = useMissionStore((s) => s.sessionId);
  const addEdit = useEditStore((s) => s.addEdit);
  // Watch the editStore for the staged briefing edit (if any). Used by
  // the "revert on edit-removal" effect below — when the user removes
  // the briefing edit on the Edits tab, this becomes undefined and we
  // sync the local fields back to overview. (v1.19.21 audit fix #A)
  const briefingEdit = useEditStore((s) => s.edits.find((e: any) => e.field === 'briefing'));

  // Local edit state. Initialized from overview on every NEW session
  // (see sync effect below) — useState alone fires only on first
  // mount, so if BriefingTab mounted before the mission upload
  // finished, the fields would stay empty even after overview loaded
  // — and v0.9.1's auto-stage would then dispatch a briefing edit
  // with empty strings, wiping the original briefing on download.
  const [sortie, setSortie] = useState('');
  const [description, setDescription] = useState('');
  const [blueTask, setBlueTask] = useState('');
  const [redTask, setRedTask] = useState('');
  const [applied, setApplied] = useState(false);

  // Sync local state from the mission overview on first arrival per
  // session. Only fires when sessionId changes — once the user starts
  // editing within a session, we don't clobber their typing.
  //
  // When a briefing edit was restored from localStorage (audit fix #B),
  // we initialise the fields from the EDIT's values instead of the raw
  // overview so the input reflects the queued change. Without this,
  // refresh + restore would show the original mission values while the
  // queue badge said "1 pending" — confusing and wrong.
  const lastSyncedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!overview || !sessionId) return;
    if (lastSyncedSessionRef.current === sessionId) return;
    const restored = (briefingEdit as any)?.value;
    if (restored && typeof restored === 'object') {
      setSortie(restored.sortie ?? overview.sortie ?? '');
      setDescription((restored.description ?? overview.description ?? '').replace(/\\n/g, '\n'));
      setBlueTask((restored.descriptionBlueTask ?? overview.descriptionBlueTask ?? '').replace(/\\n/g, '\n'));
      setRedTask((restored.descriptionRedTask ?? overview.descriptionRedTask ?? '').replace(/\\n/g, '\n'));
    } else {
      setSortie(overview.sortie || '');
      setDescription((overview.description || '').replace(/\\n/g, '\n'));
      setBlueTask((overview.descriptionBlueTask || '').replace(/\\n/g, '\n'));
      setRedTask((overview.descriptionRedTask || '').replace(/\\n/g, '\n'));
    }
    setApplied(false);
    lastSyncedSessionRef.current = sessionId;
  }, [overview, sessionId, briefingEdit]);

  // Revert local state when the staged briefing edit is removed externally
  // (e.g. user clicks × on the Edits tab). Without this, the input fields
  // keep showing the typed text after the edit is gone — the user thinks
  // their change is still in effect but the download won't include it.
  // (v1.19.21 audit fix #A)
  const prevBriefingPresentRef = useRef(false);
  useEffect(() => {
    const present = !!briefingEdit;
    // Only act on the present→absent transition. present→present or
    // absent→absent transitions are normal typing flow and shouldn't
    // touch the local fields.
    if (prevBriefingPresentRef.current && !present && overview) {
      setSortie(overview.sortie || '');
      setDescription((overview.description || '').replace(/\\n/g, '\n'));
      setBlueTask((overview.descriptionBlueTask || '').replace(/\\n/g, '\n'));
      setRedTask((overview.descriptionRedTask || '').replace(/\\n/g, '\n'));
      setApplied(false);
    }
    prevBriefingPresentRef.current = present;
  }, [briefingEdit, overview]);

  const hasChanges = useMemo(() => {
    return sortie !== (overview?.sortie || '') ||
      description !== (overview?.description || '').replace(/\\n/g, '\n') ||
      blueTask !== (overview?.descriptionBlueTask || '').replace(/\\n/g, '\n') ||
      redTask !== (overview?.descriptionRedTask || '').replace(/\\n/g, '\n');
  }, [sortie, description, blueTask, redTask, overview]);

  const handleAutoFill = useCallback(() => {
    const state = useMissionStore.getState();
    const generated = generateBriefing(state);
    setSortie(generated.sortie);
    setDescription(generated.description.replace(/\\n/g, '\n'));
    setBlueTask(generated.blueTask.replace(/\\n/g, '\n'));
    setRedTask(generated.redTask.replace(/\\n/g, '\n'));
    setApplied(false);
  }, []);

  const handleApply = useCallback(() => {
    addEdit({
      field: 'briefing',
      value: {
        sortie,
        description: description.replace(/\n/g, '\\n'),
        descriptionBlueTask: blueTask.replace(/\n/g, '\\n'),
        descriptionRedTask: redTask.replace(/\n/g, '\\n'),
      },
    } as any);
    setApplied(true);
  }, [sortie, description, blueTask, redTask, addEdit]);

  // Auto-stage briefing edits as the user types. Without this, changes
  // typed into the four fields are silently dropped on download —
  // every other tab in the planner auto-saves, and we kept hitting
  // the "I typed it but it didn't save" trap. Debounce 800 ms so we
  // don't queue an edit per keystroke; that keeps the Edits tab
  // count sane (one briefing edit batched at a time).
  //
  // On restore from localStorage (audit fix #B), the queued briefing
  // edit may already match the local state — in that case re-staging
  // would create a duplicate, doubling the Edits badge. Skip when the
  // queued edit's value mirrors the current inputs.
  const stageRef = useRef<number | null>(null);
  useEffect(() => {
    if (!hasChanges) return;
    const queued = (briefingEdit as any)?.value;
    if (queued
        && queued.sortie === sortie
        && queued.description === description.replace(/\n/g, '\\n')
        && queued.descriptionBlueTask === blueTask.replace(/\n/g, '\\n')
        && queued.descriptionRedTask === redTask.replace(/\n/g, '\\n')) {
      return;  // already represented in the queue — no re-stage needed
    }
    if (stageRef.current != null) window.clearTimeout(stageRef.current);
    stageRef.current = window.setTimeout(() => {
      handleApply();
    }, 800);
    return () => {
      if (stageRef.current != null) window.clearTimeout(stageRef.current);
    };
  }, [hasChanges, handleApply, briefingEdit, sortie, description, blueTask, redTask]);

  return (
    <div style={{ maxWidth: 750 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
            Briefing & Situation
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#aaaaaa' }}>
            Edit mission briefing text or auto-fill from mission data.
          </p>
        </div>
        <Button onClick={handleAutoFill} style={{ padding: '8px 16px' }}>
          Auto-Fill from Mission
        </Button>
      </div>

      {/* Sortie Name */}
      <div style={cardStyle}>
        <label style={labelStyle}>Sortie Name</label>
        <input
          value={sortie}
          onChange={(e) => { setSortie(e.target.value); setApplied(false); }}
          placeholder="Mission sortie name"
          style={inputStyle}
        />
      </div>

      {/* Situation / Description */}
      <div style={cardStyle}>
        <label style={labelStyle}>
          Situation / Description
          <span style={{ fontWeight: 400, color: '#4a4a4a', marginLeft: 8 }}>
            (shown to all players in briefing screen)
          </span>
        </label>
        <textarea
          value={description}
          onChange={(e) => { setDescription(e.target.value); setApplied(false); }}
          placeholder="Mission situation and overall briefing..."
          style={{ ...textareaStyle, minHeight: 180 }}
        />
      </div>

      {/* Blue Task */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{
            width: 10, height: 10, borderRadius: 2, background: '#4a8fd4',
          }} />
          <label style={{ ...labelStyle, margin: 0, color: '#4a8fd4' }}>
            Blue Coalition Task
          </label>
        </div>
        <textarea
          value={blueTask}
          onChange={(e) => { setBlueTask(e.target.value); setApplied(false); }}
          placeholder="Blue side task description and objectives..."
          style={textareaStyle}
        />
      </div>

      {/* Red Task */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{
            width: 10, height: 10, borderRadius: 2, background: '#d95050',
          }} />
          <label style={{ ...labelStyle, margin: 0, color: '#d95050' }}>
            Red Coalition Task
          </label>
        </div>
        <textarea
          value={redTask}
          onChange={(e) => { setRedTask(e.target.value); setApplied(false); }}
          placeholder="Red side task description..."
          style={textareaStyle}
        />
      </div>

      {/* Status — briefing edits auto-stage as you type (debounced 800 ms).
          The button stays for users who want to force a stage right
          now, but it's no longer required. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={handleApply}
          disabled={!hasChanges && !applied}
          style={applied ? { ...btnApply, opacity: 0.6, cursor: 'default' } : hasChanges ? btnApply : { ...btnApply, opacity: 0.4, cursor: 'not-allowed' }}
        >
          {applied ? '✓ Staged' : 'Stage Now'}
        </button>
        <span style={{ fontSize: 12, color: '#888' }}>
          {applied
            ? 'Auto-saved. Will write to the .miz on download.'
            : hasChanges
            ? 'Auto-saving in 0.8 s — or click Stage Now.'
            : 'Type in any field — changes auto-save.'}
        </span>
      </div>
    </div>
  );
}
