/**
 * TriggerPresetsPanel — save / load / export / import the current
 * trigger setup as a named preset so it can be reused across missions.
 *
 * What gets carried in a preset:
 *   - rules[]            — every trigger rule (conditions + actions)
 *   - dmHints            — per-rule DM-fire toggles (flag indices in
 *                          the 9001+ range) from localStorage
 *   - audioFiles[]       — references only (filename + path). The
 *                          actual audio bytes aren't moved between
 *                          missions; if the new mission doesn't have
 *                          the same file uploaded, the rule still
 *                          loads but the audio reference will dangle.
 *                          UI warns when this would happen.
 *
 * What's NOT in a preset:
 *   - Flag info — derived from rules on load.
 *   - Trigger zones — those live on the .miz directly, not the rule
 *                    list. Re-author from the Map tab in the target
 *                    mission.
 *
 * Two storage paths:
 *   - localStorage (`dcsopt.trigger.presets`) — your own library,
 *     survives browser sessions. Cap at ~30 presets to keep the JSON
 *     small.
 *   - .json file — for sharing across machines / squadron members.
 *     Same payload shape, version-stamped so future migrations are
 *     possible.
 *
 * Load modes:
 *   - REPLACE: clear current rules, load preset's rules verbatim.
 *   - MERGE: append preset rules to the current set; IDs are
 *     re-numbered starting after the current max so they don't
 *     collide with existing rule IDs.
 *
 * v1.19.36
 */

import { useEffect, useMemo, useState } from 'react';
import { useTriggerStore } from '../../store/triggerStore';
import type { TriggerRule, AudioFile } from '../../types/mission';

const PRESETS_LS_KEY = 'dcsopt.trigger.presets';
const DM_HINTS_LS_KEY = 'dcsopt.editor.triggerDmFire';
const MAX_PRESETS = 30;

type DmHints = Record<string, { dmFire: boolean; flagIndex: number }>;

interface TriggerPreset {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  version: 1;
  rules: TriggerRule[];
  dmHints?: DmHints;
  audioFiles?: AudioFile[];
}

function loadPresets(): TriggerPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function savePresets(p: TriggerPreset[]): void {
  try { localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(p.slice(0, MAX_PRESETS))); }
  catch (e) {
    // QuotaExceeded — caller surfaces a message in the UI.
    throw e;
  }
}

function newId(): string {
  return `tp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function loadDmHints(): DmHints {
  try { return JSON.parse(localStorage.getItem(DM_HINTS_LS_KEY) || '{}') as DmHints; }
  catch { return {}; }
}

function saveDmHints(h: DmHints): void {
  try { localStorage.setItem(DM_HINTS_LS_KEY, JSON.stringify(h)); } catch { /* swallow */ }
}

interface Props {
  /** Receives a message to surface in the parent's status chip. */
  onStatus?: (msg: string, kind?: 'ok' | 'err') => void;
}

export function TriggerPresetsPanel({ onStatus }: Props) {
  const { rules, audioFiles, loadTriggers } = useTriggerStore();

  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<TriggerPreset[]>(() => loadPresets());
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Keep presets list reactive to localStorage changes (e.g. import).
  useEffect(() => { setPresets(loadPresets()); }, [open]);

  const flash = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    onStatus?.(msg, kind);
  };

  // ── Save current as preset ────────────────────────────────────────────
  const handleSaveCurrent = () => {
    const name = newName.trim();
    if (!name) { flash('Preset needs a name', 'err'); return; }
    if (rules.length === 0) { flash('No triggers to save', 'err'); return; }
    const preset: TriggerPreset = {
      id: newId(),
      name,
      description: newDesc.trim() || undefined,
      createdAt: Date.now(),
      version: 1,
      rules: structuredClone(rules),
      dmHints: loadDmHints(),
      audioFiles: audioFiles.length ? structuredClone(audioFiles) : undefined,
    };
    try {
      const next = [preset, ...presets].slice(0, MAX_PRESETS);
      savePresets(next);
      setPresets(next);
      setNewName(''); setNewDesc('');
      flash(`Saved preset "${name}"`);
    } catch (e) {
      flash(`Save failed: ${e instanceof Error ? e.message : 'quota?'}`, 'err');
    }
  };

  // ── Load a preset (replace or merge) ──────────────────────────────────
  const handleLoad = (p: TriggerPreset, mode: 'replace' | 'merge') => {
    let nextRules: TriggerRule[];
    if (mode === 'replace') {
      nextRules = structuredClone(p.rules);
      // DM hints — replace mode adopts the preset's hints wholesale.
      if (p.dmHints) saveDmHints(p.dmHints);
      else saveDmHints({});
    } else {
      const maxId = rules.reduce((m, r) => Math.max(m, r.id), 0);
      const additions = structuredClone(p.rules).map((r, i) => {
        const newRuleId = maxId + i + 1;
        return { ...r, id: newRuleId };
      });
      nextRules = [...rules, ...additions];
      // DM hints — merge mode appends, re-keyed to the new rule IDs.
      // Build a mapping from old rule.id → new rule.id so the hints
      // follow their owner.
      const idMap = new Map<number, number>();
      p.rules.forEach((r, i) => idMap.set(r.id, maxId + i + 1));
      if (p.dmHints) {
        const existing = loadDmHints();
        const merged: DmHints = { ...existing };
        for (const [oldKey, hint] of Object.entries(p.dmHints)) {
          const oldId = Number(oldKey);
          const newId = idMap.get(oldId);
          if (newId != null) merged[String(newId)] = hint;
        }
        saveDmHints(merged);
      }
    }
    loadTriggers(nextRules, [], audioFiles);
    flash(`${mode === 'replace' ? 'Replaced' : 'Merged'} ${p.rules.length} trigger${p.rules.length === 1 ? '' : 's'} from "${p.name}"`);
  };

  const handleDelete = (id: string) => {
    const next = presets.filter((p) => p.id !== id);
    savePresets(next);
    setPresets(next);
    setConfirmDelete(null);
    flash('Preset deleted');
  };

  // ── Export .json ──────────────────────────────────────────────────────
  const handleExport = (p: TriggerPreset) => {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${p.name.replace(/[^a-z0-9_-]+/gi, '_')}.dcsopt-triggers.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Export the CURRENT setup (no preset save) ─────────────────────────
  const handleExportCurrent = () => {
    if (rules.length === 0) { flash('No triggers to export', 'err'); return; }
    const p: TriggerPreset = {
      id: newId(),
      name: newName.trim() || 'untitled-triggers',
      description: newDesc.trim() || undefined,
      createdAt: Date.now(),
      version: 1,
      rules: structuredClone(rules),
      dmHints: loadDmHints(),
      audioFiles: audioFiles.length ? structuredClone(audioFiles) : undefined,
    };
    handleExport(p);
    flash('Exported to .json');
  };

  // ── Import .json ──────────────────────────────────────────────────────
  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.rules)) {
        throw new Error('Not a DCS:OPT trigger preset file');
      }
      if (parsed.version !== 1) {
        flash(`Warning: preset version ${parsed.version} is newer than v1 — loading anyway`, 'err');
      }
      // Normalise into the preset shape and save to the library.
      const p: TriggerPreset = {
        id: newId(),
        name: parsed.name || file.name.replace(/\.[^.]+$/, ''),
        description: parsed.description,
        createdAt: Date.now(),
        version: 1,
        rules: parsed.rules,
        dmHints: parsed.dmHints,
        audioFiles: parsed.audioFiles,
      };
      const next = [p, ...presets].slice(0, MAX_PRESETS);
      savePresets(next);
      setPresets(next);
      flash(`Imported "${p.name}" — pick load mode below`);
    } catch (e) {
      flash(`Import failed: ${e instanceof Error ? e.message : 'bad JSON'}`, 'err');
    }
  };

  const audioPathsInCurrent = useMemo(
    () => new Set(audioFiles.map((a) => a.path)),
    [audioFiles],
  );

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #3a3a3a', borderRadius: 6, marginBottom: 12 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px', background: 'transparent', border: 'none',
          color: '#cfe6ff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <span>📦 Trigger Presets <span style={{ color: '#888', fontWeight: 400, marginLeft: 6 }}>({presets.length} saved)</span></span>
        <span style={{ color: '#888', fontSize: 11 }}>{open ? '▾ collapse' : '▸ expand'}</span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px', borderTop: '1px solid #2a2a2a' }}>
          {/* Save current */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <input
              value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="Preset name (e.g. CASE III recovery framework)"
              style={fieldStyle}
            />
            <input
              value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Optional description"
              style={{ ...fieldStyle, flex: 2 }}
            />
            <button onClick={handleSaveCurrent}
                    title={`Save current ${rules.length} trigger(s) as a named preset (browser only)`}
                    style={btnPrimaryStyle}>
              💾 Save current
            </button>
            <button onClick={handleExportCurrent}
                    title="Export current triggers to a .json file for sharing"
                    style={btnSecondaryStyle}>
              ⬇ Export .json
            </button>
            <label style={{ ...btnSecondaryStyle, padding: '5px 10px', cursor: 'pointer' }}>
              ⬆ Import .json
              <input type="file" accept="application/json,.json" style={{ display: 'none' }}
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImport(f); e.target.value = ''; }} />
            </label>
          </div>

          {presets.length === 0 ? (
            <div style={{ padding: 12, color: '#888', fontSize: 12, fontStyle: 'italic', textAlign: 'center', border: '1px dashed #3a3a3a', borderRadius: 4 }}>
              No saved presets yet. Build your triggers, name a preset above, and hit <b style={{ color: '#cfe6ff' }}>Save current</b>.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {presets.map((p) => {
                const missingAudio = (p.audioFiles ?? [])
                  .filter((a) => !audioPathsInCurrent.has(a.path));
                return (
                  <div key={p.id} style={presetRowStyle}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13 }}>
                        {p.name}
                        <span style={{ color: '#888', fontWeight: 400, marginLeft: 8, fontSize: 11 }}>
                          {p.rules.length} rule{p.rules.length === 1 ? '' : 's'}
                          {p.audioFiles?.length ? ` · ${p.audioFiles.length} audio ref${p.audioFiles.length === 1 ? '' : 's'}` : ''}
                        </span>
                      </div>
                      {p.description && (
                        <div style={{ color: '#aaa', fontSize: 11, marginTop: 2 }}>{p.description}</div>
                      )}
                      <div style={{ color: '#666', fontSize: 10, marginTop: 2, fontFamily: "'B612 Mono', monospace" }}>
                        Saved {new Date(p.createdAt).toLocaleString()}
                      </div>
                      {missingAudio.length > 0 && (
                        <div style={{ color: '#d29922', fontSize: 11, marginTop: 4 }}>
                          ⚠ {missingAudio.length} audio reference{missingAudio.length === 1 ? '' : 's'} not in current mission — those actions will load with a dangling audio path.
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => handleLoad(p, 'replace')}
                              title="Clear current triggers and load this preset's rules verbatim"
                              style={btnPrimaryStyle}>
                        ⤴ Replace
                      </button>
                      <button onClick={() => handleLoad(p, 'merge')}
                              title="Append this preset's rules to the current set (IDs renumbered to avoid collision)"
                              style={btnSecondaryStyle}>
                        + Merge
                      </button>
                      <button onClick={() => handleExport(p)}
                              title="Download this preset as a .json file"
                              style={btnSecondaryStyle}>
                        ⬇
                      </button>
                      {confirmDelete === p.id ? (
                        <>
                          <button onClick={() => handleDelete(p.id)}
                                  style={btnDangerStyle}>
                            Delete?
                          </button>
                          <button onClick={() => setConfirmDelete(null)}
                                  style={btnSecondaryStyle}>
                            ×
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDelete(p.id)}
                                title="Remove this preset from your library"
                                style={btnSubtleStyle}>
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 10, color: '#666', lineHeight: 1.5 }}>
            Presets store in your browser (max {MAX_PRESETS}). They <b style={{ color: '#888' }}>don't</b> include trigger zones (those live on the .miz itself) or audio bytes (only references). For squadron sharing, use <b style={{ color: '#999' }}>Export .json</b> and pass the file around.
          </div>
        </div>
      )}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  flex: 1, minWidth: 180, padding: '5px 9px', fontSize: 12,
  background: '#0a0a0a', border: '1px solid #3a3a3a', borderRadius: 3,
  color: '#e0e0e0', fontFamily: 'inherit', outline: 'none',
};
const btnPrimaryStyle: React.CSSProperties = {
  padding: '5px 12px', fontSize: 12, fontWeight: 600,
  background: 'rgba(74,143,212,0.15)', border: '1px solid #4a8fd4',
  borderRadius: 3, color: '#cfe6ff', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};
const btnSecondaryStyle: React.CSSProperties = {
  padding: '5px 10px', fontSize: 12, fontWeight: 500,
  background: 'transparent', border: '1px solid #4a4a4a',
  borderRadius: 3, color: '#aaa', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};
const btnSubtleStyle: React.CSSProperties = {
  padding: '5px 8px', fontSize: 12, background: 'transparent',
  border: '1px solid transparent', color: '#888', cursor: 'pointer', fontFamily: 'inherit',
};
const btnDangerStyle: React.CSSProperties = {
  padding: '5px 10px', fontSize: 12, fontWeight: 600,
  background: 'rgba(224,85,79,0.15)', border: '1px solid #e0554f',
  borderRadius: 3, color: '#ffb0ad', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};
const presetRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 10,
  padding: 10, background: '#0d0d0d', border: '1px solid #2a2a2a',
  borderRadius: 4,
};
