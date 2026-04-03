import { useEffect, useState, useCallback, useRef } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useTriggerStore } from '../../store/triggerStore';
import {
  getTriggers, saveTriggers, uploadAudio, deleteAudio, audioStreamUrl,
} from '../../api/client';
import type { TriggerRule, TriggerCondition, TriggerAction, AudioFile } from '../../types/mission';

// ── Condition & Action type definitions for the dropdowns ─────────────────

const CONDITION_TYPES = [
  { value: 'TIME_MORE_THAN', label: 'Time More Than' },
  { value: 'TIME_LESS_THAN', label: 'Time Less Than' },
  { value: 'FLAG_IS_TRUE', label: 'Flag Is True' },
  { value: 'FLAG_IS_FALSE', label: 'Flag Is False' },
  { value: 'FLAG_EQUALS', label: 'Flag Equals' },
  { value: 'FLAG_LESS_THAN', label: 'Flag Less Than' },
  { value: 'FLAG_MORE_THAN', label: 'Flag More Than' },
  { value: 'FLAG_EQUALS_FLAG', label: 'Flag Equals Flag' },
  { value: 'UNIT_IN_ZONE', label: 'Unit In Zone' },
  { value: 'UNIT_ALIVE', label: 'Unit Alive' },
  { value: 'GROUP_ALIVE', label: 'Group Alive' },
  { value: 'GROUP_DEAD', label: 'Group Dead' },
  { value: 'COALITION_IN_ZONE', label: 'Coalition In Zone' },
  { value: 'PART_OF_GROUP_IN_ZONE', label: 'Part of Group In Zone' },
  { value: 'RANDOM_LESS_THAN', label: 'Random Less Than %' },
  { value: 'CUSTOM_LUA', label: 'Custom Lua' },
];

const ACTION_TYPES = [
  { value: 'SET_FLAG', label: 'Set Flag' },
  { value: 'CLEAR_FLAG', label: 'Clear Flag' },
  { value: 'FLAG_INCREASE', label: 'Flag Increase' },
  { value: 'FLAG_DECREASE', label: 'Flag Decrease' },
  { value: 'SOUND_TO_ALL', label: 'Sound To All' },
  { value: 'SOUND_TO_COALITION', label: 'Sound To Coalition' },
  { value: 'SOUND_TO_GROUP', label: 'Sound To Group' },
  { value: 'MESSAGE_TO_ALL', label: 'Message To All' },
  { value: 'MESSAGE_TO_COALITION', label: 'Message To Coalition' },
  { value: 'GROUP_ACTIVATE', label: 'Group Activate' },
  { value: 'GROUP_DEACTIVATE', label: 'Group Deactivate' },
  { value: 'AI_ON', label: 'AI On' },
  { value: 'AI_OFF', label: 'AI Off' },
  { value: 'DO_SCRIPT', label: 'Do Script' },
  { value: 'DO_SCRIPT_FILE', label: 'Do Script File' },
  { value: 'EXPLOSION', label: 'Explosion' },
  { value: 'SMOKE_MARKER', label: 'Smoke Marker' },
  { value: 'END_MISSION', label: 'End Mission' },
  { value: 'STOP_SOUND', label: 'Stop Sound' },
  { value: 'CUSTOM_LUA', label: 'Custom Lua' },
];

// ── Styles ────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#0e1929', border: '1px solid #1a2a3a', borderRadius: 8, padding: 14, marginBottom: 12,
};
const label: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#5a7a9a', marginBottom: 6,
};
const input: React.CSSProperties = {
  background: '#0a1420', border: '1px solid #1a2a3a', borderRadius: 4, color: '#ccdae8',
  padding: '5px 8px', fontSize: 14, width: '100%', boxSizing: 'border-box',
};
const select: React.CSSProperties = { ...input, cursor: 'pointer' };
const btn: React.CSSProperties = {
  background: '#1a2a3a', border: '1px solid #2a3a4a', borderRadius: 4, color: '#8aaabe',
  padding: '5px 12px', fontSize: 13, cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = { ...btn, background: '#1a3a5a', color: '#6ab4f0', borderColor: '#2a5a8a' };
const btnDanger: React.CSSProperties = { ...btn, background: '#3a1a1a', color: '#e06060', borderColor: '#5a2a2a' };
const btnSuccess: React.CSSProperties = { ...btn, background: '#1a3a2a', color: '#60c080', borderColor: '#2a5a3a' };

// ── Main Component ────────���───────────────────────────────────────────────

export function TriggerTab() {
  const sessionId = useMissionStore((s) => s.sessionId);
  const {
    rules, flags, audioFiles, loaded, isDirty, selectedRuleId,
    loadTriggers, addRule, updateRule, deleteRule, duplicateRule, moveRule,
    selectRule, addAudioFile, removeAudioFile, markClean,
  } = useTriggerStore();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'overview' | 'editor' | 'builder'>('overview');

  // Load triggers on mount
  useEffect(() => {
    if (!sessionId || loaded) return;
    setLoading(true);
    getTriggers(sessionId)
      .then((data) => loadTriggers(data.rules || [], data.flags || [], data.audioFiles || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId, loaded, loadTriggers]);

  // Save triggers to backend
  const handleSave = useCallback(async () => {
    if (!sessionId) return;
    setSaving(true);
    setError(null);
    try {
      await saveTriggers(sessionId, { rules });
      markClean();
      setStatusMsg('Triggers saved');
      setTimeout(() => setStatusMsg(null), 2000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }, [sessionId, rules, markClean]);

  const selectedRule = rules.find((r) => r.id === selectedRuleId);

  if (loading) return <div style={{ padding: 20, color: '#5a7a8a' }}>Loading triggers...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', minHeight: 500 }}>
      {/* Under Construction banner */}
      <div style={{
        background: 'rgba(210, 153, 34, 0.1)', border: '1px solid #d29922', borderRadius: 6,
        padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10,
        color: '#d29922', fontSize: 13, fontWeight: 500,
      }}>
        <span style={{ fontSize: 18 }}>&#x1F6A7;</span>
        Under Construction — This feature is still being developed.
      </div>
      {/* ── View Mode Toggle + Save ──────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12,
        padding: '8px 12px', background: '#0a1218', borderRadius: 6, border: '1px solid #12202e',
      }}>
        <button
          onClick={() => setViewMode('overview')}
          style={{
            background: viewMode === 'overview' ? '#1a3a5a' : 'transparent',
            border: `1px solid ${viewMode === 'overview' ? '#4a8fd4' : '#1a2a3a'}`,
            borderRadius: 14, color: viewMode === 'overview' ? '#4a8fd4' : '#5a7a8a',
            cursor: 'pointer', fontSize: 13, padding: '5px 16px', fontWeight: viewMode === 'overview' ? 600 : 400,
          }}
        >
          Overview
        </button>
        <button
          onClick={() => setViewMode('editor')}
          style={{
            background: viewMode === 'editor' ? '#1a3a5a' : 'transparent',
            border: `1px solid ${viewMode === 'editor' ? '#4a8fd4' : '#1a2a3a'}`,
            borderRadius: 14, color: viewMode === 'editor' ? '#4a8fd4' : '#5a7a8a',
            cursor: 'pointer', fontSize: 13, padding: '5px 16px', fontWeight: viewMode === 'editor' ? 600 : 400,
          }}
        >
          Editor
        </button>
        <button
          onClick={() => setViewMode('builder')}
          style={{
            background: viewMode === 'builder' ? '#1a3a5a' : 'transparent',
            border: `1px solid ${viewMode === 'builder' ? '#d29922' : '#1a2a3a'}`,
            borderRadius: 14, color: viewMode === 'builder' ? '#d29922' : '#5a7a8a',
            cursor: 'pointer', fontSize: 13, padding: '5px 16px', fontWeight: viewMode === 'builder' ? 600 : 400,
          }}
        >
          Builder
        </button>

        <div style={{ flex: 1 }} />

        <span style={{ color: '#5a7a8a', fontSize: 13 }}>
          <strong style={{ color: '#ccdae8' }}>{rules.length}</strong> trigger{rules.length !== 1 ? 's' : ''}
          {flags.length > 0 && <> · <strong style={{ color: '#e0a040' }}>{flags.length}</strong> flag{flags.length !== 1 ? 's' : ''}</>}
          {audioFiles.length > 0 && <> · <strong style={{ color: '#6ab4f0' }}>{audioFiles.length}</strong> audio</>}
        </span>

        <button
          style={{ ...btnSuccess, opacity: isDirty ? 1 : 0.4, padding: '5px 14px' }}
          onClick={handleSave}
          disabled={!isDirty || saving}
        >
          {saving ? 'Saving...' : isDirty ? 'Save Triggers' : 'Saved'}
        </button>
        {error && <span style={{ color: '#e06060', fontSize: 12 }}>{error}</span>}
        {statusMsg && <span style={{ color: '#60c080', fontSize: 12 }}>{statusMsg}</span>}
      </div>

      {/* ── Overview Mode ────────────────────────────── */}
      {viewMode === 'overview' && (
        <TriggerOverview
          rules={rules}
          flags={flags}
          onEditRule={(id) => { selectRule(id); setViewMode('editor'); }}
        />
      )}

      {/* ── Editor Mode ──────────────────────────────── */}
      {viewMode === 'editor' && (
        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
          {/* ── Left: Rule List ──────────────────────────── */}
          <div style={{ width: 260, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={label}>Triggers ({rules.length})</div>
              <button style={btnPrimary} onClick={addRule}>+ Add</button>
            </div>

            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {rules.map((rule, idx) => (
                <div
                  key={rule.id}
                  onClick={() => selectRule(rule.id)}
                  style={{
                    ...card,
                    marginBottom: 4,
                    cursor: 'pointer',
                    borderColor: rule.id === selectedRuleId ? '#4a8fd4' : '#1a2a3a',
                    opacity: rule.enabled ? 1 : 0.5,
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  {/* Reorder buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveRule(rule.id, 'up'); }}
                      disabled={idx === 0}
                      style={{
                        background: 'transparent', border: 'none', color: idx === 0 ? '#1a2a3a' : '#5a7a8a',
                        cursor: idx === 0 ? 'default' : 'pointer', fontSize: 10, padding: '0 2px', lineHeight: 1,
                      }}
                      title="Move up"
                    >&#9650;</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveRule(rule.id, 'down'); }}
                      disabled={idx === rules.length - 1}
                      style={{
                        background: 'transparent', border: 'none', color: idx === rules.length - 1 ? '#1a2a3a' : '#5a7a8a',
                        cursor: idx === rules.length - 1 ? 'default' : 'pointer', fontSize: 10, padding: '0 2px', lineHeight: 1,
                      }}
                      title="Move down"
                    >&#9660;</button>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#ccdae8' }}>{rule.name}</div>
                      <span style={{
                        fontSize: 11, padding: '2px 6px', borderRadius: 3,
                        background: rule.eventType === 'once' ? '#1a2a3a' : rule.eventType === 'continuous' ? '#1a3a2a' : '#3a2a1a',
                        color: rule.eventType === 'once' ? '#6a8aaa' : rule.eventType === 'continuous' ? '#60c080' : '#e0a040',
                      }}>
                        {rule.eventType}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#5a7a8a', marginTop: 4 }}>
                      {rule.conditions.length} condition{rule.conditions.length !== 1 ? 's' : ''} → {rule.actions.length} action{rule.actions.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
              ))}
              {rules.length === 0 && (
                <div style={{ color: '#3a5a6a', fontSize: 13, padding: 12, textAlign: 'center' }}>
                  No triggers found. Click + Add to create one.
                </div>
              )}
            </div>
          </div>

          {/* ── Center: Rule Editor ──────────────────────── */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {selectedRule ? (
              <RuleEditor
                rule={selectedRule}
                audioFiles={audioFiles}
                sessionId={sessionId!}
                onUpdate={(updates) => updateRule(selectedRule.id, updates)}
                onDelete={() => deleteRule(selectedRule.id)}
                onDuplicate={() => duplicateRule(selectedRule.id)}
              />
            ) : (
              <div style={{ color: '#3a5a6a', fontSize: 15, padding: 40, textAlign: 'center' }}>
                Select a trigger to edit, or click + Add to create one.
              </div>
            )}
          </div>

          {/* ── Right: Flags + Audio ─────────────────────── */}
          <div style={{ width: 280, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
            <ScriptsLibrary onAddScript={(name, lua) => {
              // Create a new trigger rule with DO_SCRIPT action, type onMissionStart
              addRule();
              // Grab the newly added rule (last in array)
              const newRules = useTriggerStore.getState().rules;
              const newest = newRules[newRules.length - 1];
              if (newest) {
                updateRule(newest.id, {
                  name: `Script: ${name}`,
                  eventType: 'onMissionStart',
                  enabled: true,
                  conditions: [],
                  actions: [{ type: 'DO_SCRIPT', params: { lua } }],
                });
                selectRule(newest.id);
              }
            }} />
            <FlagPanel flags={flags} />
            <AudioManager sessionId={sessionId!} audioFiles={audioFiles} onAdd={addAudioFile} onRemove={removeAudioFile} />
          </div>
        </div>
      )}

      {/* ── Builder Mode ─────────────────────────────── */}
      {viewMode === 'builder' && (
        <TriggerBuilder
          onAddRules={(newRules) => {
            let lastId = 0;
            for (const r of newRules) {
              // addRule creates a new rule and selects it
              addRule();
              const { rules: latest } = useTriggerStore.getState();
              const newest = latest[latest.length - 1];
              if (newest) {
                updateRule(newest.id, {
                  name: r.name,
                  eventType: r.eventType,
                  enabled: r.enabled,
                  oneTime: r.oneTime,
                  conditions: r.conditions,
                  actions: r.actions,
                });
                lastId = newest.id;
              }
            }
            if (lastId) selectRule(lastId);
            setViewMode('editor');
          }}
        />
      )}
    </div>
  );
}


// ── Trigger Overview ─────────────────────────────────────────────────────

const EVENT_BADGE: Record<string, { bg: string; color: string }> = {
  once:           { bg: '#1a2a3a', color: '#6a8aaa' },
  continuous:     { bg: '#1a3a2a', color: '#60c080' },
  onMissionStart: { bg: '#3a2a1a', color: '#e0a040' },
};

/** Human-readable summary of a condition */
function conditionSummary(c: TriggerCondition): string {
  const p = c.params;
  switch (c.type) {
    case 'TIME_MORE_THAN': return `Time > ${p.seconds}s`;
    case 'TIME_LESS_THAN': return `Time < ${p.seconds}s`;
    case 'FLAG_IS_TRUE': return `Flag ${p.flag} = TRUE`;
    case 'FLAG_IS_FALSE': return `Flag ${p.flag} = FALSE`;
    case 'FLAG_EQUALS': return `Flag ${p.flag} = ${p.value}`;
    case 'FLAG_LESS_THAN': return `Flag ${p.flag} < ${p.value}`;
    case 'FLAG_MORE_THAN': return `Flag ${p.flag} > ${p.value}`;
    case 'FLAG_EQUALS_FLAG': return `Flag ${p.flag} = Flag ${p.flag2}`;
    case 'UNIT_IN_ZONE': return `"${p.unit}" in zone "${p.zone}"`;
    case 'UNIT_ALIVE': return `"${p.unit}" alive`;
    case 'GROUP_ALIVE': return `Group "${p.group}" alive`;
    case 'GROUP_DEAD': return `Group "${p.group}" dead`;
    case 'COALITION_IN_ZONE': return `${p.coalition} in zone "${p.zone}"`;
    case 'PART_OF_GROUP_IN_ZONE': return `Part of "${p.group}" in "${p.zone}"`;
    case 'RANDOM_LESS_THAN': return `Random < ${p.percent}%`;
    case 'CUSTOM_LUA': return `Lua: ${String(p.lua || '').slice(0, 40)}${String(p.lua || '').length > 40 ? '...' : ''}`;
    default: return c.type;
  }
}

/** Human-readable summary of an action */
function actionSummary(a: TriggerAction): string {
  const p = a.params;
  switch (a.type) {
    case 'SET_FLAG': return `Set Flag ${p.flag} = ${p.value}`;
    case 'CLEAR_FLAG': return `Clear Flag ${p.flag}`;
    case 'FLAG_INCREASE': return `Flag ${p.flag} += ${p.value}`;
    case 'FLAG_DECREASE': return `Flag ${p.flag} -= ${p.value}`;
    case 'SOUND_TO_ALL': return `Sound → All: ${p.file || '?'}`;
    case 'SOUND_TO_COALITION': return `Sound → ${p.coalition}: ${p.file || '?'}`;
    case 'SOUND_TO_GROUP': return `Sound → "${p.group}": ${p.file || '?'}`;
    case 'MESSAGE_TO_ALL': return `Msg → All: "${String(p.text || '').slice(0, 30)}${String(p.text || '').length > 30 ? '...' : ''}"`;
    case 'MESSAGE_TO_COALITION': return `Msg → ${p.coalition}: "${String(p.text || '').slice(0, 25)}..."`;
    case 'GROUP_ACTIVATE': return `Activate "${p.group}"`;
    case 'GROUP_DEACTIVATE': return `Deactivate "${p.group}"`;
    case 'AI_ON': return `AI On: "${p.group}"`;
    case 'AI_OFF': return `AI Off: "${p.group}"`;
    case 'DO_SCRIPT': return `Script: ${String(p.lua || '').slice(0, 40)}${String(p.lua || '').length > 40 ? '...' : ''}`;
    case 'DO_SCRIPT_FILE': return `Script File: ${p.file || '?'}`;
    case 'EXPLOSION': return `Explosion`;
    case 'SMOKE_MARKER': return `Smoke Marker`;
    case 'END_MISSION': return `End Mission`;
    case 'STOP_SOUND': return `Stop Sound`;
    case 'CUSTOM_LUA': return `Lua: ${String(p.lua || '').slice(0, 40)}${String(p.lua || '').length > 40 ? '...' : ''}`;
    default: return a.type;
  }
}

function TriggerOverview({ rules, flags, onEditRule }: {
  rules: TriggerRule[];
  flags: { flagId: string; setBy: string[]; readBy: string[] }[];
  onEditRule: (id: number) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'once' | 'continuous' | 'onMissionStart' | 'disabled'>('all');
  const [search, setSearch] = useState('');

  const filtered = rules.filter((r) => {
    if (filter === 'disabled') return !r.enabled;
    if (filter !== 'all' && r.eventType !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.name.toLowerCase().includes(q) ||
        r.conditions.some((c) => conditionSummary(c).toLowerCase().includes(q)) ||
        r.actions.some((a) => actionSummary(a).toLowerCase().includes(q));
    }
    return true;
  });

  // Stats
  const onceCount = rules.filter((r) => r.eventType === 'once').length;
  const contCount = rules.filter((r) => r.eventType === 'continuous').length;
  const startCount = rules.filter((r) => r.eventType === 'onMissionStart').length;
  const disabledCount = rules.filter((r) => !r.enabled).length;

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      {/* Stats bar */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 12, padding: '10px 14px',
        background: '#0e1929', borderRadius: 6, border: '1px solid #1a2a3a', flexWrap: 'wrap',
      }}>
        <OverviewStat label="Total" value={rules.length} color="#ccdae8" />
        <OverviewStat label="Once" value={onceCount} color="#6a8aaa" />
        <OverviewStat label="Continuous" value={contCount} color="#60c080" />
        <OverviewStat label="Mission Start" value={startCount} color="#e0a040" />
        {disabledCount > 0 && <OverviewStat label="Disabled" value={disabledCount} color="#e06060" />}
        <OverviewStat label="Flags" value={flags.length} color="#e0a040" />
      </div>

      {/* Filter + Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['all', 'once', 'continuous', 'onMissionStart', 'disabled'] as const).map((f) => {
          const labels: Record<string, string> = { all: 'All', once: 'Once', continuous: 'Continuous', onMissionStart: 'Mission Start', disabled: 'Disabled' };
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? '#1a2a3a' : 'transparent',
                border: `1px solid ${filter === f ? '#4a8fd4' : '#1a2a3a'}`,
                borderRadius: 12, color: filter === f ? '#ccdae8' : '#5a7a8a',
                cursor: 'pointer', fontSize: 12, padding: '4px 12px',
                fontWeight: filter === f ? 600 : 400,
              }}
            >
              {labels[f]}
            </button>
          );
        })}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search triggers..."
          style={{ ...input, width: 200, fontSize: 12, padding: '4px 10px', marginLeft: 'auto' }}
        />
      </div>

      {/* Trigger table */}
      {filtered.length === 0 ? (
        <div style={{ color: '#3a5a6a', fontSize: 14, padding: 20, textAlign: 'center' }}>
          {rules.length === 0 ? 'No triggers in this mission.' : 'No triggers match your filter.'}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#ccdae8' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1a2a3a', background: '#080f1c' }}>
              <th style={{ ...overviewTh, width: 40 }}>#</th>
              <th style={overviewTh}>Name</th>
              <th style={{ ...overviewTh, width: 110 }}>Type</th>
              <th style={{ ...overviewTh, width: 50 }}>On</th>
              <th style={overviewTh}>Conditions</th>
              <th style={overviewTh}>Actions</th>
              <th style={{ ...overviewTh, width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((rule, idx) => {
              const badge = EVENT_BADGE[rule.eventType] || EVENT_BADGE.once;
              return (
                <tr
                  key={rule.id}
                  style={{
                    borderBottom: '1px solid #0f1a24',
                    opacity: rule.enabled ? 1 : 0.5,
                    background: idx % 2 === 0 ? 'transparent' : '#0a1218',
                  }}
                >
                  <td style={{ ...overviewTd, fontFamily: 'monospace', color: '#5a7a8a', textAlign: 'center' }}>
                    {rule.id}
                  </td>
                  <td style={{ ...overviewTd, fontWeight: 600 }}>
                    {rule.name}
                  </td>
                  <td style={overviewTd}>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 3,
                      background: badge.bg, color: badge.color, fontWeight: 500,
                    }}>
                      {rule.eventType}
                    </span>
                  </td>
                  <td style={{ ...overviewTd, textAlign: 'center' }}>
                    <span style={{ color: rule.enabled ? '#60c080' : '#e06060', fontWeight: 600, fontSize: 12 }}>
                      {rule.enabled ? '✓' : '✕'}
                    </span>
                  </td>
                  <td style={overviewTd}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {rule.conditions.length === 0 ? (
                        <span style={{ color: '#3a5a6a', fontSize: 12, fontStyle: 'italic' }}>always</span>
                      ) : (
                        rule.conditions.map((c, ci) => (
                          <span key={ci} style={{ fontSize: 12, color: '#8aaabe', lineHeight: 1.4 }}>
                            {conditionSummary(c)}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td style={overviewTd}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {rule.actions.length === 0 ? (
                        <span style={{ color: '#3a5a6a', fontSize: 12, fontStyle: 'italic' }}>none</span>
                      ) : (
                        rule.actions.map((a, ai) => (
                          <span key={ai} style={{ fontSize: 12, color: '#6ab4f0', lineHeight: 1.4 }}>
                            {actionSummary(a)}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td style={{ ...overviewTd, textAlign: 'center' }}>
                    <button
                      onClick={() => onEditRule(rule.id)}
                      style={{
                        background: 'transparent', border: '1px solid #1a2a3a', borderRadius: 4,
                        color: '#4a8fd4', cursor: 'pointer', fontSize: 11, padding: '3px 8px',
                      }}
                      title="Edit this trigger"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OverviewStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{ color: '#5a7a8a', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color, fontSize: 18, fontWeight: 700, fontFamily: 'monospace' }}>{value}</div>
    </div>
  );
}

const overviewTh: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left', fontWeight: 600, fontSize: 12,
  color: '#5a7a8a', whiteSpace: 'nowrap',
};
const overviewTd: React.CSSProperties = {
  padding: '8px 10px', verticalAlign: 'top',
};


// ── Trigger Builder — natural language → full scenario plan ───────────────

interface ParsedTrigger {
  name: string;
  eventType: 'once' | 'continuous' | 'onMissionStart';
  enabled: boolean;
  oneTime: boolean;
  conditions: TriggerCondition[];
  actions: TriggerAction[];
}

/** A step in the implementation plan — not just triggers, but all mission objects */
type PlanStepType = 'create_group' | 'create_zone' | 'set_late_activation' | 'assign_waypoints' | 'create_trigger';

interface PlanStep {
  type: PlanStepType;
  label: string;
  details: Record<string, string>;
  /** Only present for create_trigger steps */
  trigger?: ParsedTrigger;
  /** Warnings for this step */
  warnings: string[];
}

interface ScenarioPlan {
  steps: PlanStep[];
  triggers: ParsedTrigger[];
  complexity: number;        // 1-5
  complexityLabel: string;
  complexityColor: string;
}

const STEP_ICONS: Record<PlanStepType, { icon: string; color: string }> = {
  create_group:         { icon: '✈', color: '#6ab4f0' },
  create_zone:          { icon: '◎', color: '#d29922' },
  set_late_activation:  { icon: '⏸', color: '#e0a040' },
  assign_waypoints:     { icon: '◆', color: '#60c080' },
  create_trigger:       { icon: '⚡', color: '#c080e0' },
};

const STEP_LABELS: Record<PlanStepType, string> = {
  create_group: 'Create Group',
  create_zone: 'Create Trigger Zone',
  set_late_activation: 'Set Late Activation',
  assign_waypoints: 'Assign Waypoints',
  create_trigger: 'Create Trigger',
};

const COMPLEXITY_LEVELS: { max: number; label: string; color: string }[] = [
  { max: 1, label: 'Simple', color: '#60c080' },
  { max: 2, label: 'Basic', color: '#6ab4f0' },
  { max: 3, label: 'Moderate', color: '#d29922' },
  { max: 4, label: 'Complex', color: '#e07040' },
  { max: 5, label: 'Advanced', color: '#e06060' },
];

function getComplexity(plan: { steps: PlanStep[] }): { level: number; label: string; color: string } {
  const steps = plan.steps;
  const groupCount = steps.filter((s) => s.type === 'create_group').length;
  const zoneCount = steps.filter((s) => s.type === 'create_zone').length;
  const triggerCount = steps.filter((s) => s.type === 'create_trigger').length;
  const total = steps.length;

  let score = 1;
  if (total > 3) score = 2;
  if (groupCount >= 2 || zoneCount >= 2) score = 3;
  if (triggerCount >= 3 || total > 8) score = 4;
  if (triggerCount >= 5 || total > 12 || (groupCount >= 3 && zoneCount >= 2)) score = 5;

  const level = COMPLEXITY_LEVELS[Math.min(score - 1, COMPLEXITY_LEVELS.length - 1)];
  return { level: score, label: level.label, color: level.color };
}

/** Parse a time string like "5 min", "120s", "2 hours", "1:30" into seconds */
function parseTime(str: string): number | null {
  str = str.trim().toLowerCase();
  // mm:ss
  const mmss = str.match(/^(\d+):(\d{2})$/);
  if (mmss) return parseInt(mmss[1]) * 60 + parseInt(mmss[2]);
  // hours
  const hrs = str.match(/^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)$/);
  if (hrs) return Math.round(parseFloat(hrs[1]) * 3600);
  // minutes
  const mins = str.match(/^(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)$/);
  if (mins) return Math.round(parseFloat(mins[1]) * 60);
  // seconds
  const secs = str.match(/^(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)?$/);
  if (secs) return Math.round(parseFloat(secs[1]));
  return null;
}

/** Extract quoted strings from input */
function extractQuoted(text: string): string[] {
  const matches: string[] = [];
  const re = /["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(text)) !== null) matches.push(m[1]);
  return matches;
}

/** Core pattern matching engine */
function parseScenario(input: string): ParsedTrigger[] {
  const results: ParsedTrigger[] = [];
  // Split on newlines, semicolons, or "then"/"and then" for chaining
  const lines = input
    .split(/\n|;|(?:\band\s+then\b)|(?:\bthen\b)/i)
    .map((l) => l.trim())
    .filter(Boolean);

  let chainFlag: string | null = null;
  let stepNum = 0;

  for (const line of lines) {
    const lower = line.toLowerCase();
    const quoted = extractQuoted(line);
    stepNum++;

    // ── After/at time → activate/spawn group ──
    const timeActivate = lower.match(
      /(?:after|at)\s+([\d.:]+\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)?)\s*,?\s*(?:activate|spawn|enable|start)\s+(?:group\s+)?(.+)/i,
    );
    if (timeActivate) {
      const seconds = parseTime(timeActivate[1]);
      const groupName = quoted[0] || timeActivate[2].replace(/["']/g, '').trim();
      if (seconds != null) {
        const trigger: ParsedTrigger = {
          name: `Activate ${groupName} at ${timeActivate[1].trim()}`,
          eventType: 'once', enabled: true, oneTime: true,
          conditions: [{ type: 'TIME_MORE_THAN', params: { seconds } }],
          actions: [{ type: 'GROUP_ACTIVATE', params: { group: groupName } }],
        };
        if (chainFlag) trigger.conditions.push({ type: 'FLAG_IS_TRUE', params: { flag: chainFlag } });
        results.push(trigger);
        continue;
      }
    }

    // ── After/at time → send message ──
    const timeMsg = lower.match(
      /(?:after|at)\s+([\d.:]+\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)?)\s*,?\s*(?:send|show|display)\s+(?:message\s+)?(.+)/i,
    );
    if (timeMsg) {
      const seconds = parseTime(timeMsg[1]);
      const text = quoted[0] || timeMsg[2].replace(/["']/g, '').trim();
      if (seconds != null) {
        results.push({
          name: `Message at ${timeMsg[1].trim()}`,
          eventType: 'once', enabled: true, oneTime: true,
          conditions: [
            { type: 'TIME_MORE_THAN', params: { seconds } },
            ...(chainFlag ? [{ type: 'FLAG_IS_TRUE', params: { flag: chainFlag } }] : []),
          ],
          actions: [{ type: 'MESSAGE_TO_ALL', params: { text, duration: 10 } }],
        });
        continue;
      }
    }

    // ── After/at time → set flag ──
    const timeFlag = lower.match(
      /(?:after|at)\s+([\d.:]+\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)?)\s*,?\s*set\s+flag\s+(\S+)/i,
    );
    if (timeFlag) {
      const seconds = parseTime(timeFlag[1]);
      const flag = timeFlag[2].replace(/["']/g, '');
      if (seconds != null) {
        results.push({
          name: `Set flag ${flag} at ${timeFlag[1].trim()}`,
          eventType: 'once', enabled: true, oneTime: true,
          conditions: [
            { type: 'TIME_MORE_THAN', params: { seconds } },
            ...(chainFlag ? [{ type: 'FLAG_IS_TRUE', params: { flag: chainFlag } }] : []),
          ],
          actions: [{ type: 'SET_FLAG', params: { flag, value: true } }],
        });
        chainFlag = flag;
        continue;
      }
    }

    // ── When/if group dead/destroyed → action ──
    const groupDead = lower.match(
      /(?:when|if|once)\s+(?:group\s+)?["']?([^"']+?)["']?\s+(?:is\s+)?(?:dead|destroyed|killed|down)\s*,?\s*(.+)/i,
    );
    if (groupDead) {
      const groupName = quoted[0] || groupDead[1].trim();
      const actionPart = groupDead[2].trim();
      const trigger: ParsedTrigger = {
        name: `On ${groupName} dead`,
        eventType: 'once', enabled: true, oneTime: true,
        conditions: [
          { type: 'GROUP_DEAD', params: { group: groupName } },
          ...(chainFlag ? [{ type: 'FLAG_IS_TRUE', params: { flag: chainFlag } }] : []),
        ],
        actions: [],
      };
      // Parse action part
      parseActionInto(actionPart, trigger, quoted.slice(1));
      results.push(trigger);
      continue;
    }

    // ── When/if unit/player enters zone → action ──
    const unitZone = lower.match(
      /(?:when|if|once)\s+(?:(?:a|any|the)\s+)?(?:player|unit|coalition|blue|red)\s+(?:enters?|is\s+in|inside|in)\s+(?:zone\s+)?["']?([^"',]+?)["']?\s*,?\s*(.+)/i,
    );
    if (unitZone) {
      const zoneName = quoted[0] || unitZone[1].trim();
      const actionPart = unitZone[2].trim();
      const isCoalition = /\b(?:blue|red|player)\b/i.test(lower);
      const coalitionMatch = lower.match(/\b(blue|red)\b/i);
      const coalition = coalitionMatch ? coalitionMatch[1].toLowerCase() : 'blue';
      const trigger: ParsedTrigger = {
        name: `On enter ${zoneName}`,
        eventType: 'once', enabled: true, oneTime: true,
        conditions: [
          isCoalition
            ? { type: 'COALITION_IN_ZONE', params: { coalition, zone: zoneName } }
            : { type: 'UNIT_IN_ZONE', params: { unit: quoted[0] || 'player', zone: zoneName } },
          ...(chainFlag ? [{ type: 'FLAG_IS_TRUE', params: { flag: chainFlag } }] : []),
        ],
        actions: [],
      };
      parseActionInto(actionPart, trigger, quoted.slice(1));
      results.push(trigger);
      continue;
    }

    // ── When/if flag is true → action ──
    const flagTrue = lower.match(
      /(?:when|if|once)\s+flag\s+(\S+)\s+(?:is\s+)?(?:true|set|on)\s*,?\s*(.+)/i,
    );
    if (flagTrue) {
      const flag = flagTrue[1];
      const actionPart = flagTrue[2].trim();
      const trigger: ParsedTrigger = {
        name: `On flag ${flag}`,
        eventType: 'once', enabled: true, oneTime: true,
        conditions: [{ type: 'FLAG_IS_TRUE', params: { flag } }],
        actions: [],
      };
      parseActionInto(actionPart, trigger, quoted);
      results.push(trigger);
      continue;
    }

    // ── Simple: activate/spawn group (no condition — mission start) ──
    const simpleActivate = lower.match(
      /^(?:activate|spawn|enable|start)\s+(?:group\s+)?(.+)/i,
    );
    if (simpleActivate) {
      const groupName = quoted[0] || simpleActivate[1].replace(/["']/g, '').trim();
      results.push({
        name: `Activate ${groupName}`,
        eventType: 'onMissionStart', enabled: true, oneTime: true,
        conditions: chainFlag ? [{ type: 'FLAG_IS_TRUE', params: { flag: chainFlag } }] : [],
        actions: [{ type: 'GROUP_ACTIVATE', params: { group: groupName } }],
      });
      continue;
    }

    // ── Simple: deactivate group ──
    const simpleDeactivate = lower.match(
      /^(?:deactivate|disable|stop|remove)\s+(?:group\s+)?(.+)/i,
    );
    if (simpleDeactivate) {
      const groupName = quoted[0] || simpleDeactivate[1].replace(/["']/g, '').trim();
      results.push({
        name: `Deactivate ${groupName}`,
        eventType: 'onMissionStart', enabled: true, oneTime: true,
        conditions: chainFlag ? [{ type: 'FLAG_IS_TRUE', params: { flag: chainFlag } }] : [],
        actions: [{ type: 'GROUP_DEACTIVATE', params: { group: groupName } }],
      });
      continue;
    }

    // ── Simple: send message ──
    const simpleMsg = lower.match(
      /^(?:send|show|display)\s+(?:message\s+)?(.+)/i,
    );
    if (simpleMsg) {
      const text = quoted[0] || simpleMsg[1].replace(/["']/g, '').trim();
      results.push({
        name: `Message: ${text.slice(0, 30)}`,
        eventType: 'onMissionStart', enabled: true, oneTime: true,
        conditions: chainFlag ? [{ type: 'FLAG_IS_TRUE', params: { flag: chainFlag } }] : [],
        actions: [{ type: 'MESSAGE_TO_ALL', params: { text, duration: 10 } }],
      });
      continue;
    }

    // ── Simple: end mission ──
    if (/^end\s+(?:the\s+)?mission/i.test(lower)) {
      results.push({
        name: 'End Mission',
        eventType: 'once', enabled: true, oneTime: true,
        conditions: chainFlag ? [{ type: 'FLAG_IS_TRUE', params: { flag: chainFlag } }] : [],
        actions: [{ type: 'END_MISSION', params: {} }],
      });
      continue;
    }

    // ── Fallback: couldn't parse ──
    if (line.length > 2) {
      results.push({
        name: `[Unparsed] ${line.slice(0, 50)}`,
        eventType: 'once', enabled: true, oneTime: true,
        conditions: [], actions: [],
      });
    }
  }

  return results;
}

/** Parse an action description and push into a trigger */
function parseActionInto(text: string, trigger: ParsedTrigger, quoted: string[]) {
  const lower = text.toLowerCase();

  // activate/spawn group
  const actGroup = lower.match(/(?:activate|spawn|enable|start)\s+(?:group\s+)?(.+)/i);
  if (actGroup) {
    trigger.actions.push({ type: 'GROUP_ACTIVATE', params: { group: quoted[0] || actGroup[1].replace(/["']/g, '').trim() } });
    return;
  }

  // deactivate group
  const deactGroup = lower.match(/(?:deactivate|disable|stop|remove)\s+(?:group\s+)?(.+)/i);
  if (deactGroup) {
    trigger.actions.push({ type: 'GROUP_DEACTIVATE', params: { group: quoted[0] || deactGroup[1].replace(/["']/g, '').trim() } });
    return;
  }

  // send message
  const msg = lower.match(/(?:send|show|display)\s+(?:message\s+)?(.+)/i);
  if (msg) {
    trigger.actions.push({ type: 'MESSAGE_TO_ALL', params: { text: quoted[0] || msg[1].replace(/["']/g, '').trim(), duration: 10 } });
    return;
  }

  // set flag
  const setF = lower.match(/set\s+flag\s+(\S+)/i);
  if (setF) {
    trigger.actions.push({ type: 'SET_FLAG', params: { flag: setF[1], value: true } });
    return;
  }

  // end mission
  if (/end\s+(?:the\s+)?mission/i.test(lower)) {
    trigger.actions.push({ type: 'END_MISSION', params: {} });
    return;
  }

  // explosion
  if (/explod|explosion|blow/i.test(lower)) {
    trigger.actions.push({ type: 'EXPLOSION', params: {} });
    return;
  }

  // AI on/off
  const aiOn = lower.match(/(?:ai|a\.i\.?)\s+on\s+(?:for\s+)?(.+)/i);
  if (aiOn) {
    trigger.actions.push({ type: 'AI_ON', params: { group: quoted[0] || aiOn[1].replace(/["']/g, '').trim() } });
    return;
  }
  const aiOff = lower.match(/(?:ai|a\.i\.?)\s+off\s+(?:for\s+)?(.+)/i);
  if (aiOff) {
    trigger.actions.push({ type: 'AI_OFF', params: { group: quoted[0] || aiOff[1].replace(/["']/g, '').trim() } });
    return;
  }

  // Fallback — couldn't determine action, leave empty
}

/** Build a full implementation plan from parsed triggers — identifies all mission objects needed */
function buildPlan(
  triggers: ParsedTrigger[],
  existingGroups: Set<string>,
  existingZones: Set<string>,
): ScenarioPlan {
  const steps: PlanStep[] = [];
  const neededGroups = new Set<string>();
  const neededZones = new Set<string>();

  // First pass: collect all referenced groups and zones
  for (const t of triggers) {
    for (const c of t.conditions) {
      if (c.params.group && typeof c.params.group === 'string') neededGroups.add(c.params.group);
      if (c.params.zone && typeof c.params.zone === 'string') neededZones.add(c.params.zone);
    }
    for (const a of t.actions) {
      if (a.params.group && typeof a.params.group === 'string') neededGroups.add(a.params.group);
    }
  }

  // Step: Create trigger zones that don't exist
  for (const zone of neededZones) {
    const exists = existingZones.has(zone);
    steps.push({
      type: 'create_zone',
      label: `Create trigger zone "${zone}"`,
      details: {
        'Name': zone,
        'Radius': '5000m (default)',
        'Status': exists ? 'Already exists in mission' : 'Needs to be created',
      },
      warnings: exists ? [] : [`Zone "${zone}" does not exist — will need to be created and positioned on the map`],
    });
  }

  // Step: Create groups that are activated by triggers and don't exist
  // Also detect groups that are referenced in GROUP_DEAD conditions (they should already exist and be active)
  const activatedGroups = new Set<string>();
  const watchedGroups = new Set<string>();
  for (const t of triggers) {
    for (const a of t.actions) {
      if (a.type === 'GROUP_ACTIVATE' && a.params.group) activatedGroups.add(a.params.group as string);
      if (a.type === 'GROUP_DEACTIVATE' && a.params.group) activatedGroups.add(a.params.group as string);
    }
    for (const c of t.conditions) {
      if ((c.type === 'GROUP_DEAD' || c.type === 'GROUP_ALIVE') && c.params.group) watchedGroups.add(c.params.group as string);
    }
  }

  for (const group of neededGroups) {
    const exists = existingGroups.has(group);
    const isActivated = activatedGroups.has(group);
    const isWatched = watchedGroups.has(group);

    if (!exists) {
      // Needs to be created
      steps.push({
        type: 'create_group',
        label: `Create group "${group}"`,
        details: {
          'Group Name': group,
          'Status': 'Needs to be created',
          'Coalition': isWatched ? 'Determine from scenario' : 'Determine from scenario',
        },
        warnings: [`Group "${group}" does not exist in the mission and will need to be created`],
      });

      if (isActivated) {
        steps.push({
          type: 'set_late_activation',
          label: `Set "${group}" to late activation`,
          details: {
            'Group': group,
            'Reason': 'Group is spawned by a trigger — must start deactivated',
          },
          warnings: [],
        });
      }

      steps.push({
        type: 'assign_waypoints',
        label: `Assign waypoints for "${group}"`,
        details: {
          'Group': group,
          'Route': 'Waypoints need to be defined',
        },
        warnings: [`Route for "${group}" needs to be planned — place waypoints on the map`],
      });
    } else {
      // Exists — check if it needs late activation
      if (isActivated) {
        steps.push({
          type: 'set_late_activation',
          label: `Verify "${group}" has late activation set`,
          details: {
            'Group': group,
            'Status': 'Exists in mission',
            'Reason': 'Group is activated by a trigger — must be late-activated',
          },
          warnings: [`Verify "${group}" has late activation enabled in the ME, or it will already be spawned`],
        });
      }
    }
  }

  // Step: Create each trigger
  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i];
    const isUnparsed = t.name.startsWith('[Unparsed]');
    const warnings: string[] = [];

    if (isUnparsed) {
      warnings.push('Could not parse this line — try rephrasing');
    }
    if (t.conditions.length === 0 && t.actions.length > 0 && t.eventType === 'once') {
      warnings.push('No conditions — will fire immediately');
    }
    if (t.actions.length === 0 && !isUnparsed) {
      warnings.push('No actions — trigger won\'t do anything');
    }

    // Check flag references
    for (const c of t.conditions) {
      if ((c.type === 'FLAG_IS_TRUE' || c.type === 'FLAG_IS_FALSE') && c.params.flag) {
        const flagId = String(c.params.flag);
        const isSet = triggers.some((other) =>
          other !== t && other.actions.some((a) =>
            (a.type === 'SET_FLAG' || a.type === 'CLEAR_FLAG') && String(a.params.flag) === flagId,
          ),
        );
        if (!isSet) warnings.push(`Flag ${flagId} is checked but never set by another trigger in this plan`);
      }
    }

    steps.push({
      type: 'create_trigger',
      label: `Create trigger: ${t.name}`,
      details: {
        'Name': t.name,
        'Type': t.eventType,
        'Conditions': t.conditions.length > 0 ? t.conditions.map((c) => conditionSummary(c)).join(', ') : 'None (immediate)',
        'Actions': t.actions.length > 0 ? t.actions.map((a) => actionSummary(a)).join(', ') : 'None',
      },
      trigger: t,
      warnings,
    });
  }

  const comp = getComplexity({ steps });

  return {
    steps,
    triggers,
    complexity: comp.level,
    complexityLabel: comp.label,
    complexityColor: comp.color,
  };
}


const BUILDER_EXAMPLES = [
  'After 5 min, activate group "SA-6 Battery"',
  'When player enters zone "AO North", send message "Entering hostile airspace"',
  'When group "Target Convoy" is destroyed, activate "Backup SAM"',
  'After 10 min, activate "CAP Flight"; when "CAP Flight" is dead, end mission',
  'After 2 min, send message "Intel: enemy convoy spotted moving north"',
  'When blue enters zone "Objective", set flag 1; when flag 1 is true, activate "QRF"',
];

/** Generate warnings for a parsed trigger against mission data */
function getWarnings(
  trigger: ParsedTrigger,
  allTriggers: ParsedTrigger[],
  groupNames: Set<string>,
  zoneNames: Set<string>,
): string[] {
  const warnings: string[] = [];

  // Check group/zone references in conditions
  for (const c of trigger.conditions) {
    const p = c.params;
    if (p.group && typeof p.group === 'string' && !groupNames.has(p.group)) {
      warnings.push(`Group "${p.group}" not found in mission`);
    }
    if (p.zone && typeof p.zone === 'string' && !zoneNames.has(p.zone)) {
      warnings.push(`Zone "${p.zone}" not found in mission`);
    }
    if (p.unit && typeof p.unit === 'string' && p.unit !== 'player') {
      warnings.push(`Unit "${p.unit}" — verify this unit name exists`);
    }
    // Check if flag is read but never set by another trigger in the chain
    if ((c.type === 'FLAG_IS_TRUE' || c.type === 'FLAG_IS_FALSE') && p.flag) {
      const flagId = String(p.flag);
      const isSetAnywhere = allTriggers.some((t) =>
        t !== trigger && t.actions.some((a) =>
          (a.type === 'SET_FLAG' || a.type === 'CLEAR_FLAG') && String(a.params.flag) === flagId,
        ),
      );
      if (!isSetAnywhere) warnings.push(`Flag ${flagId} is checked but never set by another trigger in this plan`);
    }
  }

  // Check group references in actions
  for (const a of trigger.actions) {
    const p = a.params;
    if (p.group && typeof p.group === 'string' && !groupNames.has(p.group)) {
      warnings.push(`Group "${p.group}" not found in mission`);
    }
    if ((a.type === 'MESSAGE_TO_ALL' || a.type === 'MESSAGE_TO_COALITION') && !p.text) {
      warnings.push('Message action has no text');
    }
  }

  if (trigger.conditions.length === 0 && trigger.actions.length > 0 && trigger.eventType === 'once') {
    warnings.push('No conditions — this trigger will fire immediately');
  }
  if (trigger.actions.length === 0 && !trigger.name.startsWith('[Unparsed]')) {
    warnings.push('No actions defined — trigger won\'t do anything');
  }

  return warnings;
}

/** Format seconds into human-readable */
function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Get all param key/value pairs for display */
function getParamEntries(params: Record<string, unknown>): [string, string][] {
  return Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => {
      if (k === 'seconds' && typeof v === 'number') return [k, formatSeconds(v)];
      if (typeof v === 'boolean') return [k, v ? 'true' : 'false'];
      return [k, String(v)];
    });
}


function TriggerBuilder({ onAddRules }: {
  onAddRules: (rules: ParsedTrigger[]) => void;
}) {
  const [inputText, setInputText] = useState('');
  const [preview, setPreview] = useState<ParsedTrigger[]>([]);
  const [plan, setPlan] = useState<ScenarioPlan | null>(null);
  const [hasError, setHasError] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  // Mission data for validation
  const groups = useMissionStore((s) => s.groups);
  const triggerZones = useMissionStore((s) => s.triggerZones);
  const groupNames = new Set(groups.map((g) => g.groupName));
  const zoneNames = new Set(triggerZones.map((z) => z.name));

  const handleInputChange = useCallback((val: string) => {
    setInputText(val);
    if (!val.trim()) { setPreview([]); setPlan(null); setHasError(false); setExpandedSteps(new Set()); return; }
    const parsed = parseScenario(val);
    setPreview(parsed);
    setHasError(parsed.some((p) => p.name.startsWith('[Unparsed]')));
    const newPlan = buildPlan(parsed, groupNames, zoneNames);
    setPlan(newPlan);
    // Auto-expand all steps
    setExpandedSteps(new Set(newPlan.steps.map((_, i) => i)));
  }, [groupNames, zoneNames]);

  // Edit a trigger's field in preview — also rebuild plan
  const updateTrigger = useCallback((trigIdx: number, updates: Partial<ParsedTrigger>) => {
    setPreview((prev) => {
      const next = prev.map((t, i) => i === trigIdx ? { ...t, ...updates } : t);
      setPlan(buildPlan(next, groupNames, zoneNames));
      return next;
    });
  }, [groupNames, zoneNames]);

  // Edit a condition param
  const updateCondParam = useCallback((trigIdx: number, condIdx: number, key: string, value: unknown) => {
    setPreview((prev) => {
      const next = prev.map((t, ti) => {
        if (ti !== trigIdx) return t;
        const conditions = t.conditions.map((c, ci) => {
          if (ci !== condIdx) return c;
          return { ...c, params: { ...c.params, [key]: value } };
        });
        return { ...t, conditions };
      });
      setPlan(buildPlan(next, groupNames, zoneNames));
      return next;
    });
  }, [groupNames, zoneNames]);

  // Edit an action param
  const updateActionParam = useCallback((trigIdx: number, actIdx: number, key: string, value: unknown) => {
    setPreview((prev) => {
      const next = prev.map((t, ti) => {
        if (ti !== trigIdx) return t;
        const actions = t.actions.map((a, ai) => {
          if (ai !== actIdx) return a;
          return { ...a, params: { ...a.params, [key]: value } };
        });
        return { ...t, actions };
      });
      setPlan(buildPlan(next, groupNames, zoneNames));
      return next;
    });
  }, [groupNames, zoneNames]);

  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const previewInputStyle: React.CSSProperties = {
    background: '#0a1420', border: '1px solid #1a2a3a', borderRadius: 3,
    color: '#ccdae8', fontSize: 12, padding: '3px 6px', fontFamily: 'monospace',
    boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ flex: 1, display: 'flex', gap: 16, minHeight: 0 }}>
      {/* Left: Input */}
      <div style={{ width: 360, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{
          padding: '12px 16px', background: '#0e1929', borderRadius: 6,
          border: '1px solid #1a2a3a',
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ccdae8', marginBottom: 4 }}>
            Trigger Builder
          </div>
          <div style={{ fontSize: 12, color: '#5a7a8a', lineHeight: 1.5 }}>
            Describe your scenario in plain language. Use quotes for group/zone names.
            Chain steps with newlines or semicolons.
          </div>
        </div>

        <textarea
          value={inputText}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={'e.g. After 5 minutes, activate group "SA-6 Battery"\nWhen player enters zone "AO", send message "Warning"'}
          style={{
            background: '#0a1420', border: '1px solid #1a2a3a', borderRadius: 6,
            color: '#ccdae8', fontSize: 14, padding: '14px 16px', width: '100%',
            boxSizing: 'border-box' as const,
            fontFamily: 'inherit', resize: 'vertical', minHeight: 120,
            lineHeight: 1.6, flex: 1,
          }}
        />

        {/* Examples */}
        <div style={{
          padding: '10px 14px', background: '#0e1929', borderRadius: 6,
          border: '1px solid #1a2a3a',
        }}>
          <div style={{ fontSize: 11, color: '#5a7a8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Examples — click to try
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {BUILDER_EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => handleInputChange(ex)}
                style={{
                  background: 'transparent', border: '1px solid #12202e',
                  borderRadius: 4, color: '#6a8a9a', fontSize: 12,
                  padding: '5px 10px', cursor: 'pointer', textAlign: 'left',
                  lineHeight: 1.4,
                }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Implementation Plan */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        {/* Header with complexity meter + Add button */}
        <div style={{
          padding: '12px 16px', background: '#0e1929', borderRadius: 6,
          border: '1px solid #1a2a3a',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#ccdae8' }}>
                Implementation Plan
              </div>
              <div style={{ fontSize: 11, color: '#5a7a8a' }}>
                {!plan
                  ? 'Type a scenario to see the full plan'
                  : `${plan.steps.length} step${plan.steps.length !== 1 ? 's' : ''} · ${preview.length} trigger${preview.length !== 1 ? 's' : ''}`}
              </div>
            </div>
            {/* Complexity meter */}
            {plan && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ display: 'flex', gap: 2 }}>
                  {[1, 2, 3, 4, 5].map((lvl) => (
                    <div
                      key={lvl}
                      style={{
                        width: 6, height: 16 + lvl * 3, borderRadius: 2,
                        background: lvl <= plan.complexity ? plan.complexityColor : '#1a2a3a',
                        transition: 'background 0.2s',
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: plan.complexityColor }}>
                  {plan.complexityLabel}
                </span>
              </div>
            )}
          </div>
          {preview.length > 0 && !hasError && (
            <button
              onClick={() => onAddRules(preview)}
              style={{
                ...btnSuccess,
                padding: '7px 18px', fontSize: 13, fontWeight: 600,
              }}
            >
              Add {preview.length} Trigger{preview.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>

        {/* Timeline steps */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
          {!plan && (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#2a3a4a', fontSize: 14,
            }}>
              Implementation plan will appear here
            </div>
          )}
          {plan && plan.steps.map((step, si) => {
            const stepMeta = STEP_ICONS[step.type];
            const isExpanded = expandedSteps.has(si);
            const isLast = si === plan.steps.length - 1;
            const isTriggerStep = step.type === 'create_trigger' && step.trigger;

            // Find the trigger index for this step (for editing)
            let trigIdx = -1;
            if (isTriggerStep && step.trigger) {
              trigIdx = preview.indexOf(step.trigger);
            }

            return (
              <div key={si} style={{ display: 'flex', gap: 0 }}>
                {/* Timeline spine */}
                <div style={{
                  width: 32, display: 'flex', flexDirection: 'column', alignItems: 'center',
                  flexShrink: 0,
                }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: step.warnings.length > 0 ? '#1a1a0e' : '#0e1929',
                    border: `2px solid ${step.warnings.length > 0 ? '#d29922' : stepMeta.color}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, flexShrink: 0,
                  }}>
                    {stepMeta.icon}
                  </div>
                  {!isLast && (
                    <div style={{
                      width: 2, flex: 1, minHeight: 8,
                      background: `linear-gradient(${stepMeta.color}40, ${STEP_ICONS[plan.steps[si + 1]?.type]?.color || '#1a2a3a'}40)`,
                    }} />
                  )}
                </div>

                {/* Step content */}
                <div style={{
                  flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 4,
                  marginLeft: 8,
                }}>
                  {/* Step header — clickable */}
                  <div
                    onClick={() => toggleStep(si)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      cursor: 'pointer', padding: '4px 0',
                      userSelect: 'none',
                    }}
                  >
                    <span style={{
                      fontSize: 9, color: '#4a6a7a', fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: 1, minWidth: 90,
                    }}>
                      {STEP_LABELS[step.type]}
                    </span>
                    <span style={{
                      fontSize: 13, color: '#ccdae8', fontWeight: 500,
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {step.label}
                    </span>
                    {step.warnings.length > 0 && (
                      <span style={{ fontSize: 10, color: '#d29922' }} title={step.warnings.join('\n')}>
                        {'\u26A0'} {step.warnings.length}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: '#3a5a6a', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)' }}>
                      {'\u25B6'}
                    </span>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div style={{
                      background: '#0a1218', borderRadius: 6, padding: '10px 12px',
                      border: '1px solid #12202e', marginTop: 4, marginBottom: 8,
                    }}>
                      {/* Details key-value pairs */}
                      {!isTriggerStep && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {Object.entries(step.details).map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                              <span style={{ color: '#4a6a7a', fontWeight: 600, minWidth: 80, textTransform: 'uppercase', fontSize: 10, paddingTop: 2 }}>{k}</span>
                              <span style={{ color: v.includes('Needs') || v.includes('not exist') ? '#d29922' : v.includes('Already') ? '#60c080' : '#8aaabe' }}>
                                {v}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* For trigger steps: show full editable conditions & actions */}
                      {isTriggerStep && step.trigger && trigIdx >= 0 && (() => {
                        const trigger = step.trigger!;
                        const badge = EVENT_BADGE[trigger.eventType] || EVENT_BADGE.once;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {/* Trigger name + type */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6, borderBottom: '1px solid #12202e' }}>
                              <input
                                value={trigger.name}
                                onChange={(e) => updateTrigger(trigIdx, { name: e.target.value })}
                                style={{
                                  ...previewInputStyle,
                                  fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
                                  color: trigger.name.startsWith('[Unparsed]') ? '#e06060' : '#ccdae8',
                                  background: 'transparent', border: '1px solid transparent',
                                  padding: '2px 6px', flex: 1,
                                }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = '#1a3a5a'; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
                              />
                              <select
                                value={trigger.eventType}
                                onChange={(e) => updateTrigger(trigIdx, { eventType: e.target.value as ParsedTrigger['eventType'] })}
                                style={{
                                  background: badge.bg, border: `1px solid ${badge.color}30`,
                                  borderRadius: 3, color: badge.color, fontSize: 11,
                                  padding: '2px 6px', cursor: 'pointer', fontWeight: 500,
                                }}
                              >
                                <option value="once">once</option>
                                <option value="continuous">continuous</option>
                                <option value="onMissionStart">onMissionStart</option>
                              </select>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#5a7a8a', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={trigger.enabled}
                                  onChange={(e) => updateTrigger(trigIdx, { enabled: e.target.checked })}
                                  style={{ accentColor: '#60c080' }}
                                />
                                On
                              </label>
                            </div>

                            {trigger.name.startsWith('[Unparsed]') && (
                              <div style={{ fontSize: 12, color: '#e06060', fontStyle: 'italic' }}>
                                Could not parse this line. Try rephrasing or check the examples.
                              </div>
                            )}

                            {/* Conditions */}
                            {trigger.conditions.length > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 600, color: '#5a7a8a', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                                  Conditions ({trigger.conditions.length})
                                </div>
                                {trigger.conditions.map((c, ci) => {
                                  const params = getParamEntries(c.params);
                                  return (
                                    <div key={ci} style={{
                                      background: '#0a1420', borderRadius: 4, padding: '6px 8px',
                                      marginBottom: ci < trigger.conditions.length - 1 ? 4 : 0,
                                      border: '1px solid #12202e',
                                    }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: params.length > 0 ? 4 : 0 }}>
                                        <span style={{ fontSize: 12, color: '#8aaabe', fontWeight: 600 }}>
                                          {conditionSummary(c)}
                                        </span>
                                        <span style={{ fontSize: 10, color: '#3a5a6a', fontFamily: 'monospace' }}>
                                          {c.type}
                                        </span>
                                      </div>
                                      {params.length > 0 && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                          {params.map(([k, v]) => (
                                            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                              <span style={{ fontSize: 10, color: '#4a6a7a', fontWeight: 600, textTransform: 'uppercase' }}>{k}</span>
                                              <input
                                                value={v}
                                                onChange={(e) => {
                                                  const raw = e.target.value;
                                                  const asNum = Number(raw);
                                                  updateCondParam(trigIdx, ci, k, !isNaN(asNum) && raw.trim() !== '' && k !== 'group' && k !== 'zone' && k !== 'unit' && k !== 'coalition' && k !== 'flag' && k !== 'flag2' ? asNum : raw);
                                                }}
                                                style={{ ...previewInputStyle, width: Math.max(50, v.length * 8 + 20) }}
                                              />
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Actions */}
                            {trigger.actions.length > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 600, color: '#5a7a8a', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                                  Actions ({trigger.actions.length})
                                </div>
                                {trigger.actions.map((a, ai) => {
                                  const params = getParamEntries(a.params);
                                  return (
                                    <div key={ai} style={{
                                      background: '#0a1420', borderRadius: 4, padding: '6px 8px',
                                      marginBottom: ai < trigger.actions.length - 1 ? 4 : 0,
                                      border: '1px solid #12202e',
                                    }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: params.length > 0 ? 4 : 0 }}>
                                        <span style={{ fontSize: 12, color: '#6ab4f0', fontWeight: 600 }}>
                                          {actionSummary(a)}
                                        </span>
                                        <span style={{ fontSize: 10, color: '#3a5a6a', fontFamily: 'monospace' }}>
                                          {a.type}
                                        </span>
                                      </div>
                                      {params.length > 0 && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                          {params.map(([k, v]) => (
                                            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                              <span style={{ fontSize: 10, color: '#4a6a7a', fontWeight: 600, textTransform: 'uppercase' }}>{k}</span>
                                              {k === 'text' || k === 'lua' ? (
                                                <textarea
                                                  value={v}
                                                  onChange={(e) => updateActionParam(trigIdx, ai, k, e.target.value)}
                                                  rows={k === 'lua' ? 3 : 2}
                                                  style={{ ...previewInputStyle, width: '100%', resize: 'vertical', minHeight: 28 }}
                                                />
                                              ) : (
                                                <input
                                                  value={v}
                                                  onChange={(e) => {
                                                    const raw = e.target.value;
                                                    const asNum = Number(raw);
                                                    updateActionParam(trigIdx, ai, k, !isNaN(asNum) && raw.trim() !== '' && k !== 'group' && k !== 'file' && k !== 'coalition' && k !== 'flag' ? asNum : raw);
                                                  }}
                                                  style={{ ...previewInputStyle, width: Math.max(50, v.length * 8 + 20) }}
                                                />
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {trigger.conditions.length === 0 && trigger.actions.length === 0 && !trigger.name.startsWith('[Unparsed]') && (
                              <div style={{ fontSize: 12, color: '#3a5a6a', fontStyle: 'italic' }}>
                                No conditions or actions — will run on mission start
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Warnings */}
                      {step.warnings.length > 0 && (
                        <div style={{ marginTop: isTriggerStep ? 8 : 6, paddingTop: 6, borderTop: '1px solid #12202e' }}>
                          {step.warnings.map((w, wi) => (
                            <div key={wi} style={{
                              fontSize: 11, color: '#d29922', display: 'flex', alignItems: 'flex-start', gap: 6,
                              marginBottom: wi < step.warnings.length - 1 ? 3 : 0, lineHeight: 1.4,
                            }}>
                              <span style={{ flexShrink: 0 }}>{'\u26A0'}</span>
                              <span>{w}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ── Rule Editor ───────────────────────────────────────────────────────────

function RuleEditor({
  rule, audioFiles, sessionId, onUpdate, onDelete, onDuplicate,
}: {
  rule: TriggerRule;
  audioFiles: AudioFile[];
  sessionId: string;
  onUpdate: (updates: Partial<TriggerRule>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={label}>Name</div>
          <input
            style={input}
            value={rule.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
          />
        </div>
        <div style={{ width: 140 }}>
          <div style={label}>Type</div>
          <select
            style={select}
            value={rule.eventType}
            onChange={(e) => onUpdate({ eventType: e.target.value as TriggerRule['eventType'] })}
          >
            <option value="once">Once</option>
            <option value="continuous">Continuous</option>
            <option value="onMissionStart">On Mission Start</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#8aaabe', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => onUpdate({ enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>
        <div style={{ display: 'flex', gap: 6, paddingTop: 18 }}>
          <button style={btn} onClick={onDuplicate}>Duplicate</button>
          <button style={btnDanger} onClick={onDelete}>Delete</button>
        </div>
      </div>

      {/* Conditions */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={label}>Conditions (ALL must be true)</div>
          <button style={btn} onClick={() => {
            onUpdate({ conditions: [...rule.conditions, { type: 'FLAG_IS_TRUE', params: { flag: '1' } }] });
          }}>+ Add</button>
        </div>
        {rule.conditions.length === 0 && (
          <div style={{ color: '#3a5a6a', fontSize: 13, padding: 8 }}>No conditions — trigger will always fire.</div>
        )}
        {rule.conditions.map((cond, i) => (
          <ConditionRow
            key={i}
            condition={cond}
            onChange={(updated) => {
              const newConds = [...rule.conditions];
              newConds[i] = updated;
              onUpdate({ conditions: newConds });
            }}
            onDelete={() => {
              onUpdate({ conditions: rule.conditions.filter((_, j) => j !== i) });
            }}
          />
        ))}
      </div>

      {/* Actions */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={label}>Actions</div>
          <button style={btn} onClick={() => {
            onUpdate({ actions: [...rule.actions, { type: 'SET_FLAG', params: { flag: '1', value: true } }] });
          }}>+ Add</button>
        </div>
        {rule.actions.length === 0 && (
          <div style={{ color: '#3a5a6a', fontSize: 13, padding: 8 }}>No actions defined.</div>
        )}
        {rule.actions.map((act, i) => (
          <ActionRow
            key={i}
            action={act}
            audioFiles={audioFiles}
            sessionId={sessionId}
            onChange={(updated) => {
              const newActs = [...rule.actions];
              newActs[i] = updated;
              onUpdate({ actions: newActs });
            }}
            onDelete={() => {
              onUpdate({ actions: rule.actions.filter((_, j) => j !== i) });
            }}
          />
        ))}
      </div>
    </div>
  );
}


// ── Condition Row ───────────────���─────────────────────────────────────────

function ConditionRow({
  condition, onChange, onDelete,
}: {
  condition: TriggerCondition;
  onChange: (c: TriggerCondition) => void;
  onDelete: () => void;
}) {
  const updateParam = (key: string, value: unknown) => {
    onChange({ ...condition, params: { ...condition.params, [key]: value } });
  };

  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0',
      borderBottom: '1px solid #152030', flexWrap: 'wrap',
    }}>
      <select
        style={{ ...select, width: 180 }}
        value={condition.type}
        onChange={(e) => onChange({ type: e.target.value, params: getDefaultCondParams(e.target.value) })}
      >
        {CONDITION_TYPES.map((ct) => (
          <option key={ct.value} value={ct.value}>{ct.label}</option>
        ))}
      </select>

      {/* Type-specific params */}
      {(condition.type === 'TIME_MORE_THAN' || condition.type === 'TIME_LESS_THAN') && (
        <input
          style={{ ...input, width: 100 }}
          type="number"
          placeholder="Seconds"
          value={condition.params.seconds as number || ''}
          onChange={(e) => updateParam('seconds', parseInt(e.target.value) || 0)}
        />
      )}

      {(condition.type === 'FLAG_IS_TRUE' || condition.type === 'FLAG_IS_FALSE') && (
        <input
          style={{ ...input, width: 120 }}
          placeholder="Flag ID"
          value={(condition.params.flag as string) || ''}
          onChange={(e) => updateParam('flag', e.target.value)}
        />
      )}

      {(condition.type === 'FLAG_EQUALS' || condition.type === 'FLAG_LESS_THAN' || condition.type === 'FLAG_MORE_THAN') && (
        <>
          <input
            style={{ ...input, width: 100 }}
            placeholder="Flag"
            value={(condition.params.flag as string) || ''}
            onChange={(e) => updateParam('flag', e.target.value)}
          />
          <input
            style={{ ...input, width: 80 }}
            type="number"
            placeholder="Value"
            value={condition.params.value as number ?? ''}
            onChange={(e) => updateParam('value', parseInt(e.target.value) || 0)}
          />
        </>
      )}

      {condition.type === 'FLAG_EQUALS_FLAG' && (
        <>
          <input
            style={{ ...input, width: 100 }}
            placeholder="Flag 1"
            value={(condition.params.flag as string) || ''}
            onChange={(e) => updateParam('flag', e.target.value)}
          />
          <span style={{ color: '#5a7a8a', fontSize: 13 }}>=</span>
          <input
            style={{ ...input, width: 100 }}
            placeholder="Flag 2"
            value={(condition.params.flag2 as string) || ''}
            onChange={(e) => updateParam('flag2', e.target.value)}
          />
        </>
      )}

      {condition.type === 'UNIT_IN_ZONE' && (
        <>
          <input
            style={{ ...input, width: 130 }}
            placeholder="Unit name"
            value={(condition.params.unit as string) || ''}
            onChange={(e) => updateParam('unit', e.target.value)}
          />
          <input
            style={{ ...input, width: 130 }}
            placeholder="Zone name"
            value={(condition.params.zone as string) || ''}
            onChange={(e) => updateParam('zone', e.target.value)}
          />
        </>
      )}

      {condition.type === 'UNIT_ALIVE' && (
        <input
          style={{ ...input, width: 180 }}
          placeholder="Unit name"
          value={(condition.params.unit as string) || ''}
          onChange={(e) => updateParam('unit', e.target.value)}
        />
      )}

      {(condition.type === 'GROUP_ALIVE' || condition.type === 'GROUP_DEAD') && (
        <input
          style={{ ...input, width: 180 }}
          placeholder="Group name"
          value={(condition.params.group as string) || ''}
          onChange={(e) => updateParam('group', e.target.value)}
        />
      )}

      {condition.type === 'COALITION_IN_ZONE' && (
        <>
          <select
            style={{ ...select, width: 100 }}
            value={(condition.params.coalition as string) || 'blue'}
            onChange={(e) => updateParam('coalition', e.target.value)}
          >
            <option value="blue">Blue</option>
            <option value="red">Red</option>
          </select>
          <input
            style={{ ...input, width: 130 }}
            placeholder="Zone name"
            value={(condition.params.zone as string) || ''}
            onChange={(e) => updateParam('zone', e.target.value)}
          />
        </>
      )}

      {condition.type === 'PART_OF_GROUP_IN_ZONE' && (
        <>
          <input
            style={{ ...input, width: 130 }}
            placeholder="Group name"
            value={(condition.params.group as string) || ''}
            onChange={(e) => updateParam('group', e.target.value)}
          />
          <input
            style={{ ...input, width: 130 }}
            placeholder="Zone name"
            value={(condition.params.zone as string) || ''}
            onChange={(e) => updateParam('zone', e.target.value)}
          />
        </>
      )}

      {condition.type === 'RANDOM_LESS_THAN' && (
        <input
          style={{ ...input, width: 80 }}
          type="number"
          placeholder="%"
          value={condition.params.percent as number ?? ''}
          onChange={(e) => updateParam('percent', parseInt(e.target.value) || 0)}
        />
      )}

      {condition.type === 'CUSTOM_LUA' && (
        <input
          style={{ ...input, flex: 1, minWidth: 200 }}
          placeholder="Lua expression"
          value={(condition.params.lua as string) || ''}
          onChange={(e) => updateParam('lua', e.target.value)}
        />
      )}

      <button style={{ ...btnDanger, padding: '4px 8px', fontSize: 12 }} onClick={onDelete}>✕</button>
    </div>
  );
}


// ── Action Row ────────���───────────────────────────���───────────────────────

function ActionRow({
  action, audioFiles, sessionId, onChange, onDelete,
}: {
  action: TriggerAction;
  audioFiles: AudioFile[];
  sessionId: string;
  onChange: (a: TriggerAction) => void;
  onDelete: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const updateParam = (key: string, value: unknown) => {
    onChange({ ...action, params: { ...action.params, [key]: value } });
  };

  const playPreview = (path: string) => {
    if (audioRef.current) audioRef.current.pause();
    const el = new Audio(audioStreamUrl(sessionId, path));
    audioRef.current = el;
    el.play().catch(() => {});
  };

  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0',
      borderBottom: '1px solid #152030', flexWrap: 'wrap',
    }}>
      <select
        style={{ ...select, width: 180 }}
        value={action.type}
        onChange={(e) => onChange({ type: e.target.value, params: getDefaultActParams(e.target.value) })}
      >
        {ACTION_TYPES.map((at) => (
          <option key={at.value} value={at.value}>{at.label}</option>
        ))}
      </select>

      {/* Flag actions */}
      {action.type === 'SET_FLAG' && (
        <>
          <input
            style={{ ...input, width: 100 }}
            placeholder="Flag"
            value={(action.params.flag as string) || ''}
            onChange={(e) => updateParam('flag', e.target.value)}
          />
          <select
            style={{ ...select, width: 80 }}
            value={String(action.params.value ?? 'true')}
            onChange={(e) => updateParam('value', e.target.value === 'true' ? true : e.target.value === 'false' ? false : parseInt(e.target.value))}
          >
            <option value="true">ON</option>
            <option value="false">OFF</option>
          </select>
        </>
      )}

      {action.type === 'CLEAR_FLAG' && (
        <input
          style={{ ...input, width: 100 }}
          placeholder="Flag"
          value={(action.params.flag as string) || ''}
          onChange={(e) => updateParam('flag', e.target.value)}
        />
      )}

      {(action.type === 'FLAG_INCREASE' || action.type === 'FLAG_DECREASE') && (
        <>
          <input
            style={{ ...input, width: 100 }}
            placeholder="Flag"
            value={(action.params.flag as string) || ''}
            onChange={(e) => updateParam('flag', e.target.value)}
          />
          <input
            style={{ ...input, width: 70 }}
            type="number"
            placeholder="By"
            value={action.params.value as number ?? 1}
            onChange={(e) => updateParam('value', parseInt(e.target.value) || 1)}
          />
        </>
      )}

      {/* Sound actions */}
      {(action.type === 'SOUND_TO_ALL' || action.type === 'SOUND_TO_COALITION' || action.type === 'SOUND_TO_GROUP' || action.type === 'SOUND_TO_COUNTRY') && (
        <>
          {(action.type === 'SOUND_TO_COALITION') && (
            <select
              style={{ ...select, width: 80 }}
              value={(action.params.coalition as string) || 'blue'}
              onChange={(e) => updateParam('coalition', e.target.value)}
            >
              <option value="blue">Blue</option>
              <option value="red">Red</option>
            </select>
          )}
          {action.type === 'SOUND_TO_GROUP' && (
            <input
              style={{ ...input, width: 130 }}
              placeholder="Group name"
              value={(action.params.group as string) || ''}
              onChange={(e) => updateParam('group', e.target.value)}
            />
          )}
          {action.type === 'SOUND_TO_COUNTRY' && (
            <input
              style={{ ...input, width: 130 }}
              placeholder="Country"
              value={(action.params.country as string) || ''}
              onChange={(e) => updateParam('country', e.target.value)}
            />
          )}
          <select
            style={{ ...select, width: 200 }}
            value={(action.params.file as string) || ''}
            onChange={(e) => updateParam('file', e.target.value)}
          >
            <option value="">-- Select audio --</option>
            {audioFiles.map((af) => (
              <option key={af.path} value={af.path}>{af.filename}</option>
            ))}
          </select>
          {action.params.file && (
            <button style={{ ...btn, padding: '4px 8px', fontSize: 12 }}
              onClick={() => playPreview(action.params.file as string)}>
              ▶
            </button>
          )}
        </>
      )}

      {/* Message actions */}
      {(action.type === 'MESSAGE_TO_ALL' || action.type === 'MESSAGE_TO_COALITION') && (
        <>
          {action.type === 'MESSAGE_TO_COALITION' && (
            <select
              style={{ ...select, width: 80 }}
              value={(action.params.coalition as string) || 'blue'}
              onChange={(e) => updateParam('coalition', e.target.value)}
            >
              <option value="blue">Blue</option>
              <option value="red">Red</option>
            </select>
          )}
          <input
            style={{ ...input, flex: 1, minWidth: 180 }}
            placeholder="Message text"
            value={(action.params.text as string) || ''}
            onChange={(e) => updateParam('text', e.target.value)}
          />
          <input
            style={{ ...input, width: 60 }}
            type="number"
            placeholder="Sec"
            title="Display duration (seconds)"
            value={action.params.duration as number ?? 10}
            onChange={(e) => updateParam('duration', parseInt(e.target.value) || 10)}
          />
        </>
      )}

      {/* Group actions */}
      {(action.type === 'GROUP_ACTIVATE' || action.type === 'GROUP_DEACTIVATE' || action.type === 'AI_ON' || action.type === 'AI_OFF') && (
        <input
          style={{ ...input, width: 200 }}
          placeholder="Group name"
          value={(action.params.group as string) || ''}
          onChange={(e) => updateParam('group', e.target.value)}
        />
      )}

      {/* Script actions */}
      {action.type === 'DO_SCRIPT' && (
        <input
          style={{ ...input, flex: 1, minWidth: 200 }}
          placeholder="Lua code"
          value={(action.params.lua as string) || ''}
          onChange={(e) => updateParam('lua', e.target.value)}
        />
      )}

      {action.type === 'DO_SCRIPT_FILE' && (
        <input
          style={{ ...input, width: 200 }}
          placeholder="Script filename"
          value={(action.params.file as string) || ''}
          onChange={(e) => updateParam('file', e.target.value)}
        />
      )}

      {action.type === 'CUSTOM_LUA' && (
        <input
          style={{ ...input, flex: 1, minWidth: 200 }}
          placeholder="Lua code"
          value={(action.params.lua as string) || ''}
          onChange={(e) => updateParam('lua', e.target.value)}
        />
      )}

      <button style={{ ...btnDanger, padding: '4px 8px', fontSize: 12 }} onClick={onDelete}>✕</button>
    </div>
  );
}


// ── Flag Panel ────────────���───────────────────────────────────────────────

function FlagPanel({ flags }: { flags: { flagId: string; setBy: string[]; readBy: string[] }[] }) {
  return (
    <div style={card}>
      <div style={label}>Flags ({flags.length})</div>
      {flags.length === 0 ? (
        <div style={{ color: '#3a5a6a', fontSize: 13 }}>No flags in use.</div>
      ) : (
        <div style={{ maxHeight: 250, overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1a2a3a' }}>
                <th style={{ textAlign: 'left', padding: 4, color: '#5a7a8a' }}>Flag</th>
                <th style={{ textAlign: 'left', padding: 4, color: '#5a7a8a' }}>Set By</th>
                <th style={{ textAlign: 'left', padding: 4, color: '#5a7a8a' }}>Read By</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.flagId} style={{ borderBottom: '1px solid #101a25' }}>
                  <td style={{ padding: 4, color: '#e0a040', fontWeight: 600 }}>{f.flagId}</td>
                  <td style={{ padding: 4, color: '#60c080', fontSize: 12 }}>{f.setBy.join(', ') || '—'}</td>
                  <td style={{ padding: 4, color: '#6ab4f0', fontSize: 12 }}>{f.readBy.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ── Audio Manager ─────────���───────────────────────────────────────────────

function AudioManager({
  sessionId, audioFiles, onAdd, onRemove,
}: {
  sessionId: string;
  audioFiles: AudioFile[];
  onAdd: (f: AudioFile) => void;
  onRemove: (path: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sessionId) return;
    setUploading(true);
    setAudioError(null);
    try {
      const result = await uploadAudio(sessionId, file);
      onAdd({ filename: result.filename, path: result.path, sizeBytes: result.sizeBytes });
    } catch (err: any) {
      console.error('Audio upload failed:', err);
      setAudioError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async (path: string) => {
    setAudioError(null);
    try {
      await deleteAudio(sessionId, path);
      onRemove(path);
    } catch (err: any) {
      console.error('Audio delete failed:', err);
      setAudioError(err.message || 'Delete failed');
    }
  };

  const handlePlay = (path: string) => {
    if (audioRef.current) audioRef.current.pause();
    const el = new Audio(audioStreamUrl(sessionId, path));
    audioRef.current = el;
    el.play().catch(() => {});
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={label}>Audio Files ({audioFiles.length})</div>
        <button style={btn} onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? '...' : '+ Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".wav,.ogg,.mp3"
          style={{ display: 'none' }}
          onChange={handleUpload}
        />
      </div>

      {audioError && <div style={{ color: '#e06060', fontSize: 12, marginBottom: 6 }}>{audioError}</div>}

      {audioFiles.length === 0 ? (
        <div style={{ color: '#3a5a6a', fontSize: 13 }}>No audio files in .miz</div>
      ) : (
        <div style={{ maxHeight: 300, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {audioFiles.map((af) => (
            <div key={af.path} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
              background: '#0a1420', borderRadius: 4, fontSize: 13,
            }}>
              <button
                style={{ ...btn, padding: '2px 6px', fontSize: 11 }}
                onClick={() => handlePlay(af.path)}
                title="Preview"
              >▶</button>
              <div style={{ flex: 1, color: '#ccdae8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {af.filename}
              </div>
              <span style={{ color: '#5a7a8a', fontSize: 11 }}>{formatSize(af.sizeBytes)}</span>
              <button
                style={{ ...btnDanger, padding: '2px 6px', fontSize: 11 }}
                onClick={() => handleDelete(af.path)}
                title="Remove"
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Default params helpers ────────────────���───────────────────────────────

// ── Scripts Library ──────────────────────────────────────────────────────

interface ScriptEntry {
  id: string;
  name: string;
  category: 'framework' | 'carrier' | 'ground' | 'air' | 'utility';
  description: string;
  lua: string;
  url?: string;
}

const SCRIPT_LIBRARY: ScriptEntry[] = [
  {
    id: 'moose',
    name: 'MOOSE Framework',
    category: 'framework',
    description: 'MOOSE scripting framework (116K lines). Add as DO_SCRIPT_FILE or paste full Moose_.lua content. Load order: trigger 1.',
    url: 'https://flightcontrol-master.github.io/MOOSE_DOCS/',
    lua: `-- MOOSE Framework — too large to embed (116K lines)
-- Use DO_SCRIPT_FILE pointing to: Moose_03db4e8.lua
-- Or paste the full Moose_.lua content here after adding this trigger.
--
-- Load order: This must run BEFORE any MOOSE-dependent scripts.
-- Recommended: TIME MORE > 1 second

env.info("[MOOSE] Placeholder — replace with full Moose_.lua content or use DO_SCRIPT_FILE")`,
  },
  {
    id: 'aegis-iads',
    name: 'AEGIS IADS',
    category: 'framework',
    description: 'AEGIS v0.8.4-beta — Event-driven IADS for DCS. EW activation, WEZ gating, HARM reaction, EMCON cycling, ECM jamming. Load BEFORE setup script.',
    lua: `-- AEGIS IADS v0.8.4-beta — too large to embed (5K lines)
-- Use DO_SCRIPT_FILE pointing to: aegis-iads-v0.8.4-beta.lua
-- Or paste the full aegis-iads lua content here after adding this trigger.
--
-- Load order: TIME MORE > 1 (after MOOSE if used), BEFORE aegis-setup.
-- Group naming: SAM-TYPE-SECTOR, EW-SECTOR, PD-TYPE-SECTOR, PWR-SECTOR, ECM-TYPE-SECTOR

env.info("[AEGIS] Placeholder — replace with full aegis-iads-v0.8.4-beta.lua content or use DO_SCRIPT_FILE")`,
  },
  {
    id: 'aegis-setup',
    name: 'AEGIS Setup Example',
    category: 'framework',
    description: 'AEGIS IADS configuration — EW polling, EMCON timing, HARM reactions, alert frustration, ECM jammer settings. Load AFTER aegis-iads.lua.',
    lua: `-- AEGIS IADS Setup Example
-- Load order: TIME MORE > 2 (after aegis-iads.lua)
-- NO MOOSE REQUIRED.
--
-- ME Group naming (zone override via name suffix):
--   EW-NORTH                    1L13 or 55G6 EWR
--   EW-NORTH-DET120             EWR with 120 NM detection cap
--   SAM-SA10-NORTH-1            S-300 using default WEZ (40 NM)
--   SAM-SA10-NORTH-2-NEZ        S-300 using NEZ (20 NM) — ambush
--   SAM-SA6-SOUTH-1-NEZ25       SA-6 using NEZ at 25 NM
--   SAM-SA6-SOUTH-2-WEZ10       SA-6 with reduced WEZ (10 NM)
--   PD-SA15-NORTH-1             SA-15, place within 5 NM of parent SAM
--   PWR-SOUTH-1                 External power (only for fixed sites)
--   ECM-GROWLER-BENGAL-1        ECM aircraft (opposing coalition, requires ecmEnabled)

local iads = AEGIS:New("red", {
  ewPollInterval     = 10,
  alertTimeout       = 60,
  pdAssociateRange   = 5,
  defaultZone        = "WEZ",
  emconOnMin         = 30,
  emconOnMax         = 120,
  emconOffMin        = 15,
  emconOffMax        = 45,
  emconDetectDelay   = 5,
  emconReengageMin     = 10,
  emconReengageMax     = 30,
  emconStartupJitter   = 60,
  emconDoubleSweepPct  = 15,
  emconEarlyTermPct    = 20,
  emconThreatScale     = 0.5,
  emconRelaxedScale    = 1.5,
  emconSpookDuration   = 120,
  emconSpookEnabled    = false,
  harmReactionDelayMin = 8,
  harmReactionDelayMax = 12,
  harmCooldownMin      = 45,
  harmCooldownMax      = 90,
  harmStayHotDuration  = 30,
  harmLastDitchMin     = 8,
  harmLastDitchMax     = 12,
  harmPanicPct         = 15,
  harmMultiThreshold   = 2,
  harmMultiWindow      = 15,
  harmBraveryPct       = 5,
  alertFrustrationMin  = 30,
  alertFrustrationMax  = 60,
  alertFrustrationStayPct = 10,
  pbHarmCheckDelay     = 2,
  pbHarmWarnRadius     = 5,
  pbHarmCooldownMargin = 30,
  ecmEnabled           = true,
  debug              = true,
})

-- Optional: override a site to use NEZ (ambush setup)
-- iads:SetEngagementZone("SAM-SA6-SOUTH-1", "NEZ")

-- Optional: manually assign a SAM to a different sector
-- iads:AssignToSector("SAM-SA10-SPECIAL-1", "NORTH")

-- Optional: manually parent a PD to a specific SAM
-- iads:AddPointDefense("PD-SA15-NORTH-1", "SAM-SA10-NORTH-1")

iads:Activate()
iads:AddF10Menu()
iads:StartMapDebug(15)`,
  },
  {
    id: 'tic',
    name: 'TIC (Troops in Contact)',
    category: 'ground',
    description: 'TIC v1.1 — Dynamic ground combat script. Transforms ground battles into believable engagements with realistic fire exchanges.',
    lua: `-- TIC (Troops in Contact) v1.1 — too large to embed (5K lines)
-- Use DO_SCRIPT_FILE pointing to: TIC_v1.1.lua
-- Or paste the full TIC lua content here after adding this trigger.
--
-- Designed to make ground fights look and feel like real combat,
-- where both sides exchange fire and there is action for players.
-- See included PDF for full configuration guide.

env.info("[TIC] Placeholder — replace with full TIC_v1.1.lua content or use DO_SCRIPT_FILE")`,
  },
  {
    id: 'carrier-control',
    name: 'Carrier Control',
    category: 'carrier',
    description: 'F10 menu for carrier ops: Turn Into Wind, lights, TACAN/ICLS, recovery case presets, deck status, heading/speed control.',
    lua: [
      '-- CARRIER CONTROL — F10 Radio Menu',
      '-- Edit CFG below to match your carrier unit name, TACAN, ICLS, etc.',
      '',
      'local CFG = {',
      '  CARRIER_NAME     = "CVN-72",',
      '  COALITION        = 2,',
      '  TACAN_CHANNEL    = 72,',
      '  TACAN_BAND       = "X",',
      '  TACAN_CALLSIGN   = "LHD",',
      '  ICLS_CHANNEL     = 2,',
      '  TIW_SPEED_KTS    = 27,',
      '  TIW_DURATION_MIN = 30,',
      '  TIW_AUTO_RESUME  = true,',
      '  CRUISE_SPEED_KTS = 15,',
      '  DEFAULT_CASE     = 1,',
      '  MSG_DURATION     = 15,',
      '  DEBUG            = false,',
      '}',
      '',
      'local STATE={tiw_active=false,tiw_scheduler=nil,lights_launch=false,lights_recovery=false,lights_deck=false,tacan_on=false,icls_on=false,current_case=CFG.DEFAULT_CASE}',
      'local function log(m) if CFG.DEBUG then env.info("[CARRIER] "..tostring(m)) end end',
      'local function msg(t,d) trigger.action.outTextForCoalition(CFG.COALITION,t,d or CFG.MSG_DURATION) end',
      'local function getCarrier() local u=Unit.getByName(CFG.CARRIER_NAME); if not u then local g=Group.getByName(CFG.CARRIER_NAME); if g then u=g:getUnit(1) end end; return u end',
      'local function getGroup() local u=getCarrier(); return u and u:getGroup() end',
      'local function kts2m(k) return k*0.514444 end',
      'local function m2kts(m) return m/0.514444 end',
      'local function r2d(r) return r*180/math.pi end',
      'local function d2r(d) return d*math.pi/180 end',
      'local function normH(h) h=h%360; if h<0 then h=h+360 end; return h end',
      '',
      'local function getWind() local u=getCarrier(); if not u then return {dir_from=0,speed_mps=0} end; local p=u:getPoint(); local w=atmosphere.getWind({x=p.x,y=0,z=p.z}); local s=math.sqrt(w.x*w.x+w.z*w.z); local to=normH(90-r2d(math.atan2(w.z,w.x))); return {dir_from=normH(to+180),speed_mps=s} end',
      'local function calcBRC() local w=getWind(); return normH(w.dir_from-9),w end',
      '',
      'local function setHdgSpd(hdg,kts) local g=getGroup(); if not g then return end; local u=getCarrier(); local p=u:getPoint(); local d=370400; local n=d*math.cos(d2r(hdg)); local e=d*math.sin(d2r(hdg)); g:getController():setTask({id="Mission",params={route={points={[1]={x=p.x,y=p.z,alt=0,speed=kts2m(kts),action="Turning Point",type="Turning Point"},[2]={x=p.x+n,y=p.z+e,alt=0,speed=kts2m(kts),action="Turning Point",type="Turning Point"}}}}}) end',
      '',
      'local function turnIntoWind() local brc,w=calcBRC(); setHdgSpd(brc,CFG.TIW_SPEED_KTS); STATE.tiw_active=true; local wk=math.floor(m2kts(w.speed_mps)+0.5); msg(string.format("CARRIER — TURN INTO WIND\\nBRC: %03d° Ship: %d kts\\nWind: %03d°/%d kts WOD: ~%d kts\\nCase %s",brc,CFG.TIW_SPEED_KTS,math.floor(w.dir_from+0.5),wk,wk+CFG.TIW_SPEED_KTS,tostring(STATE.current_case))); if CFG.TIW_AUTO_RESUME and CFG.TIW_DURATION_MIN>0 then if STATE.tiw_scheduler then timer.removeFunction(STATE.tiw_scheduler) end; STATE.tiw_scheduler=timer.scheduleFunction(function() if STATE.tiw_active then STATE.tiw_active=false; msg("CARRIER — TIW expired."); setHdgSpd(normH(brc+180),CFG.CRUISE_SPEED_KTS) end; STATE.tiw_scheduler=nil end,nil,timer.getTime()+CFG.TIW_DURATION_MIN*60) end end',
      'local function cancelTIW() STATE.tiw_active=false; if STATE.tiw_scheduler then timer.removeFunction(STATE.tiw_scheduler); STATE.tiw_scheduler=nil end; setHdgSpd(0,CFG.CRUISE_SPEED_KTS); msg("CARRIER — TIW cancelled.") end',
      '',
      'local function setLight(name,on) STATE["lights_"..name]=on; trigger.action.setUserFlag("CARRIER_"..name:upper().."_LIGHTS",on and 1 or 0); msg(name:sub(1,1):upper()..name:sub(2).." Lights: "..(on and "ON" or "OFF")) end',
      'local function allLightsOff() setLight("launch",false); setLight("recovery",false); setLight("deck",false) end',
      '',
      'local function activateTACAN() local u=getCarrier(); if not u then return end; u:getController():setCommand({id="ActivateBeacon",params={type=4,system=3,channel=CFG.TACAN_CHANNEL,modeChannel=CFG.TACAN_BAND,callsign=CFG.TACAN_CALLSIGN,bearing=true,frequency=0}}); STATE.tacan_on=true; msg(string.format("TACAN ON — %d%s (%s)",CFG.TACAN_CHANNEL,CFG.TACAN_BAND,CFG.TACAN_CALLSIGN)) end',
      'local function deactivateTACAN() local u=getCarrier(); if not u then return end; u:getController():setCommand({id="DeactivateBeacon",params={}}); STATE.tacan_on=false; msg("TACAN OFF") end',
      'local function activateICLS() local u=getCarrier(); if not u then return end; u:getController():setCommand({id="ActivateICLS",params={type=131584,channel=CFG.ICLS_CHANNEL}}); STATE.icls_on=true; msg(string.format("ICLS ON — Ch %d",CFG.ICLS_CHANNEL)) end',
      'local function deactivateICLS() local u=getCarrier(); if not u then return end; u:getController():setCommand({id="DeactivateICLS",params={}}); STATE.icls_on=false; msg("ICLS OFF") end',
      '',
      'local function setCase(c) STATE.current_case=c; if c==1 then allLightsOff(); msg("CASE I RECOVERY — Day VFR") elseif c==2 then setLight("recovery",true); setLight("deck",true); msg("CASE II RECOVERY") else setLight("recovery",true); setLight("deck",true); msg("CASE III RECOVERY") end end',
      '',
      'local function deckReport() local u=getCarrier(); if not u then msg("Carrier not found!"); return end; local w=getWind(); local brc=calcBRC(); local v=u:getVelocity(); local ss=math.floor(m2kts(math.sqrt(v.x*v.x+v.z*v.z))+0.5); local sh=normH(r2d(math.atan2(v.z,v.x))); if ss<1 then sh=0 end; local wk=math.floor(m2kts(w.speed_mps)+0.5); msg(string.format("DECK STATUS\\nHDG: %03d° Spd: %d kts\\nWind: %03d°/%d kts\\nBRC: %03d° WOD: ~%d kts\\nCase %s TACAN:%s ICLS:%s\\nTIW: %s",math.floor(sh+0.5),ss,math.floor(w.dir_from+0.5),wk,math.floor(brc+0.5),wk+ss,tostring(STATE.current_case),STATE.tacan_on and "ON" or "OFF",STATE.icls_on and "ON" or "OFF",STATE.tiw_active and "YES" or "NO"),25) end',
      '',
      'local function buildMenu()',
      '  local r=missionCommands.addSubMenuForCoalition(CFG.COALITION,"Carrier Ops")',
      '  local tw=missionCommands.addSubMenuForCoalition(CFG.COALITION,"Turn Into Wind",r)',
      '  missionCommands.addCommandForCoalition(CFG.COALITION,"Activate TIW",tw,turnIntoWind)',
      '  missionCommands.addCommandForCoalition(CFG.COALITION,"Cancel TIW",tw,cancelTIW)',
      '  local hm=missionCommands.addSubMenuForCoalition(CFG.COALITION,"Set Heading",r)',
      '  for _,h in ipairs({0,30,60,90,120,150,180,210,240,270,300,330}) do',
      '    missionCommands.addCommandForCoalition(CFG.COALITION,string.format("%03d",h).."°",hm,function() setHdgSpd(h,STATE.tiw_active and CFG.TIW_SPEED_KTS or CFG.CRUISE_SPEED_KTS); STATE.tiw_active=false; msg(string.format("Heading %03d°",h)) end)',
      '  end',
      '  local sm=missionCommands.addSubMenuForCoalition(CFG.COALITION,"Set Speed",r)',
      '  for _,s in ipairs({5,10,15,20,25,27,30}) do',
      '    missionCommands.addCommandForCoalition(CFG.COALITION,string.format("%d kts",s),sm,function() local u=getCarrier(); if not u then return end; local v=u:getVelocity(); local h=normH(r2d(math.atan2(v.z,v.x))); if math.sqrt(v.x*v.x+v.z*v.z)<1 then h=0 end; setHdgSpd(h,s); msg(string.format("Speed: %d kts",s)) end)',
      '  end',
      '  local lm=missionCommands.addSubMenuForCoalition(CFG.COALITION,"Lights",r)',
      '  missionCommands.addCommandForCoalition(CFG.COALITION,"Launch — Toggle",lm,function() setLight("launch",not STATE.lights_launch) end)',
      '  missionCommands.addCommandForCoalition(CFG.COALITION,"Recovery — Toggle",lm,function() setLight("recovery",not STATE.lights_recovery) end)',
      '  missionCommands.addCommandForCoalition(CFG.COALITION,"Deck — Toggle",lm,function() setLight("deck",not STATE.lights_deck) end)',
      '  missionCommands.addCommandForCoalition(CFG.COALITION,"All Lights OFF",lm,allLightsOff)',
      '  local bm=missionCommands.addSubMenuForCoalition(CFG.COALITION,"Beacons",r)',
      '  missionCommands.addCommandForCoalition(CFG.COALITION,"TACAN — Toggle",bm,function() if STATE.tacan_on then deactivateTACAN() else activateTACAN() end end)',
      '  missionCommands.addCommandForCoalition(CFG.COALITION,"ICLS — Toggle",bm,function() if STATE.icls_on then deactivateICLS() else activateICLS() end end)',
      '  local cm=missionCommands.addSubMenuForCoalition(CFG.COALITION,"Recovery Case",r)',
      '  missionCommands.addCommandForCoalition(CFG.COALITION,"CASE I (Day VFR)",cm,function() setCase(1) end)',
      '  missionCommands.addCommandForCoalition(CFG.COALITION,"CASE II (Instr+Vis)",cm,function() setCase(2) end)',
      '  missionCommands.addCommandForCoalition(CFG.COALITION,"CASE III (Night/IMC)",cm,function() setCase(3) end)',
      '  missionCommands.addCommandForCoalition(CFG.COALITION,"Deck Status Report",r,deckReport)',
      '  missionCommands.addCommandForCoalition(CFG.COALITION,"EMERGENCY BREAKAWAY",r,function() allLightsOff(); cancelTIW(); msg("EMERGENCY BREAKAWAY") end)',
      'end',
      '',
      'local function init() local u=getCarrier(); if not u then env.info("[CARRIER] Not found, retry 5s..."); timer.scheduleFunction(function() init() end,nil,timer.getTime()+5); return end; buildMenu(); activateTACAN(); activateICLS(); setCase(CFG.DEFAULT_CASE); msg(string.format("CARRIER OPS ONLINE — %s\\nTACAN %d%s (%s) | ICLS Ch %d\\nF10 > Carrier Ops",CFG.CARRIER_NAME,CFG.TACAN_CHANNEL,CFG.TACAN_BAND,CFG.TACAN_CALLSIGN,CFG.ICLS_CHANNEL),20) end',
      'timer.scheduleFunction(function() init() end,nil,timer.getTime()+3)',
    ].join('\n'),
  },
];

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  framework: { label: 'Framework', color: '#b07ed8' },
  carrier:   { label: 'Carrier',   color: '#4a8fd4' },
  ground:    { label: 'Ground',    color: '#60c080' },
};

function ScriptsLibrary({ onAddScript }: { onAddScript: (name: string, lua: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  const filtered = filter
    ? SCRIPT_LIBRARY.filter((s) => s.category === filter)
    : SCRIPT_LIBRARY;

  return (
    <div style={card}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={label}>Scripts Library ({SCRIPT_LIBRARY.length})</div>
        <span style={{ color: '#5a7a8a', fontSize: 12 }}>{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <>
          {/* Category filter pills */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8, marginTop: 4 }}>
            <button
              onClick={() => setFilter(null)}
              style={{
                ...btn, padding: '3px 8px', fontSize: 11,
                background: !filter ? '#1a3a5a' : '#0f1a28',
                borderColor: !filter ? '#4a8fd4' : '#1a2a3a',
                color: !filter ? '#ccdae8' : '#5a7a8a',
              }}
            >All</button>
            {Object.entries(CATEGORY_META).map(([id, meta]) => (
              <button
                key={id}
                onClick={() => setFilter(filter === id ? null : id)}
                style={{
                  ...btn, padding: '3px 8px', fontSize: 11,
                  background: filter === id ? 'rgba(255,255,255,0.06)' : '#0f1a28',
                  borderColor: filter === id ? meta.color : '#1a2a3a',
                  color: filter === id ? meta.color : '#5a7a8a',
                }}
              >{meta.label}</button>
            ))}
          </div>

          {/* Script entries */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflow: 'auto' }}>
            {filtered.map((script) => {
              const cat = CATEGORY_META[script.category];
              const isPreview = previewId === script.id;
              return (
                <div key={script.id} style={{
                  background: '#0a1420', borderRadius: 6, padding: '8px 10px',
                  border: '1px solid #152030',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 3,
                      background: 'rgba(255,255,255,0.04)',
                      color: cat.color, border: `1px solid ${cat.color}33`,
                      fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
                    }}>{cat.label}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#ccdae8' }}>{script.name}</span>
                    {script.url && (
                      <a
                        href={script.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 11, color: '#4a8fd4', textDecoration: 'none' }}
                        onClick={(e) => e.stopPropagation()}
                      >docs</a>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#5a7a8a', marginTop: 4, lineHeight: 1.4 }}>
                    {script.description}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button
                      style={{ ...btnPrimary, padding: '4px 10px', fontSize: 12 }}
                      onClick={() => onAddScript(script.name, script.lua)}
                    >+ Add to Triggers</button>
                    <button
                      style={{ ...btn, padding: '4px 10px', fontSize: 12 }}
                      onClick={() => setPreviewId(isPreview ? null : script.id)}
                    >{isPreview ? 'Hide Code' : 'Preview'}</button>
                  </div>
                  {isPreview && (
                    <pre style={{
                      marginTop: 6, padding: 8, background: '#060d16', borderRadius: 4,
                      fontSize: 11, color: '#8aaabe', overflow: 'auto', maxHeight: 200,
                      border: '1px solid #152030', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>{script.lua}</pre>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}


// ── Default params helpers ───────────────────────────────────────────────

function getDefaultCondParams(type: string): Record<string, unknown> {
  switch (type) {
    case 'TIME_MORE_THAN':
    case 'TIME_LESS_THAN':
      return { seconds: 300 };
    case 'FLAG_IS_TRUE':
    case 'FLAG_IS_FALSE':
      return { flag: '1' };
    case 'FLAG_EQUALS':
    case 'FLAG_LESS_THAN':
    case 'FLAG_MORE_THAN':
      return { flag: '1', value: 0 };
    case 'FLAG_EQUALS_FLAG':
      return { flag: '1', flag2: '2' };
    case 'UNIT_IN_ZONE':
      return { unit: '', zone: '' };
    case 'UNIT_ALIVE':
      return { unit: '' };
    case 'GROUP_ALIVE':
    case 'GROUP_DEAD':
      return { group: '' };
    case 'COALITION_IN_ZONE':
      return { coalition: 'blue', zone: '' };
    case 'PART_OF_GROUP_IN_ZONE':
      return { group: '', zone: '' };
    case 'RANDOM_LESS_THAN':
      return { percent: 50 };
    case 'CUSTOM_LUA':
      return { lua: '' };
    default:
      return {};
  }
}

function getDefaultActParams(type: string): Record<string, unknown> {
  switch (type) {
    case 'SET_FLAG':
      return { flag: '1', value: true };
    case 'CLEAR_FLAG':
      return { flag: '1' };
    case 'FLAG_INCREASE':
    case 'FLAG_DECREASE':
      return { flag: '1', value: 1 };
    case 'SOUND_TO_ALL':
      return { file: '' };
    case 'SOUND_TO_COALITION':
      return { coalition: 'blue', file: '' };
    case 'SOUND_TO_GROUP':
      return { group: '', file: '' };
    case 'SOUND_TO_COUNTRY':
      return { country: '', file: '' };
    case 'MESSAGE_TO_ALL':
      return { text: '', duration: 10 };
    case 'MESSAGE_TO_COALITION':
      return { coalition: 'blue', text: '', duration: 10 };
    case 'GROUP_ACTIVATE':
    case 'GROUP_DEACTIVATE':
    case 'AI_ON':
    case 'AI_OFF':
      return { group: '' };
    case 'DO_SCRIPT':
      return { lua: '' };
    case 'DO_SCRIPT_FILE':
      return { file: '' };
    case 'CUSTOM_LUA':
      return { lua: '' };
    default:
      return {};
  }
}
