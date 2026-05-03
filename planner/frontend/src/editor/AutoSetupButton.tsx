/**
 * Auto-Setup sidebar button — runs the orchestrator, dispatches every
 * edit it produces, and shows the result modal.
 *
 * Disabled state: no SOP active, or no mission loaded. Tooltip
 * explains either case so the button doesn't just look broken.
 */

import { useState, useCallback, useMemo } from 'react';
import { useMissionStore } from '../store/missionStore';
import { useEditStore } from '../store/editStore';
import { useSopStore } from '../sop/sopStore';
import { runAutoSetup, type AutoSetupReport } from '../sop/autoSetup';
import { AutoSetupModal } from './AutoSetupModal';

interface Props {
  /** Tab id to switch to when the user clicks "Open SOP Check" in the modal. */
  onNavigate: (tabId: string) => void;
  collapsed: boolean;
}

export function AutoSetupButton({ onNavigate, collapsed }: Props) {
  const groups = useMissionStore((s) => s.groups);
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const sops = useSopStore((s) => s.sops);
  const activeSopId = useSopStore((s) => s.activeId);
  const activeSop = useMemo(
    () => (activeSopId ? sops.find((s) => s.id === activeSopId) ?? null : null),
    [activeSopId, sops],
  );
  const addEdit = useEditStore((s) => s.addEdit);

  const [report, setReport] = useState<AutoSetupReport | null>(null);

  const disabled = !activeSop || groups.length === 0;
  const tooltip = !activeSop
    ? 'Activate a SOP first (SOP tab)'
    : groups.length === 0
    ? 'Load a mission first'
    : `Run Auto-Setup using "${activeSop.name}"`;

  const handleClick = useCallback(() => {
    if (!activeSop || groups.length === 0) return;
    const r = runAutoSetup(groups, clientUnits, activeSop);
    // Push every produced edit into the queue. The user can review in
    // Edits tab and remove individual entries before download.
    for (const action of r.actions) {
      for (const e of action.edits) addEdit(e);
    }
    setReport(r);
  }, [activeSop, groups, clientUnits, addEdit]);

  return (
    <>
      <button
        onClick={handleClick}
        disabled={disabled}
        title={tooltip}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: collapsed ? 0 : 8,
          width: collapsed ? '100%' : 'calc(100% - 16px)',
          margin: collapsed ? '6px 0' : '8px 8px',
          padding: collapsed ? '8px 0' : '10px 14px',
          background: disabled ? '#1a1a1a' : '#0d2818',
          border: `1px solid ${disabled ? '#3a3a3a' : '#2a5a2a'}`,
          borderLeft: `3px solid ${disabled ? '#3a3a3a' : '#3fb950'}`,
          borderRadius: 4,
          color: disabled ? '#555' : '#3fb950',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.5,
          fontFamily: 'inherit',
          textAlign: 'left',
          opacity: disabled ? 0.6 : 1,
          transition: 'background 0.1s',
        }}
      >
        <span style={{ fontSize: 14 }}>⚡</span>
        {!collapsed && <span>AUTO-SETUP</span>}
      </button>

      {report && (
        <AutoSetupModal
          report={report}
          onClose={() => setReport(null)}
          onOpenSopCheck={() => {
            setReport(null);
            onNavigate('sopCheck');
          }}
        />
      )}
    </>
  );
}
