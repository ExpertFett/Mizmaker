/**
 * SOP Check tab — read-only discrepancy report comparing the loaded
 * mission against the active SOP.
 *
 * v1 is read-only: every row tells the pilot what the mission has,
 * what the SOP says, and a severity tag. v2 (next release) will add
 * per-row "Apply SOP" buttons that dispatch the right edits — we held
 * off until the heuristics here are validated on a real mission, since
 * a bad fuzzy-match plus auto-apply could quietly stomp values that
 * were intentionally different.
 *
 * The comparison engine itself (buildReport + per-category checks)
 * lives in src/sop/discrepancy.ts so it can be unit-tested without
 * mounting React. This file is just the UI layer over it.
 */

import { useMemo } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useSopStore } from '../../sop/sopStore';
import { buildReport, type DiscrepancyRow, type Severity } from '../../sop/discrepancy';

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */

function severityChip(sev: Severity): React.CSSProperties {
  const palette: Record<Severity, { bg: string; border: string; fg: string }> = {
    red: { bg: '#3a1a1a', border: '#5a2a2a', fg: '#d95050' },
    yellow: { bg: '#3a2e1a', border: '#5a4a2a', fg: '#d29922' },
    gray: { bg: '#1a1a1a', border: '#3a3a3a', fg: '#888' },
  };
  const c = palette[sev];
  return {
    padding: '2px 8px',
    borderRadius: 4,
    background: c.bg,
    border: `1px solid ${c.border}`,
    color: c.fg,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flexShrink: 0,
  };
}

const severityLabel: Record<Severity, string> = {
  red: 'Issue',
  yellow: 'Warn',
  gray: 'Info',
};

export function SopCheckTab() {
  const groups = useMissionStore((s) => s.groups);
  const sops = useSopStore((s) => s.sops);
  const activeSopId = useSopStore((s) => s.activeId);
  const activeSop = useMemo(
    () => (activeSopId ? sops.find((s) => s.id === activeSopId) ?? null : null),
    [activeSopId, sops],
  );

  const rows = useMemo(() => {
    if (!activeSop) return [];
    return buildReport(groups, activeSop);
  }, [groups, activeSop]);

  // Group rows by category for visual scanning. JS Map preserves insert
  // order so the report sections come out in checkPlayerFlightFreqs →
  // checkLaserCodes order.
  const byCategory = useMemo(() => {
    const m = new Map<string, DiscrepancyRow[]>();
    for (const r of rows) {
      if (!m.has(r.category)) m.set(r.category, []);
      m.get(r.category)!.push(r);
    }
    return m;
  }, [rows]);

  const counts = useMemo(() => {
    const c = { red: 0, yellow: 0, gray: 0 };
    for (const r of rows) c[r.severity]++;
    return c;
  }, [rows]);

  if (!activeSop) {
    return (
      <div style={{ color: '#aaaaaa', fontSize: 14, padding: 24, maxWidth: 600 }}>
        <h2 style={{ color: '#e0e0e0', fontSize: 18, margin: '0 0 12px', fontWeight: 600 }}>
          SOP Check
        </h2>
        <p>
          Activate a SOP on the SOP tab first. This panel reports where the loaded
          mission disagrees with the active SOP — flight frequencies, tanker
          TACANs, carrier channels, and so on.
        </p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div style={{ color: '#aaaaaa', fontSize: 14, padding: 24 }}>
        Load a mission to compare against SOP "{activeSop.name}".
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, padding: '0 4px' }}>
      <h2 style={{ color: '#e0e0e0', fontSize: 18, margin: '0 0 10px', fontWeight: 600 }}>
        SOP Check
      </h2>

      {/* Active-SOP banner — green accent strip with the SOP name in
          large readable text, the squadron underneath if defined. The
          point of this tab is to compare against this SOP, so making
          which one is active visible at a glance matters. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '10px 14px',
          marginBottom: 14,
          background: '#0d2818',
          border: '1px solid #2a5a2a',
          borderLeft: '4px solid #3fb950',
          borderRadius: 6,
        }}
      >
        <span
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            background: '#1a3a1a',
            border: '1px solid #2a5a2a',
            color: '#3fb950',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 1,
            flexShrink: 0,
          }}
        >
          SOP ACTIVE
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: '#e0e0e0',
              fontSize: 16,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {activeSop.name}
          </div>
          {activeSop.squadron && (
            <div style={{ color: '#888', fontSize: 12, marginTop: 1 }}>
              {activeSop.squadron}
            </div>
          )}
        </div>
        <div style={{ color: '#5a8a6a', fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>
          {activeSop.flights?.length ?? 0} flights · {activeSop.comms?.length ?? 0} comms · {activeSop.tankers?.length ?? 0} tankers
        </div>
      </div>

      <p style={{ color: '#888', fontSize: 12, margin: '0 0 14px', maxWidth: 720 }}>
        Read-only report. Compares the loaded mission against the active SOP and
        flags differences. Apply-on-click is coming in the next release; for now
        the matching tabs (Radio, Datalink, Carriers, DTC, Renamer) carry the
        write-back buttons.
      </p>

      {/* Summary strip */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 16,
          padding: '8px 12px',
          background: '#0a1218',
          border: '1px solid #222',
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        <SummaryChip label="Issues" count={counts.red} color="#d95050" />
        <SummaryChip label="Warnings" count={counts.yellow} color="#d29922" />
        <SummaryChip label="Info" count={counts.gray} color="#888" />
        <span style={{ marginLeft: 'auto', color: '#888' }}>
          {rows.length === 0 ? 'No discrepancies — mission matches SOP.' :
            `${rows.length} row${rows.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Sections */}
      {rows.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            color: '#3fb950',
            background: '#0a1218',
            border: '1px solid #1a3a1a',
            borderRadius: 6,
          }}
        >
          ✓ Mission is consistent with SOP "{activeSop.name}". No discrepancies found.
        </div>
      ) : (
        Array.from(byCategory.entries()).map(([cat, catRows]) => (
          <div key={cat} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#5a8a6a',
                textTransform: 'uppercase',
                letterSpacing: 1,
                marginBottom: 6,
              }}
            >
              {cat} ({catRows.length})
            </div>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
                color: '#e0e0e0',
                background: '#1a1a1a',
                border: '1px solid #3a3a3a',
                borderRadius: 4,
              }}
            >
              <thead>
                <tr style={{ background: '#222', color: '#aaaaaa' }}>
                  <th style={thStyle}>Field</th>
                  <th style={thStyle}>Mission has</th>
                  <th style={thStyle}>SOP says</th>
                  <th style={{ ...thStyle, width: 70, textAlign: 'center' }}>Severity</th>
                </tr>
              </thead>
              <tbody>
                {catRows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #2a2a2a' }}>
                    <td style={tdStyle}>
                      <div style={{ color: '#cccccc', fontWeight: 600 }}>{r.field}</div>
                      {r.reason && (
                        <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>{r.reason}</div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", color: '#e0e0e0' }}>
                      {r.missionValue}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", color: '#3fb950' }}>
                      {r.sopValue}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <span style={severityChip(r.severity)}>{severityLabel[r.severity]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}

function SummaryChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#aaaaaa' }}>
      <span style={{ color, fontWeight: 700, fontSize: 14 }}>{count}</span>
      {label}
    </span>
  );
}

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 12,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  verticalAlign: 'top',
};
