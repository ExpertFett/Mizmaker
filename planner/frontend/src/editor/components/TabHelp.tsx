import { useState, type ReactNode } from 'react';

/**
 * TabHelp — a compact, dismissible "how this works" banner for the top of a
 * tab. Keeps first-timers oriented without nagging power users: once dismissed
 * for a given `tabKey` it collapses to a small "ⓘ How this works" link that
 * re-expands on click. The dismissed state persists per tab in localStorage.
 * (v1.19.110 — one helper, reused across every tab so the intro copy is
 * consistent and easy to add.)
 */
export function TabHelp({ tabKey, children }: { tabKey: string; children: ReactNode }) {
  const lsKey = `dcsopt.tabHelp.dismissed.${tabKey}`;
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(lsKey) !== '1'; } catch { return true; }
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#5a8ab0', fontSize: 11.5, fontFamily: 'inherit',
          padding: '2px 0', marginBottom: 12,
        }}
      >
        <span style={{ fontWeight: 700 }}>ⓘ</span> How this works
      </button>
    );
  }

  const dismiss = () => {
    try { localStorage.setItem(lsKey, '1'); } catch { /* ignore */ }
    setOpen(false);
  };

  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      padding: '10px 12px', marginBottom: 14,
      background: 'rgba(74, 143, 212, 0.07)',
      border: '1px solid rgba(74, 143, 212, 0.22)',
      borderRadius: 6,
    }}>
      <span style={{ color: '#6ab4f0', fontWeight: 700, fontSize: 13, flexShrink: 0, whiteSpace: 'nowrap' }}>
        ⓘ How this works
      </span>
      <div style={{ flex: 1, fontSize: 12.5, color: '#c8d4e0', lineHeight: 1.5 }}>
        {children}
      </div>
      <button
        onClick={dismiss}
        title="Hide this (reopen it any time with the link)"
        style={{
          background: 'transparent', border: 'none', color: '#7a8a9a',
          fontSize: 16, cursor: 'pointer', flexShrink: 0, lineHeight: 1, padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
