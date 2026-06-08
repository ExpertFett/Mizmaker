/**
 * Scripts — top-level tab combining AEGIS / TIC / JTAC auto-setup.
 *
 * These three "auto-setup" features were previously buried 3 layers
 * deep (Tools → Rename → AEGIS / TIC / JTAC collapsibles). They share
 * a common pattern (rename groups + dispatch edits to set up a Lua
 * scripting framework's expected naming/state) so a unified top-level
 * tab makes more sense than per-feature collapsibles in the renamer.
 */

import { useState } from 'react';
import { JtacSetupPanel } from './JtacSetupPanel';
import { TicSetupPanel } from './TicSetupPanel';
import { AegisSetupPanel } from './AegisSetupPanel';
import { CarrierSetupPanel } from './CarrierSetupPanel';

// v1.19.54 — Carriers moved here from its own top-level tab. It belongs
// alongside AEGIS / TIC / JTAC: all four are "auto-setup the mission for
// a scripting framework" panels that emit groupRename edits + a chunk
// of generated Lua to bundle into the .miz triggers.
const SUB_TABS = [
  { id: 'carriers', label: 'Carriers',    color: '#4a9eff' },
  { id: 'aegis',    label: 'AEGIS IADS',  color: '#d95050' },
  { id: 'tic',      label: 'TIC',         color: '#d29922' },
  { id: 'jtac',     label: 'JTAC',        color: '#3fb950' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['id'];

export function ScriptsTab() {
  const [sub, setSub] = useState<SubTab>('carriers');

  return (
    <div>
      <div style={{
        marginBottom: 12,
      }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
          Mission Scripts — Auto-Setup
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#aaaaaa' }}>
          One-click renamers + edit dispatchers that prepare a mission for
          AEGIS IADS, TIC ground combat, or JTAC laser-designator scripts.
          Each script's framework lua is auto-bundled on download.
        </p>
      </div>

      <div style={{
        display: 'flex', gap: 2, marginBottom: 16,
        background: '#222222', borderRadius: 6, padding: 3,
      }}>
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            style={{
              flex: 1,
              padding: '8px 16px',
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

      {sub === 'carriers' && <CarrierSetupPanel />}
      {sub === 'aegis'    && <AegisSetupPanel />}
      {sub === 'tic'      && <TicSetupPanel />}
      {sub === 'jtac'     && <JtacSetupPanel />}
    </div>
  );
}
