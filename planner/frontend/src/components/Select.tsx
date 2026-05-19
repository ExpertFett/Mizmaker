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

// Drop native `size` (number of visible options) so we can repurpose
// the slot for our 'sm' | 'md' visual variant — same reasoning as
// TextInput. Multi-row select isn't a pattern this primitive serves.
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
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
      background: '#6e7c83',
      border: '1px solid #4a5258',
      borderRadius: 4,
      color: '#1a1f25',
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
