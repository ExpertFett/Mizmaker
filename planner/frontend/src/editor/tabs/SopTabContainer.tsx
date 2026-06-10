/**
 * SOP container — wraps the SOP editor (SopTab) + the SOP discrepancy
 * report (SopCheckTab) in a sub-tab toggle so they live under a single
 * sidebar entry.
 *
 * v1.19.57 — Fett moved SOP Check out of the top-level sidebar (where
 * it was a sibling of SOP) and made it a sub-tab here. The reasoning:
 * checking-against-SOP is a SOP-tab activity, not its own concern. One
 * less tab in the sidebar; clearer mental model.
 *
 * Sub-tabs:
 *   • Edit   — manage saved SOPs (library + import + sample SOPs)
 *   • Check  — read-only discrepancy report + Apply-from-SOP button
 */

import { useState } from 'react';
import { SopTab } from './SopTab';
import { SopCheckTab } from './SopCheckTab';
import { CommPlanTab } from './CommPlanTab';

const SUB_TABS = [
  { id: 'edit',  label: 'SOPs',      color: '#9cd0ff' },
  // v1.19.77 — wing comm plan: net catalog + per-airframe preset
  // button maps. The "one more SOP page" for radio architecture.
  { id: 'comms', label: 'Comm Plan', color: '#d29922' },
  { id: 'check', label: 'Check',     color: '#3fb950' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['id'];

export function SopTabContainer() {
  const [sub, setSub] = useState<SubTab>('edit');
  return (
    <div>
      <div style={{
        display: 'flex', gap: 2, marginBottom: 14,
        background: '#222222', borderRadius: 6, padding: 3,
        maxWidth: 320,
      }}>
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            style={{
              flex: 1,
              padding: '7px 16px',
              background: sub === t.id ? `${t.color}22` : 'transparent',
              border: sub === t.id ? `1px solid ${t.color}55` : '1px solid transparent',
              borderRadius: 4,
              color: sub === t.id ? t.color : '#aaaaaa',
              fontWeight: sub === t.id ? 700 : 400,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: 0.5,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* visitedTabs-style render so sub-tab edits survive switching.
          Both are mounted; just toggle visibility. SopTab in particular
          carries form state we don't want to lose on switch. */}
      <div style={{ display: sub === 'edit'  ? 'block' : 'none' }}><SopTab /></div>
      <div style={{ display: sub === 'comms' ? 'block' : 'none' }}><CommPlanTab /></div>
      <div style={{ display: sub === 'check' ? 'block' : 'none' }}><SopCheckTab /></div>
    </div>
  );
}
