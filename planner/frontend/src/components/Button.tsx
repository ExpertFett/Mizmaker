/**
 * Shared button primitive.
 *
 * First UI primitive in the repo. Establishes the pattern Phase 3 of
 * the standing safety-net plan calls for: pull repeated styling out of
 * individual tabs into typed components in `src/components/`. Goal is
 * not to be a design system — just to stop the proliferation of one-off
 * `btnStyle` objects scattered across 30+ tab files.
 *
 * API:
 *   <Button onClick={...}>Save</Button>                      default blue
 *   <Button variant="success" onClick={...}>Apply</Button>   green
 *   <Button variant="danger"  onClick={...}>Clear All</Button> red
 *   <Button variant="subtle"  onClick={...}>Cancel</Button>  gray
 *   <Button size="sm">Mini</Button>                          smaller padding
 *   <Button disabled>...</Button>                            dimmed, no events
 *
 * Pass-through:
 *   - `style` is merged on top of the variant styles so callers can
 *     extend (e.g. add `width: '100%'`) without forking the variant.
 *   - All other native button props (type, title, autoFocus, ref, ...)
 *     pass through unchanged.
 *
 * Migration strategy: replace one-off `<button style={btnStyle}>` calls
 * incrementally. Existing inline styles are not actively harmful — this
 * primitive is here so new code has a target and old hot-spots can be
 * unified opportunistically.
 */

import { type ButtonHTMLAttributes, type CSSProperties, forwardRef } from 'react';

export type ButtonVariant = 'default' | 'success' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

// Variant palette — mirrors the colour conventions already in use across
// the editor tabs. If we ever theme the planner, these are the tokens
// to swap.
const VARIANT: Record<ButtonVariant, { bg: string; border: string; fg: string }> = {
  default: { bg: '#262626', border: '#4a8fd4', fg: '#4a8fd4' },
  success: { bg: 'rgba(63, 185, 80, 0.15)', border: 'rgba(63, 185, 80, 0.4)', fg: '#3fb950' },
  danger:  { bg: '#3a1a1a', border: '#5a2a2a', fg: '#d95050' },
  subtle:  { bg: '#262626', border: '#3a3a3a', fg: '#aaaaaa' },
};

const SIZE: Record<ButtonSize, { padding: string; fontSize: number }> = {
  sm: { padding: '4px 10px', fontSize: 12 },
  md: { padding: '6px 14px', fontSize: 13 },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = 'default', size = 'md', style, disabled, ...rest }, ref) {
    const v = VARIANT[variant];
    const s = SIZE[size];
    const merged: CSSProperties = {
      background: v.bg,
      border: `1px solid ${v.border}`,
      borderRadius: 4,
      color: v.fg,
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: s.fontSize,
      fontFamily: 'inherit',
      fontWeight: 600,
      padding: s.padding,
      opacity: disabled ? 0.5 : 1,
      transition: 'opacity 0.1s, background 0.1s',
      ...style,
    };
    return <button ref={ref} disabled={disabled} style={merged} {...rest} />;
  },
);
