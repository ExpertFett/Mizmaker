/** Shared kneeboard card constants and styles — DCS Kneeboard Style Guide */
import { createElement } from 'react';

export const W = 600;
export const H = 850;
// FONT is a CSS-variable now (v1.19.37) so a custom theme can swap it.
// Fallback stays Arial because every system has it and html2canvas
// resolves it without web-font loading lag.
export const FONT = "var(--kb-font, 'Arial', sans-serif)";
// Color tokens are CSS variables with the dark ("night") values baked in
// as fallbacks. Night mode therefore needs NO variables set — the
// fallbacks apply. Day mode is opted into by setting --kb-* variables on
// a wrapping element (see KB_DAY_VARS / applyKbTheme below); html2canvas
// resolves them via getComputedStyle at capture time. ACCENT + WARN +
// FONT became CSS vars in v1.19.37 so user-defined themes can override
// them; their dark-mode fallbacks preserve the original look.
export const BG = 'var(--kb-bg, #1a1a1a)';
export const BG_NOTES = 'var(--kb-notes-bg, #4a4a4a)';
export const BORDER = 'var(--kb-border, #444)';
export const BORDER_MED = 'var(--kb-border-med, #555)';
export const BORDER_LIGHT = 'var(--kb-border-light, #666)';
export const TEXT = 'var(--kb-text, #e0e0e0)';
export const TEXT_BRIGHT = 'var(--kb-text-bright, #fff)';
export const TEXT_MUTED = 'var(--kb-text-muted, #ccc)';
export const ACCENT = 'var(--kb-accent, #ffa500)';
export const WARN = 'var(--kb-warn, #d9a050)';
export const ROW_ALT = 'var(--kb-row-alt, rgba(255, 165, 0, 0.04))';
export const DIM = 'var(--kb-dim, #aaa)';
/** Table-header background. Themed via --kb-th-bg (dark #333 fallback). */
export const TH_BG = 'var(--kb-th-bg, #333)';

/** Per-theme variable names — keep this in sync with the CSS vars
 *  referenced above. The customizer iterates this list to render
 *  pickers + the theme store persists exactly these keys. */
export const KB_VAR_NAMES = [
  '--kb-bg', '--kb-notes-bg', '--kb-surface',
  '--kb-border', '--kb-border-med', '--kb-border-light',
  '--kb-text', '--kb-text-bright', '--kb-text-muted', '--kb-dim',
  '--kb-row-alt', '--kb-th-bg',
  '--kb-accent', '--kb-warn',
  '--kb-font',
  '--kb-notes-max-h',
] as const;
export type KbVarName = (typeof KB_VAR_NAMES)[number];
export type KbVarMap = Partial<Record<KbVarName, string>>;

// `'night'` and `'day'` are the named built-ins; anything else is a
// user-defined theme keyed by the customTheme.vars object on the
// kneeboard settings. Components keep accepting the literal string
// type so existing call sites compile unchanged.
export type KneeboardTheme = 'night' | 'day' | 'custom';

/** CSS-variable overrides for the light "day" theme. Night uses the
 *  literal fallbacks above, so it needs no overrides. */
export const KB_DAY_VARS: KbVarMap = {
  '--kb-bg': '#ffffff',
  '--kb-surface': '#f0f0f0',
  '--kb-notes-bg': '#ededed',
  '--kb-border': '#bcbcbc',
  '--kb-border-med': '#9a9a9a',
  '--kb-border-light': '#888888',
  '--kb-text': '#1a1a1a',
  '--kb-text-bright': '#000000',
  '--kb-text-muted': '#333333',
  '--kb-dim': '#555555',
  '--kb-row-alt': 'rgba(0, 0, 0, 0.05)',
  '--kb-th-bg': '#d8d8d8',
};

/** Resolve a theme name + optional custom-var overrides into the
 *  effective CSS-variable map. Night returns {} (everything falls
 *  through to the dark-mode fallbacks in the var() expressions);
 *  day applies KB_DAY_VARS; 'custom' applies the provided overrides
 *  verbatim. (v1.19.37) */
export function resolveKbVars(
  theme: KneeboardTheme,
  customVars?: KbVarMap,
): KbVarMap {
  if (theme === 'day') return { ...KB_DAY_VARS, ...(customVars ?? {}) };
  if (theme === 'custom') return { ...(customVars ?? {}) };
  // Night returns no colour vars — the var() fallbacks in the constants above
  // already are the night palette. Custom vars still merge: they used to be
  // dropped here, which silently ignored any non-colour variable (the notes
  // box height, for one) whenever the theme was the default.
  return { ...(customVars ?? {}) };
}

/** Inline style applying a theme's CSS variables — for a wrapper around
 *  a card in the live in-page preview. Cast through `unknown` because
 *  CSS custom properties aren't part of the React.CSSProperties type. */
export function kbThemeStyle(
  theme: KneeboardTheme,
  customVars?: KbVarMap,
): React.CSSProperties {
  return resolveKbVars(theme, customVars) as unknown as React.CSSProperties;
}

/** Set (or clear) a theme's CSS variables on a DOM element — used by the
 *  PNG renderer on the captured container so html2canvas resolves them. */
export function applyKbTheme(
  el: HTMLElement,
  theme: KneeboardTheme,
  customVars?: KbVarMap,
): void {
  const vars = resolveKbVars(theme, customVars);
  // Clear every known var so leftover settings from a previous theme
  // don't bleed through, then set the resolved values.
  for (const k of KB_VAR_NAMES) el.style.removeProperty(k);
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v === 'string' && v) el.style.setProperty(k, v);
  }
}

export const cardRoot: React.CSSProperties = {
  width: W,
  height: H,
  backgroundColor: BG,
  fontFamily: FONT,
  color: TEXT,
  padding: 12,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

export const headerStyle: React.CSSProperties = {
  textAlign: 'center',
  borderBottom: `2px solid ${BORDER_LIGHT}`,
  paddingBottom: 6,
  marginBottom: 10,
  flexShrink: 0,
};

export const titleStyle: React.CSSProperties = {
  fontSize: 25,
  fontWeight: 'bold',
  color: TEXT_BRIGHT,
  letterSpacing: 1,
};

export const subtitleStyle: React.CSSProperties = {
  fontSize: 17,
  color: TEXT_MUTED,
  marginTop: 4,
};

export const sectionTitle: React.CSSProperties = {
  fontSize: 21,
  fontWeight: 'bold',
  color: ACCENT,
  borderBottom: `1px solid ${BORDER_MED}`,
  paddingBottom: 2,
  margin: '0 0 4px 0',
  flexShrink: 0,
};

export const cell: React.CSSProperties = {
  padding: '3px 6px',
  border: `1px solid ${BORDER}`,
  color: TEXT,
  // 18, not 19: with nowrap + overflow hidden, every tight column clips
  // silently, and a full legibility sweep found 19px digits losing their
  // last glyph in the narrow ETE / DIST / FUEL columns. One point down is
  // invisible at cockpit distance and recovers ~5% width in every table.
  fontSize: 18,
  fontFamily: FONT,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};

export const th: React.CSSProperties = {
  backgroundColor: TH_BG,
  color: TEXT_MUTED,
  padding: '4px 6px',
  textAlign: 'center',
  border: `1px solid ${BORDER_MED}`,
  fontWeight: 'bold',
  fontSize: 17,
};

export const footerStyle: React.CSSProperties = {
  padding: '4px 0',
  borderTop: `1px solid ${BORDER}`,
  fontSize: 14,
  color: TEXT_MUTED,
  textAlign: 'right',
  flexShrink: 0,
  marginTop: 'auto',
};

/** Notes never take more than the bottom quarter of a card.
 *
 *  notesBox is `flex: 1`, so before this cap it absorbed every pixel the
 *  content above didn't use — which is why a sparse card looked like a header
 *  bolted to a giant grey box. Capping it means content above gets the room
 *  instead. */
export const NOTES_MAX_H = Math.round(H / 4);

/** Notes box height for a chosen size. Cards read the CSS variable so a
 *  single value set on the card root re-sizes every notes box on it, rather
 *  than every card needing the option threaded in. */
export const NOTES_H_VAR = '--kb-notes-max-h';

export const notesBox: React.CSSProperties = {
  backgroundColor: BG_NOTES,
  border: `1px solid ${BORDER_MED}`,
  borderRadius: 2,
  padding: '6px 8px',
  flex: 1,
  minHeight: 0,
  maxHeight: `var(${NOTES_H_VAR}, ${NOTES_MAX_H}px)`,
  // Without border-box the 6px padding + 1px border push the rendered box to
  // 227px — over the quarter-card budget the cap exists to enforce.
  boxSizing: 'border-box',
  overflow: 'hidden',
  fontSize: 17,
  color: TEXT,
};

export const row: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  padding: '4px 0',
  fontSize: 17,
};

export const label: React.CSSProperties = {
  color: TEXT_MUTED,
  fontSize: 15,
};

export const value: React.CSSProperties = {
  color: TEXT,
  fontSize: 17,
};

/** Format mission start time in seconds-from-midnight as Zulu time HHMM"Z" */
export function formatMissionTime(seconds: number | undefined | null): string {
  if (seconds == null || isNaN(seconds)) return '----Z';
  const h = Math.floor(seconds / 3600) % 24;
  const m = Math.floor((seconds % 3600) / 60);
  return `${h.toString().padStart(2, '0')}${m.toString().padStart(2, '0')}Z`;
}

const missionDateLineStyle: React.CSSProperties = {
  fontSize: 14,
  color: DIM,
  marginTop: 2,
  letterSpacing: 0.5,
  fontFamily: FONT,
};

/**
 * Renders a small "Theater | YYYY-MM-DD | HHMMZ" line for the kneeboard header.
 * Pass overview from the mission store. Theater is omitted if already in subtitle.
 */
export function MissionDateLine(props: {
  date?: string;
  startTime?: number;
  theater?: string;
  showTheater?: boolean;
}) {
  const { date, startTime, theater, showTheater = false } = props;
  const parts: string[] = [];
  if (showTheater && theater) parts.push(theater);
  if (date) parts.push(date);
  parts.push(formatMissionTime(startTime));
  return createElement('div', { style: missionDateLineStyle }, parts.join(' | '));
}
