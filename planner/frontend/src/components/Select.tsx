/**
 * Shared select primitive — same theme as TextInput.
 *
 * Pairs with TextInput.tsx so a row of fields renders consistently
 * regardless of whether each field is a free-text input or a
 * dropdown. Variants only cover the dark style; more theming can
 * follow if/when the planner introduces light mode.
 *
 * API:
 *   <Select value={...} onChange={...}>
 *     <option value="a">A</option>
 *     ...
 *   </Select>
 *   <Select size="sm">...</Select>
 *
 * Pass-through: native <select> props (value, onChange, name, ...).
 */

import { type SelectHTMLAttributes, type CSSProperties, forwardRef } from 'react';

export type SelectSize = 'sm' | 'md';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  size?: SelectSize;
}

const SIZE: Record<SelectSize, { padding: string; fontSize: number }> = {
  sm: { padding: '3px 6px', fontSize: 12 },
  md: { padding: '4px 8px', fontSize: 13 },
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ size = 'md', style, ...rest }, ref) {
    const s = SIZE[size];
    const merged: CSSProperties = {
      background: '#262626',
      border: '1px solid #3a3a3a',
      borderRadius: 4,
      color: '#e0e0e0',
      fontSize: s.fontSize,
      fontFamily: 'inherit',
      padding: s.padding,
      outline: 'none',
      cursor: 'pointer',
      ...style,
    };
    return <select ref={ref} style={merged} {...rest} />;
  },
);
