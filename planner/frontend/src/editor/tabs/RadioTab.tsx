/**
 * Radio tab — Comms + TACAN sub-tabs. ATIS used to live here too but
 * moved to Scripts in v1.19.58 (per tester ask). The duplicate ATIS
 * mount stayed behind by accident until v1.19.67 — removed because
 * having ATIS in both Radio and Scripts gave each instance its own
 * independent state, and a user editing in one wouldn't see the other.
 */

import { useState } from 'react';
import { CommCardTab } from './CommCardTab';
import { TacanTab } from './TacanTab';

const SUB_TABS = [
  { id: 'comms', label: 'Comms' },
  { id: 'tacan', label: 'TACAN' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['id'];

export function RadioTab() {
  const [sub, setSub] = useState<SubTab>('comms');

  return (
    <div>
      <SubTabBar tabs={SUB_TABS} active={sub} onChange={setSub} />
      {/* v1.19.67 — display:none keeps both sub-tabs mounted, so a user
          who half-fills CommCardTab and switches to TACAN doesn't lose
          their un-applied overrides on the way back. Same pattern as
          SopTabContainer + the top-level visitedTabs in MissionEditor. */}
      <div style={{ display: sub === 'comms' ? 'block' : 'none' }}><CommCardTab /></div>
      <div style={{ display: sub === 'tacan' ? 'block' : 'none' }}><TacanTab /></div>
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
