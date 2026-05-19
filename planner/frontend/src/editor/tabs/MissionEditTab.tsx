/**
 * Mission tab — briefing text, mission options, commanders, drawings.
 *
 * Triggers used to live here as a sub-tab; promoted to its own
 * top-level tab in the v0.7.x reorg because it sits AFTER Carriers
 * and Scripts in workflow (those panels auto-append trigger rules).
 */

import { useState } from 'react';
import { BriefingTab } from './BriefingTab';
import { MissionOptionsTab } from './MissionOptionsTab';
import { DrawingsTab } from './DrawingsTab';
import { BattlefieldCommandersTab } from './BattlefieldCommandersTab';

// Sub-tab order follows mission-setup workflow:
//   Briefing   → set the story / sortie title first
//   Options    → forcedOptions (Easy Flight, labels, etc.)
//   Commanders → battlefield commander assignments
//   Drawings   → map markers / shapes (visual polish)
const SUB_TABS = [
  { id: 'briefing', label: 'Briefing' },
  { id: 'options', label: 'Options' },
  { id: 'commanders', label: 'Commanders' },
  { id: 'drawings', label: 'Drawings' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['id'];

export function MissionEditTab() {
  const [sub, setSub] = useState<SubTab>('briefing');

  return (
    <div>
      <SubTabBar tabs={SUB_TABS} active={sub} onChange={setSub} />
      {sub === 'briefing' && <BriefingTab />}
      {sub === 'commanders' && <BattlefieldCommandersTab />}
      {sub === 'options' && <MissionOptionsTab />}
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
    <div style={{ display: 'flex', gap: 2, marginBottom: 16, background: '#8c9ba2', borderRadius: 6, padding: 3 }}>
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
            color: active === t.id ? '#1a1f25' : '#3a4248',
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
