/**
 * Tools tab — mission-authoring utilities: Rename, Batch edit, Livery.
 * (v1.19.110 — Livery merged in from its own top-level tab; all three are
 * batch/bulk authoring passes over the mission.)
 */

import { useState } from 'react';
import { RenamerTab } from './RenamerTab';
import { BatchEditTab } from './BatchEditTab';
import { LiveryTab } from './LiveryTab';

const SUB_TABS = [
  { id: 'rename', label: 'Rename' },
  { id: 'batch', label: 'Batch Edit' },
  { id: 'livery', label: 'Livery' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['id'];

export function ToolsTab() {
  const [sub, setSub] = useState<SubTab>('rename');

  return (
    <div>
      <SubTabBar tabs={SUB_TABS} active={sub} onChange={setSub} />
      {/* v1.19.67 — display:none so sub-tab state survives switching. */}
      <div style={{ display: sub === 'rename' ? 'block' : 'none' }}><RenamerTab /></div>
      <div style={{ display: sub === 'batch'  ? 'block' : 'none' }}><BatchEditTab /></div>
      <div style={{ display: sub === 'livery' ? 'block' : 'none' }}><LiveryTab /></div>
    </div>
  );
}

function SubTabBar<T extends string>({ tabs, active, onChange }: {
  tabs: readonly { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 2, marginBottom: 16, background: '#222222', borderRadius: 6, padding: 3 }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            flex: 1,
            padding: '8px 16px',
            background: active === t.id ? 'rgba(74, 143, 212, 0.15)' : 'transparent',
            border: active === t.id ? '1px solid rgba(74, 143, 212, 0.3)' : '1px solid transparent',
            borderRadius: 4,
            color: active === t.id ? '#e0e0e0' : '#aaaaaa',
            fontWeight: active === t.id ? 600 : 400,
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
