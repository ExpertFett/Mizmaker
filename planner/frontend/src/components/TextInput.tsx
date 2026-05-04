/**
 * Shared text input primitive.
 *
 * Consolidates the dark `inputStyle` object that ~30 tab files
 * reinvent (background #262626, border #3a3a3a, color #cccccc, etc.).
 * Same migration strategy as Button.tsx — incremental adoption,
 * existing inline-styled inputs continue working unchanged.
 *
 * API:
 *   <TextInput value={x} onChange={(e) => set(e.target.value)} />
 *   <TextInput type="number" placeholder="Channel" />
 *   <TextInput size="sm" />                         smaller / table-row sizing
 *   <TextInput style={{ width: '100%' }} />         caller styles win on merge
 *   <TextInput invalid />                            red ring for validation
 *
 * Pass-through: every native <input> prop (type, value, onChange, name,
 * autoFocus, ref, ...) passes through unchanged.
 */

import { type InputHTMLAttributes, type CSSProperties, forwardRef } from 'react';

export type TextInputSize = 'sm' | 'md';

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  size?: TextInputSize;
  /** Render with a red border so the user can spot a validation
   *  failure inline without adding a separate error element. The
   *  caller is responsible for clearing this when the input
   *  validates. */
  invalid?: boolean;
}

const SIZE: Record<TextInputSize, { padding: string; fontSize: number }> = {
  sm: { padding: '3px 6px', fontSize: 12 },
  md: { padding: '6px 8px', fontSize: 13 },
};

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ size = 'md', invalid, style, ...rest }, ref) {
    const s = SIZE[size];
    const merged: CSSProperties = {
      background: '#262626',
      border: `1px solid ${invalid ? '#d95050' : '#3a3a3a'}`,
      borderRadius: 3,
      color: '#cccccc',
      fontSize: s.fontSize,
      fontFamily: 'inherit',
      padding: s.padding,
      outline: 'none',
      ...style,
    };
    return <input ref={ref} style={merged} {...rest} />;
  },
);
