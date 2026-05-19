/**
 * Auto-Setup result modal.
 *
 * Renders the AutoSetupReport produced by runAutoSetup() — one row
 * per applier with check / skip status, then the SOP Check
 * discrepancy list at the bottom (the "still needs attention" view).
 *
 * Pure presentation — the orchestrator + edit dispatch happen in the
 * sidebar button before this opens. By the time the modal renders,
 * edits are already in the queue and the user just confirms what
 * landed + sees what they still need to touch manually.
 */

import { useMemo } from 'react';
import { Button } from '../components/Button';
import type { AutoSetupReport } from '../sop/autoSetup';

interface Props {
  report: AutoSetupReport;
  onClose: () => void;
  onOpenSopCheck: () => void;
}

export function AutoSetupModal({ report, onClose, onOpenSopCheck }: Props) {
  const counts = useMemo(() => {
    const c = { red: 0, yellow: 0, gray: 0 };
    for (const r of report.discrepancies) c[r.severity]++;
    return c;
  }, [report.discrepancies]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        // Stop click-propagation so clicking inside the modal body
        // doesn't dismiss it (only the backdrop does).
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#7a8a92',
          border: '1px solid #4a5258',
          borderRadius: 8,
          width: 720,
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: 24,
          boxShadow: '0 8px 40px rgba(0, 0, 0, 0.6)',
          color: '#1a1f25',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <span
              style={{
                padding: '3px 10px',
                background: '#1a3a1a',
                border: '1px solid #2a5a2a',
                color: '#3fb950',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 1,
                borderRadius: 4,
              }}
            >
              AUTO-SETUP
            </span>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              {report.sopName}
            </h2>
          </div>
          <div style={{ color: '#5a6268', fontSize: 13 }}>
            {report.totalEdits} edit{report.totalEdits !== 1 ? 's' : ''} queued
            {' · '}
            {report.totalItems} mission item{report.totalItems !== 1 ? 's' : ''} touched
          </div>
        </div>

        {/* Per-applier results */}
        <div style={{ marginBottom: 18 }}>
          {report.actions.map((a) => {
            const ran = a.itemsAffected > 0;
            const skipped = a.skippedReason != null;
            return (
              <div
                key={a.category}
                style={{
                  padding: '10px 14px',
                  marginBottom: 6,
                  borderLeft: `3px solid ${ran ? '#3fb950' : skipped ? '#4a5258' : '#d29922'}`,
                  background: '#6e7c83',
                  borderRadius: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      width: 18, height: 18, lineHeight: '18px', textAlign: 'center',
                      borderRadius: 9, fontSize: 11, fontWeight: 700,
                      background: ran ? '#1a3a1a' : '#6e7c83',
                      color: ran ? '#3fb950' : skipped ? '#5a6268' : '#3a4248',
                      flexShrink: 0,
                    }}
                  >
                    {ran ? '✓' : skipped ? '·' : ''}
                  </span>
                  <span style={{ fontWeight: 600, color: '#1a1f25' }}>{a.category}</span>
                  <span style={{ color: '#5a6268', fontSize: 13 }}>— {a.description}</span>
                </div>
                {a.skippedReason && (
                  <div style={{ color: '#5a6268', fontSize: 11, marginTop: 4, marginLeft: 28 }}>
                    {a.skippedReason}
                  </div>
                )}
                {a.details && a.details.length > 0 && (
                  <ul
                    style={{
                      margin: '4px 0 0 28px',
                      padding: 0,
                      listStyle: 'none',
                      fontSize: 11,
                      color: '#5a6268',
                    }}
                  >
                    {a.details.slice(0, 6).map((d, i) => (
                      <li key={i} style={{ padding: '1px 0' }}>{d}</li>
                    ))}
                    {a.details.length > 6 && (
                      <li style={{ padding: '1px 0', color: '#555', fontStyle: 'italic' }}>
                        …and {a.details.length - 6} more
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {/* Remaining issues — pulled from buildReport via SOP Check */}
        {report.discrepancies.length > 0 ? (
          <div
            style={{
              padding: '12px 14px',
              background: '#6e7c83',
              border: '1px solid #2a2a1a',
              borderLeft: '3px solid #d29922',
              borderRadius: 4,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#d29922' }}>
                ⚠ {report.discrepancies.length} item{report.discrepancies.length !== 1 ? 's' : ''} still need attention
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#3a4248' }}>
                {counts.red > 0 && (
                  <span style={{ color: '#d95050', marginRight: 8 }}>{counts.red} issue{counts.red !== 1 ? 's' : ''}</span>
                )}
                {counts.yellow > 0 && (
                  <span style={{ color: '#d29922', marginRight: 8 }}>{counts.yellow} warning{counts.yellow !== 1 ? 's' : ''}</span>
                )}
                {counts.gray > 0 && (
                  <span style={{ color: '#5a6268' }}>{counts.gray} info</span>
                )}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#5a6268', marginBottom: 10 }}>
              These are things the auto-pass couldn't address — usually because the
              SOP doesn't carry the data, the mission has details that need a
              human decision, or a fuzzy match wasn't safe to auto-apply.
            </div>
            <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, color: '#1a1f25' }}>
              {report.discrepancies.slice(0, 8).map((d, i) => (
                <li key={i} style={{ padding: '2px 0' }}>
                  <span style={{
                    display: 'inline-block', width: 36, fontSize: 9, fontWeight: 700,
                    color: d.severity === 'red' ? '#d95050'
                         : d.severity === 'yellow' ? '#d29922' : '#5a6268',
                  }}>
                    [{d.severity.toUpperCase()}]
                  </span>
                  <span style={{ color: '#1a1f25' }}>{d.category}</span>
                  <span style={{ color: '#5a6268' }}> — {d.field}</span>
                </li>
              ))}
              {report.discrepancies.length > 8 && (
                <li style={{ padding: '2px 0', color: '#5a6268', fontStyle: 'italic' }}>
                  …and {report.discrepancies.length - 8} more (open SOP Check)
                </li>
              )}
            </ul>
          </div>
        ) : (
          <div
            style={{
              padding: '12px 14px',
              background: '#6e7c83',
              border: '1px solid #1a3a1a',
              borderLeft: '3px solid #3fb950',
              borderRadius: 4,
              marginBottom: 16,
              color: '#3fb950',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            ✓ Mission fully matches SOP — nothing else needs manual attention.
          </div>
        )}

        {/* Footer actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {report.discrepancies.length > 0 && (
            <Button
              onClick={onOpenSopCheck}
              style={{ padding: '8px 16px' }}
            >
              Open SOP Check
            </Button>
          )}
          <Button
            variant="subtle"
            onClick={onClose}
            style={{ padding: '8px 16px' }}
          >
            Close
          </Button>
        </div>

        {/* Footnote */}
        <div style={{ marginTop: 14, fontSize: 11, color: '#555' }}>
          Edits queued for the next download. Open the Edits tab to review or
          remove individual entries before pressing Download.
        </div>
      </div>
    </div>
  );
}
