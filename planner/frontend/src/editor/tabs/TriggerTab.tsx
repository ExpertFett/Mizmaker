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
    loadTriggers, addRule, updateRule, deleteRule, duplicateRule,
    selectRule, addAudioFile, removeAudioFile, markClean,
  } = useTriggerStore();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

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
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 120px)', minHeight: 500 }}>
      {/* ── Left: Rule List ──────────────────────────── */}
      <div style={{ width: 260, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={label}>Triggers ({rules.length})</div>
          <button style={btnPrimary} onClick={addRule}>+ Add</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rules.map((rule) => (
            <div
              key={rule.id}
              onClick={() => selectRule(rule.id)}
              style={{
                ...card,
                marginBottom: 4,
                cursor: 'pointer',
                borderColor: rule.id === selectedRuleId ? '#4a8fd4' : '#1a2a3a',
                opacity: rule.enabled ? 1 : 0.5,
              }}
            >
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
          ))}
          {rules.length === 0 && (
            <div style={{ color: '#3a5a6a', fontSize: 13, padding: 12, textAlign: 'center' }}>
              No triggers found. Click + Add to create one.
            </div>
          )}
        </div>

        {/* Save button */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            style={{ ...btnSuccess, opacity: isDirty ? 1 : 0.4, flex: 1 }}
            onClick={handleSave}
            disabled={!isDirty || saving}
          >
            {saving ? 'Saving...' : isDirty ? 'Save Triggers' : 'Saved'}
          </button>
        </div>
        {error && <div style={{ color: '#e06060', fontSize: 12, padding: 4 }}>{error}</div>}
        {statusMsg && <div style={{ color: '#60c080', fontSize: 12, padding: 4 }}>{statusMsg}</div>}
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
    id: 'carrier-control',
    name: 'Carrier Control',
    category: 'carrier',
    description: 'F10 menu for carrier ops: TIW, lights, TACAN/ICLS, recovery case presets, deck status, heading/speed control.',
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
  {
    id: 'moose-loader',
    name: 'MOOSE Framework',
    category: 'framework',
    description: 'Load the MOOSE scripting framework. Requires Moose_.lua in your Saved Games/DCS/Scripts/ folder.',
    url: 'https://flightcontrol-master.github.io/MOOSE_DOCS/',
    lua: `-- MOOSE Framework Loader
-- Place Moose_.lua in: Saved Games/DCS/Scripts/

local moosePaths = {
  lfs.writedir() .. "Scripts/Moose_.lua",
  lfs.writedir() .. "Scripts/Moose.lua",
  lfs.writedir() .. "Mods/Services/Moose/Moose_.lua",
}
local loaded = false
for _, path in ipairs(moosePaths) do
  local f = io.open(path, "r")
  if f then f:close(); dofile(path); env.info("[MOOSE] Loaded: " .. path); trigger.action.outText("MOOSE loaded.", 10); loaded = true; break end
end
if not loaded then env.warning("[MOOSE] Not found!"); trigger.action.outText("WARNING: MOOSE not found!", 15) end`,
  },
  {
    id: 'skynet-iads',
    name: 'Skynet IADS',
    category: 'framework',
    description: 'Integrated Air Defense System. Realistic SAM behavior — EWR networking, emissions control, point defense.',
    url: 'https://github.com/walder/Skynet-IADS',
    lua: `-- Skynet IADS Loader
-- Requires skynet-iads-compiled.lua in Saved Games/DCS/Scripts/

local path = lfs.writedir() .. "Scripts/skynet-iads-compiled.lua"
local f = io.open(path, "r")
if f then f:close(); dofile(path); env.info("[SKYNET] Loaded") else env.warning("[SKYNET] Not found!"); trigger.action.outText("WARNING: Skynet IADS not found!", 15); return end

-- Configure your IADS below:
--[[
local redIADS = SkynetIADS:create("RED-IADS")
redIADS:addEarlyWarningRadarsByPrefix("EWR")
redIADS:addSAMSitesByPrefix("SAM")
redIADS:activate()
trigger.action.outText("Skynet IADS active.", 10)
]]`,
  },
  {
    id: 'mist',
    name: 'MiST',
    category: 'utility',
    description: 'Mission Scripting Tools — core utility library. Load BEFORE other scripts that depend on it (CTLD, CSAR, etc.).',
    url: 'https://github.com/mrSkortch/MissionScriptingTools',
    lua: `-- MiST Loader (Mission Scripting Tools)
-- Load this BEFORE scripts that depend on it.

local mistPaths = {
  lfs.writedir() .. "Scripts/mist.lua",
  lfs.writedir() .. "Scripts/mist_4_5_126.lua",
}
local loaded = false
for _, path in ipairs(mistPaths) do
  local f = io.open(path, "r")
  if f then f:close(); dofile(path); env.info("[MiST] Loaded: " .. path); trigger.action.outText("MiST loaded.", 10); loaded = true; break end
end
if not loaded then env.warning("[MiST] Not found!"); trigger.action.outText("WARNING: MiST not found!", 15) end`,
  },
  {
    id: 'ctld',
    name: 'CTLD',
    category: 'ground',
    description: 'Combat Troop & Logistics Deployment. Helo sling-load, troop transport, FOB building.',
    url: 'https://github.com/ciribob/DCS-CTLD',
    lua: `-- CTLD Loader (Combat Troop & Logistics Deployment)
-- Requires ctld.lua in Saved Games/DCS/Scripts/

local path = lfs.writedir() .. "Scripts/ctld.lua"
local f = io.open(path, "r")
if f then f:close(); dofile(path); env.info("[CTLD] Loaded"); trigger.action.outText("CTLD loaded — F10 for logistics.", 10)
else env.warning("[CTLD] Not found!"); trigger.action.outText("WARNING: CTLD not found!", 15) end`,
  },
  {
    id: 'csar',
    name: 'CSAR',
    category: 'ground',
    description: 'Combat Search and Rescue. Downed pilots spawn smoke/beacons for helicopter pickup.',
    url: 'https://github.com/ciribob/DCS-CSAR',
    lua: `-- CSAR Loader (Combat Search and Rescue)
-- Requires csar.lua in Saved Games/DCS/Scripts/

local path = lfs.writedir() .. "Scripts/csar.lua"
local f = io.open(path, "r")
if f then f:close(); dofile(path); env.info("[CSAR] Loaded"); trigger.action.outText("CSAR loaded — downed pilots will beacon.", 10)
else env.warning("[CSAR] Not found!"); trigger.action.outText("WARNING: CSAR not found!", 15) end`,
  },
  {
    id: 'jtac-autolase',
    name: 'JTAC Autolase',
    category: 'air',
    description: 'Automatic JTAC laser designation with 9-line briefs via F10 menu.',
    url: 'https://github.com/ciribob/DCS-JTACAutoLase',
    lua: `-- JTAC Autolase Loader
-- Requires JTACAutoLase.lua in Saved Games/DCS/Scripts/

local path = lfs.writedir() .. "Scripts/JTACAutoLase.lua"
local f = io.open(path, "r")
if f then f:close(); dofile(path); env.info("[JTAC] Loaded")
else env.warning("[JTAC] Not found!"); trigger.action.outText("WARNING: JTACAutoLase not found!", 15); return end

-- Configure JTACs: JTACAutoLase(groupName, laserCode, smoke, lock, color)
--[[
JTACAutoLase("JTAC-1", 1688, true, "all", "red")
JTACAutoLase("JTAC-2", 1687, true, "vehicles", "green")
trigger.action.outText("JTAC Autolase active.", 10)
]]`,
  },
  {
    id: 'splashdamage',
    name: 'Splash Damage',
    category: 'air',
    description: 'Realistic blast/fragmentation. Bombs and missiles damage nearby units based on distance.',
    url: 'https://github.com/spencershepard/DCS-Scripts',
    lua: `-- Splash Damage Loader
-- Requires splash_damage.lua in Saved Games/DCS/Scripts/

local path = lfs.writedir() .. "Scripts/splash_damage.lua"
local f = io.open(path, "r")
if f then f:close(); dofile(path); env.info("[SPLASH] Loaded"); trigger.action.outText("Splash Damage active.", 10)
else env.warning("[SPLASH] Not found!"); trigger.action.outText("WARNING: Splash Damage not found!", 15) end`,
  },
  {
    id: 'custom-script',
    name: 'Custom Script',
    category: 'utility',
    description: 'Empty template — paste your own Lua code.',
    lua: `-- Custom Script — runs at MISSION START
-- Add your Lua code below.

env.info("[CUSTOM] Script loaded")
trigger.action.outText("Custom script loaded.", 10)`,
  },
];

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  carrier:   { label: 'Carrier',   color: '#4a8fd4' },
  framework: { label: 'Framework', color: '#b07ed8' },
  ground:    { label: 'Ground',    color: '#60c080' },
  air:       { label: 'Air',       color: '#e0a040' },
  utility:   { label: 'Utility',   color: '#8aaabe' },
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
