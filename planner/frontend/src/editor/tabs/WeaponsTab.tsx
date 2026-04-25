/**
 * Weapons tab — combines Loadouts and Laser codes into one view.
 */

import { useState } from 'react';
import { LoadoutTab } from './LoadoutTab';
import { LaserTab } from './LaserTab';

const SUB_TABS = [
  { id: 'loadouts', label: 'Loadouts' },
  { id: 'laser', label: 'Laser Codes' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['id'];

export function WeaponsTab() {
  const [sub, setSub] = useState<SubTab>('loadouts');

  return (
    <div>
      <SubTabBar tabs={SUB_TABS} active={sub} onChange={setSub} />
      {sub === 'loadouts' && <LoadoutTab />}
      {sub === 'laser' && <LaserTab />}
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
