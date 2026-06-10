/**
 * Targets tab (v1.19.74 PREVIEW) — container for DMPI + JTAC sub-tabs.
 *
 * Fable IA review recommendation: DMPI and JTAC are both target-tool
 * surfaces. The existing MissionEditor.tsx code comment for JTAC's
 * placement says "lives next to DMPI because both are target tools."
 * This finishes the thought — they merge into one outer tab named
 * Targets, with DMPI / JTAC as sub-tabs.
 *
 * As a side benefit, the duplicate laser-code surface goes away:
 * Loadout's laser pane and JTAC's laser pane were two writers of
 * the same data; JTAC (inside Targets) wins, Loadout becomes the
 * read-only view.
 */

import { useState } from 'react';
import { DmpiTab } from './DmpiTab';
import { JtacSetupPanel } from './JtacSetupPanel';

const SUB_TABS = [
  { id: 'dmpi', label: 'DMPI' },
  { id: 'jtac', label: 'JTAC' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['id'];

export function TargetsTab() {
  const [sub, setSub] = useState<SubTab>('dmpi');
  return (
    <div>
      <SubTabBar tabs={SUB_TABS} active={sub} onChange={setSub} />
      <div style={{ display: sub === 'dmpi' ? 'block' : 'none' }}><DmpiTab /></div>
      <div style={{ display: sub === 'jtac' ? 'block' : 'none' }}><JtacSetupPanel /></div>
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
