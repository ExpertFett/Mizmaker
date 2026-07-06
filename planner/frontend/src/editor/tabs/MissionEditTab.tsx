/**
 * Mission tab — briefing text, mission options, commanders, drawings.
 *
 * Triggers used to live here as a sub-tab; promoted to its own
 * top-level tab in the v0.7.x reorg because it sits AFTER Carriers
 * and Scripts in workflow (those panels auto-append trigger rules).
 */

import { useState } from 'react';
import { BriefingTab } from './BriefingTab';
import { BattlefieldCommandersTab } from './BattlefieldCommandersTab';

// Sub-tab order follows mission-setup workflow. (v1.19.110 — Options and
// Drawings removed: the forced-options editor was dropped and its
// strip-required-modules toggle moved to the Download panel; Drawings is
// superseded by DTC map annotations.)
const SUB_TABS = [
  { id: 'briefing', label: 'Briefing' },
  { id: 'commanders', label: 'Commanders' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['id'];

export function MissionEditTab() {
  const [sub, setSub] = useState<SubTab>('briefing');

  return (
    <div>
      <SubTabBar tabs={SUB_TABS} active={sub} onChange={setSub} />
      {/* v1.19.67 — display:none so sub-tab state survives switching. */}
      <div style={{ display: sub === 'briefing'   ? 'block' : 'none' }}><BriefingTab /></div>
      <div style={{ display: sub === 'commanders' ? 'block' : 'none' }}><BattlefieldCommandersTab /></div>
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
