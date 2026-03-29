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
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#5a7a9a', marginBottom: 6,
};
const input: React.CSSProperties = {
  background: '#0a1420', border: '1px solid #1a2a3a', borderRadius: 4, color: '#ccdae8',
  padding: '5px 8px', fontSize: 13, width: '100%', boxSizing: 'border-box',
};
const select: React.CSSProperties = { ...input, cursor: 'pointer' };
const btn: React.CSSProperties = {
  background: '#1a2a3a', border: '1px solid #2a3a4a', borderRadius: 4, color: '#8aaabe',
  padding: '5px 12px', fontSize: 12, cursor: 'pointer',
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
                <div style={{ fontSize: 13, fontWeight: 600, color: '#ccdae8' }}>{rule.name}</div>
                <span style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 3,
                  background: rule.eventType === 'once' ? '#1a2a3a' : rule.eventType === 'continuous' ? '#1a3a2a' : '#3a2a1a',
                  color: rule.eventType === 'once' ? '#6a8aaa' : rule.eventType === 'continuous' ? '#60c080' : '#e0a040',
                }}>
                  {rule.eventType}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#5a7a8a', marginTop: 4 }}>
                {rule.conditions.length} condition{rule.conditions.length !== 1 ? 's' : ''} → {rule.actions.length} action{rule.actions.length !== 1 ? 's' : ''}
              </div>
            </div>
          ))}
          {rules.length === 0 && (
            <div style={{ color: '#3a5a6a', fontSize: 12, padding: 12, textAlign: 'center' }}>
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
        {error && <div style={{ color: '#e06060', fontSize: 11, padding: 4 }}>{error}</div>}
        {statusMsg && <div style={{ color: '#60c080', fontSize: 11, padding: 4 }}>{statusMsg}</div>}
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
          <div style={{ color: '#3a5a6a', fontSize: 14, padding: 40, textAlign: 'center' }}>
            Select a trigger to edit, or click + Add to create one.
          </div>
        )}
      </div>

      {/* ── Right: Flags + Audio ─────────────────────── */}
      <div style={{ width: 280, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#8aaabe', cursor: 'pointer' }}>
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
          <div style={{ color: '#3a5a6a', fontSize: 12, padding: 8 }}>No conditions — trigger will always fire.</div>
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
          <div style={{ color: '#3a5a6a', fontSize: 12, padding: 8 }}>No actions defined.</div>
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
          <span style={{ color: '#5a7a8a', fontSize: 12 }}>=</span>
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

      <button style={{ ...btnDanger, padding: '4px 8px', fontSize: 11 }} onClick={onDelete}>✕</button>
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
            <button style={{ ...btn, padding: '4px 8px', fontSize: 11 }}
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

      <button style={{ ...btnDanger, padding: '4px 8px', fontSize: 11 }} onClick={onDelete}>✕</button>
    </div>
  );
}


// ── Flag Panel ────────────���───────────────────────────────────────────────

function FlagPanel({ flags }: { flags: { flagId: string; setBy: string[]; readBy: string[] }[] }) {
  return (
    <div style={card}>
      <div style={label}>Flags ({flags.length})</div>
      {flags.length === 0 ? (
        <div style={{ color: '#3a5a6a', fontSize: 12 }}>No flags in use.</div>
      ) : (
        <div style={{ maxHeight: 250, overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
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
                  <td style={{ padding: 4, color: '#60c080', fontSize: 11 }}>{f.setBy.join(', ') || '—'}</td>
                  <td style={{ padding: 4, color: '#6ab4f0', fontSize: 11 }}>{f.readBy.join(', ') || '—'}</td>
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

      {audioError && <div style={{ color: '#e06060', fontSize: 11, marginBottom: 6 }}>{audioError}</div>}

      {audioFiles.length === 0 ? (
        <div style={{ color: '#3a5a6a', fontSize: 12 }}>No audio files in .miz</div>
      ) : (
        <div style={{ maxHeight: 300, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {audioFiles.map((af) => (
            <div key={af.path} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
              background: '#0a1420', borderRadius: 4, fontSize: 12,
            }}>
              <button
                style={{ ...btn, padding: '2px 6px', fontSize: 10 }}
                onClick={() => handlePlay(af.path)}
                title="Preview"
              >▶</button>
              <div style={{ flex: 1, color: '#ccdae8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {af.filename}
              </div>
              <span style={{ color: '#5a7a8a', fontSize: 10 }}>{formatSize(af.sizeBytes)}</span>
              <button
                style={{ ...btnDanger, padding: '2px 6px', fontSize: 10 }}
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
