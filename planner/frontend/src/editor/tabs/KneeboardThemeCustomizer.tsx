/**
 * KneeboardThemeCustomizer — pick colors / font / accent for the
 * kneeboard cards, save named themes, import/export JSON for sharing.
 *
 * The existing v0.9.74 theme system is CSS-variable driven; this panel
 * exposes the variables as labelled pickers. When the user changes any
 * value we set `theme: 'custom'` on the kneeboard settings and write
 * the resolved variable map to `customThemeVars`. Night / Day buttons
 * collapse back to the named built-ins (clearing customThemeVars when
 * the user picks Night, or seeding day defaults when they pick Day).
 *
 * Saved themes live in localStorage under `dcsopt.kneeboard.themes`,
 * capped at 30 entries. Same shape exports cleanly to .json so
 * squadrons can ship a house style around.
 *
 * v1.19.37
 */

import { useEffect, useMemo, useState } from 'react';
import { useEditStore } from '../../store/editStore';
import {
  KB_DAY_VARS, type KbVarMap,
  resolveKbVars,
} from '../../kneeboard/cardStyles';

const THEMES_LS_KEY = 'dcsopt.kneeboard.themes';
const MAX_THEMES = 30;

// Picker layout — order matters; each row gets a label + control.
type PickerKind = 'color' | 'font' | 'rgba';
interface PickerDef { key: string; label: string; kind: PickerKind; group: 'core' | 'advanced'; }

const PICKERS: PickerDef[] = [
  { key: '--kb-bg',           label: 'Background',         kind: 'color', group: 'core' },
  { key: '--kb-text',         label: 'Text',               kind: 'color', group: 'core' },
  { key: '--kb-accent',       label: 'Accent (orange)',    kind: 'color', group: 'core' },
  { key: '--kb-warn',         label: 'Warning (amber)',    kind: 'color', group: 'core' },
  { key: '--kb-border',       label: 'Border',             kind: 'color', group: 'core' },
  { key: '--kb-font',         label: 'Font',               kind: 'font',  group: 'core' },
  // Advanced
  { key: '--kb-text-bright',  label: 'Text bright',        kind: 'color', group: 'advanced' },
  { key: '--kb-text-muted',   label: 'Text muted',         kind: 'color', group: 'advanced' },
  { key: '--kb-dim',          label: 'Text dim',           kind: 'color', group: 'advanced' },
  { key: '--kb-border-med',   label: 'Border (mid)',       kind: 'color', group: 'advanced' },
  { key: '--kb-border-light', label: 'Border (light)',     kind: 'color', group: 'advanced' },
  { key: '--kb-notes-bg',     label: 'Notes background',   kind: 'color', group: 'advanced' },
  { key: '--kb-th-bg',        label: 'Table header bg',    kind: 'color', group: 'advanced' },
  { key: '--kb-row-alt',      label: 'Row stripe',         kind: 'rgba',  group: 'advanced' },
];

const FONT_OPTIONS = [
  { value: "'Arial', sans-serif",                 label: 'Arial (default, safest)' },
  { value: "'Helvetica', 'Arial', sans-serif",    label: 'Helvetica' },
  { value: "'Verdana', sans-serif",               label: 'Verdana (wider)' },
  { value: "'Tahoma', sans-serif",                label: 'Tahoma' },
  { value: "'Trebuchet MS', sans-serif",          label: 'Trebuchet MS' },
  { value: "'Georgia', serif",                    label: 'Georgia (serif)' },
  { value: "'Times New Roman', serif",            label: 'Times New Roman' },
  { value: "'Courier New', monospace",            label: 'Courier New (mono)' },
  { value: "'Consolas', 'Monaco', monospace",     label: 'Consolas (mono)' },
  { value: "'B612', 'Arial', sans-serif",         label: 'B612 (DCS:OPT UI font)' },
];

// Built-in dark-mode fallbacks — match the var() defaults baked into
// cardStyles.ts so the picker displays the actual current colour even
// when the user is still on the 'night' (no-override) theme.
const NIGHT_VARS: KbVarMap = {
  '--kb-bg': '#1a1a1a',
  '--kb-notes-bg': '#4a4a4a',
  '--kb-border': '#444444',
  '--kb-border-med': '#555555',
  '--kb-border-light': '#666666',
  '--kb-text': '#e0e0e0',
  '--kb-text-bright': '#ffffff',
  '--kb-text-muted': '#cccccc',
  '--kb-dim': '#aaaaaa',
  '--kb-row-alt': 'rgba(255, 165, 0, 0.04)',
  '--kb-th-bg': '#333333',
  '--kb-accent': '#ffa500',
  '--kb-warn': '#d9a050',
  '--kb-font': "'Arial', sans-serif",
};

interface SavedTheme {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  version: 1;
  vars: KbVarMap;
}

function loadSavedThemes(): SavedTheme[] {
  try {
    const raw = localStorage.getItem(THEMES_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveSavedThemes(t: SavedTheme[]): void {
  try { localStorage.setItem(THEMES_LS_KEY, JSON.stringify(t.slice(0, MAX_THEMES))); }
  catch { /* quota — silent */ }
}

function newId(): string { return `kt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }

export function KneeboardThemeCustomizer() {
  const kb = useEditStore((s) => s.kneeboardSettings);
  const setKb = useEditStore((s) => s.setKneeboardSettings);

  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saved, setSaved] = useState<SavedTheme[]>(() => loadSavedThemes());
  const [newName, setNewName] = useState('');
  const [status, setStatus] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => setStatus(null), 3500);
    return () => window.clearTimeout(t);
  }, [status]);

  // Effective var map for the live preview pickers. When theme is
  // 'custom' we read customThemeVars; otherwise fall back to the
  // built-in night / day map.
  const effectiveVars: KbVarMap = useMemo(() => {
    if (kb.theme === 'custom') {
      // Custom merges over the dark fallbacks so unset keys still show
      // a sensible swatch in the picker.
      return { ...NIGHT_VARS, ...(kb.customThemeVars || {}) };
    }
    if (kb.theme === 'day') return { ...NIGHT_VARS, ...KB_DAY_VARS };
    return NIGHT_VARS;
  }, [kb.theme, kb.customThemeVars]);

  const setVar = (key: string, value: string) => {
    // Any picker change converts us to a 'custom' theme. Start from
    // whatever map is currently effective so the user sees their
    // tweak land on top of the previous look (Night or Day).
    const baseVars: KbVarMap = kb.theme === 'custom'
      ? (kb.customThemeVars || {})
      : kb.theme === 'day'
        ? { ...KB_DAY_VARS }
        : {};
    const nextVars = { ...baseVars, [key]: value };
    setKb({ theme: 'custom', customThemeVars: nextVars });
  };

  const resetToNight = () => setKb({ theme: 'night', customThemeVars: undefined });
  const resetToDay = () => setKb({ theme: 'day', customThemeVars: undefined });

  const flash = (msg: string, kind: 'ok' | 'err' = 'ok') => setStatus({ msg, kind });

  // Save current custom map to the library.
  const saveCurrent = () => {
    const name = newName.trim();
    if (!name) { flash('Theme needs a name', 'err'); return; }
    // We capture the EFFECTIVE map (not just customThemeVars) so a
    // user can save "Day with red accent" cleanly when they only
    // overrode the accent on top of day mode.
    const t: SavedTheme = {
      id: newId(),
      name,
      createdAt: Date.now(),
      version: 1,
      vars: resolveKbVars(kb.theme, kb.customThemeVars),
    };
    const next = [t, ...saved].slice(0, MAX_THEMES);
    saveSavedThemes(next);
    setSaved(next);
    setNewName('');
    flash(`Saved theme "${name}"`);
  };

  const loadTheme = (t: SavedTheme) => {
    setKb({ theme: 'custom', customThemeVars: t.vars });
    flash(`Loaded "${t.name}"`);
  };

  const deleteTheme = (id: string) => {
    const next = saved.filter((t) => t.id !== id);
    saveSavedThemes(next);
    setSaved(next);
  };

  const exportTheme = (t: SavedTheme) => {
    const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t.name.replace(/[^a-z0-9_-]+/gi, '_')}.dcsopt-kneeboard-theme.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportCurrent = () => {
    const t: SavedTheme = {
      id: newId(),
      name: newName.trim() || 'untitled-theme',
      createdAt: Date.now(),
      version: 1,
      vars: resolveKbVars(kb.theme, kb.customThemeVars),
    };
    exportTheme(t);
    flash('Exported to .json');
  };

  const importTheme = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed?.vars || typeof parsed.vars !== 'object') {
        throw new Error('Not a DCS:OPT kneeboard-theme file');
      }
      const t: SavedTheme = {
        id: newId(),
        name: parsed.name || file.name.replace(/\.[^.]+$/, ''),
        description: parsed.description,
        createdAt: Date.now(),
        version: 1,
        vars: parsed.vars,
      };
      const next = [t, ...saved].slice(0, MAX_THEMES);
      saveSavedThemes(next);
      setSaved(next);
      flash(`Imported "${t.name}" — click Load to apply`);
    } catch (e) {
      flash(`Import failed: ${e instanceof Error ? e.message : 'bad JSON'}`, 'err');
    }
  };

  const visiblePickers = showAdvanced ? PICKERS : PICKERS.filter((p) => p.group === 'core');

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #3a3a3a', borderRadius: 6, marginBottom: 12 }}>
      <button onClick={() => setOpen((o) => !o)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 14px', background: 'transparent', border: 'none',
                color: '#cfe6ff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>
        <span>🎨 Kneeboard theme customizer
          <span style={{ color: '#888', fontWeight: 400, marginLeft: 6 }}>
            ({kb.theme === 'custom' ? 'custom' : kb.theme} · {saved.length} saved)
          </span>
        </span>
        <span style={{ color: '#888', fontSize: 11 }}>{open ? '▾ collapse' : '▸ expand'}</span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px', borderTop: '1px solid #2a2a2a' }}>
          {/* Quick presets row */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <button onClick={resetToNight}
                    style={presetBtn(kb.theme === 'night')}>🌑 Night</button>
            <button onClick={resetToDay}
                    style={presetBtn(kb.theme === 'day')}>☀ Day</button>
            <div style={{ flex: 1 }} />
            <label style={{ ...secondaryBtn, padding: '5px 10px', cursor: 'pointer' }}>
              ⬆ Import .json
              <input type="file" accept="application/json,.json" style={{ display: 'none' }}
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) void importTheme(f); e.target.value = ''; }} />
            </label>
            <button onClick={exportCurrent} style={secondaryBtn}>⬇ Export current</button>
          </div>

          {/* Picker grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 6, marginBottom: 8,
          }}>
            {visiblePickers.map((p) => (
              <Picker key={p.key} def={p} value={effectiveVars[p.key as keyof KbVarMap] || ''}
                      onChange={(v) => setVar(p.key, v)} />
            ))}
          </div>
          <button onClick={() => setShowAdvanced((a) => !a)}
                  style={{ ...secondaryBtn, padding: '3px 10px', fontSize: 11 }}>
            {showAdvanced ? '▴ Hide' : '▾ Show'} advanced colors
          </button>

          {/* Save-as section */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
                   placeholder="Theme name (e.g. Bengals night, VMFA-224 light)"
                   style={inputField} />
            <button onClick={saveCurrent} style={primaryBtn}>💾 Save current as theme</button>
          </div>

          {/* Saved themes list */}
          {saved.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ fontSize: 10, color: '#888', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>
                Saved themes
              </div>
              {saved.map((t) => (
                <div key={t.id} style={savedRow}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['--kb-bg', '--kb-text', '--kb-accent', '--kb-border'] as const).map((k) => (
                      <div key={k} title={k}
                           style={{ width: 14, height: 14, borderRadius: 2, border: '1px solid #555',
                                    background: t.vars[k] || NIGHT_VARS[k] }} />
                    ))}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#e0e0e0', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.name}
                    </div>
                    <div style={{ color: '#666', fontSize: 9, fontFamily: "'B612 Mono', monospace" }}>
                      {new Date(t.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button onClick={() => loadTheme(t)} style={primaryBtn}>Load</button>
                  <button onClick={() => exportTheme(t)} style={secondaryBtn}>⬇</button>
                  <button onClick={() => deleteTheme(t.id)} title="Delete"
                          style={{ ...secondaryBtn, color: '#e0554f', borderColor: '#5a3a3a' }}>🗑</button>
                </div>
              ))}
            </div>
          )}

          {status && (
            <div style={{ marginTop: 8, fontSize: 12,
                          color: status.kind === 'err' ? '#e0554f' : '#3fb950' }}>
              {status.msg}
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 10, color: '#666', lineHeight: 1.5 }}>
            Changes apply to every kneeboard card preview + PNG export. Themes save to
            your browser (max {MAX_THEMES}); for squadron-wide use, hit
            <b style={{ color: '#888' }}> ⬇ Export</b> and share the .json.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Picker control ──────────────────────────────────────────────────────

function Picker({ def, value, onChange }: {
  def: PickerDef; value: string; onChange: (v: string) => void;
}) {
  if (def.kind === 'font') {
    return (
      <label style={pickerWrap}>
        <span style={pickerLabel}>{def.label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}
                style={{ ...inputField, padding: '5px 8px' }}>
          {FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </label>
    );
  }
  // 'color' + 'rgba' — both edit the raw string. Color uses a native
  // picker for #RRGGBB; rgba falls back to a text input because
  // <input type="color"> won't accept rgba().
  if (def.kind === 'rgba' || !/^#[0-9a-f]{6,8}$/i.test(value)) {
    return (
      <label style={pickerWrap}>
        <span style={pickerLabel}>{def.label}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <div style={{ width: 28, height: 28, borderRadius: 3, border: '1px solid #3a3a3a', background: value || 'transparent', flexShrink: 0 }} />
          <input value={value} onChange={(e) => onChange(e.target.value)}
                 placeholder="rgba(...) or #rrggbb"
                 style={{ ...inputField, flex: 1, padding: '5px 7px', fontFamily: "'B612 Mono', monospace" }} />
        </div>
      </label>
    );
  }
  return (
    <label style={pickerWrap}>
      <span style={pickerLabel}>{def.label}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        <input type="color" value={value.toLowerCase()} onChange={(e) => onChange(e.target.value)}
               style={{ width: 36, height: 28, border: '1px solid #3a3a3a', borderRadius: 3, background: 'transparent', padding: 0 }} />
        <input value={value} onChange={(e) => onChange(e.target.value)}
               style={{ ...inputField, flex: 1, padding: '5px 7px', fontFamily: "'B612 Mono', monospace" }} />
      </div>
    </label>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────

const pickerWrap: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 3,
  padding: 6, background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 4,
};
const pickerLabel: React.CSSProperties = {
  fontSize: 10, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 600,
};
const inputField: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #3a3a3a', color: '#e0e0e0',
  borderRadius: 3, fontSize: 12, fontFamily: 'inherit', outline: 'none',
};
const primaryBtn: React.CSSProperties = {
  padding: '5px 12px', fontSize: 12, fontWeight: 600,
  background: 'rgba(74,143,212,0.15)', border: '1px solid #4a8fd4',
  borderRadius: 3, color: '#cfe6ff', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};
const secondaryBtn: React.CSSProperties = {
  padding: '5px 10px', fontSize: 12, fontWeight: 500,
  background: 'transparent', border: '1px solid #4a4a4a',
  borderRadius: 3, color: '#aaa', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};
const presetBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 12px', fontSize: 12, fontWeight: 600,
  background: active ? 'rgba(74,143,212,0.18)' : 'transparent',
  border: `1px solid ${active ? '#4a8fd4' : '#3a3a3a'}`,
  borderRadius: 3, color: active ? '#cfe6ff' : '#aaa',
  cursor: 'pointer', fontFamily: 'inherit',
});
const savedRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '6px 10px', background: '#0d0d0d', border: '1px solid #2a2a2a',
  borderRadius: 3,
};
