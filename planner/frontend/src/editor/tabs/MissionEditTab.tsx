/**
 * Mission Edit tab — combines Mission Options, Triggers, and Drawings.
 */

import { useState } from 'react';
import { BriefingTab } from './BriefingTab';
import { MissionOptionsTab } from './MissionOptionsTab';
import { TriggerTab } from './TriggerTab';
import { DrawingsTab } from './DrawingsTab';

const SUB_TABS = [
  { id: 'briefing', label: 'Briefing' },
  { id: 'options', label: 'Options' },
  { id: 'triggers', label: 'Triggers' },
  { id: 'drawings', label: 'Drawings' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['id'];

export function MissionEditTab() {
  const [sub, setSub] = useState<SubTab>('briefing');

  return (
    <div>
      <SubTabBar tabs={SUB_TABS} active={sub} onChange={setSub} />
      {sub === 'briefing' && <BriefingTab />}
      {sub === 'options' && <MissionOptionsTab />}
      {sub === 'triggers' && <TriggerTab />}
      {sub === 'drawings' && <DrawingsTab />}
    </div>
  );
}

function SubTabBar<T extends string>({ tabs, active, onChange }: {
  tabs: readonly { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 2, marginBottom: 16, background: '#0a1520', borderRadius: 6, padding: 3 }}>
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
            color: active === t.id ? '#ccdae8' : '#5a7a8a',
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
