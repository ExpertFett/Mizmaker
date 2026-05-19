/**
 * Mission Debug tab — analyzes the loaded mission for conflicts,
 * SOP deviations, and common issues.
 */

import { useState, useCallback, useMemo } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface DebugFix {
  /** Human-readable summary shown above the before/after table.
   *  ('Move 2 groups off TACAN 74X', 'Assign ICLS ch 7 to ...') */
  description: string;
  /** Pre-fix state, rendered as a key-value list. Shape varies per
   *  category — e.g. { channel: 74, band: "X" } for TACAN. */
  before: Record<string, unknown>;
  /** Post-fix state, same shape as before. */
  after: Record<string, unknown>;
  /** Edits to dispatch into the editStore queue when the user
   *  clicks Apply. Same shape as the /api/download unitEdits payload. */
  edits: Array<{ unitId?: number; groupId?: number; field: string; value: unknown }>;
}

interface DebugIssue {
  severity: 'error' | 'warning' | 'info';
  category: string;
  title: string;
  detail: string;
  groupName?: string;
  unitName?: string;
  /** Optional auto-fix descriptor. Present when the issue has a
   *  well-defined remediation (TACAN/ICLS deconflict, missing
   *  carrier beacon, etc.). Frontend renders a Fix button + a
   *  before/after preview when expanded. */
  fix?: DebugFix;
}

type FilterSeverity = 'all' | 'error' | 'warning' | 'info';
type FilterCategory = 'all' | string;

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const severityColors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  error: { bg: 'rgba(217, 80, 80, 0.08)', border: '#d9505040', text: '#d95050', icon: '\u26D4' },
  warning: { bg: 'rgba(210, 153, 34, 0.08)', border: '#d2992240', text: '#d29922', icon: '\u26A0' },
  info: { bg: 'rgba(74, 143, 212, 0.06)', border: '#4a8fd430', text: '#4a8fd4', icon: '\u2139' },
};

const cardStyle: React.CSSProperties = {
  borderRadius: 5, padding: '10px 14px', marginBottom: 6,
  fontSize: 12, display: 'flex', alignItems: 'flex-start', gap: 10,
};

const btnStyle: React.CSSProperties = {
  background: '#3a3a3a', border: '1px solid #3a3a3a', borderRadius: 4,
  color: '#4a8fd4', cursor: 'pointer', fontSize: 12, fontWeight: 600,
  padding: '5px 12px', fontFamily: 'inherit',
};

const btnActive: React.CSSProperties = {
  ...btnStyle,
  background: 'rgba(74, 143, 212, 0.15)', border: '1px solid rgba(74, 143, 212, 0.3)',
  color: '#e0e0e0',
};

const runBtnStyle: React.CSSProperties = {
  background: 'rgba(63, 185, 80, 0.15)', border: '1px solid rgba(63, 185, 80, 0.3)',
  borderRadius: 4, color: '#3fb950', fontSize: 14, padding: '10px 24px',
  cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
};

/** Renders one side of the fix preview's before/after pair. The fix
 *  payload's `before` and `after` are arbitrary dicts shaped per
 *  category (TACAN: {channel, band}; ICLS: {channel}; carrier-init:
 *  {tacan: "(none)"}, etc.) — render them as a labeled key-value
 *  list so the UI works without per-category branching. */
function FixSideTable({ label, data, accent }: {
  label: string;
  data: Record<string, unknown>;
  accent: string;
}) {
  const rows: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) {
      rows.push([k, v.map(String).join(', ')]);
    } else if (v != null && typeof v === 'object') {
      rows.push([k, JSON.stringify(v)]);
    } else {
      rows.push([k, String(v)]);
    }
  }
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
        color: accent, marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        background: '#0a1218',
        border: `1px solid ${accent}30`,
        borderRadius: 3,
        padding: '6px 10px',
        fontSize: 11,
        fontFamily: "'B612 Mono', monospace",
        color: '#cccccc',
      }}>
        {rows.length === 0 ? (
          <span style={{ color: '#555' }}>(empty)</span>
        ) : rows.map(([k, v]) => (
          <div key={k} style={{ padding: '1px 0', display: 'flex', gap: 8 }}>
            <span style={{ color: '#888', flexShrink: 0 }}>{k}:</span>
            <span style={{ color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {v}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function MissionDebugTab() {
  const sessionId = useMissionStore((s) => s.sessionId);
  const addEdit = useEditStore((s) => s.addEdit);

  const [issues, setIssues] = useState<DebugIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [error, setError] = useState('');
  const [severityFilter, setSeverityFilter] = useState<FilterSeverity>('all');
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>('all');
  // Which issue cards have their Fix preview expanded. Click
  // "Show Fix" → expand; click "Apply Fix" → dispatch + collapse.
  const [expandedFixes, setExpandedFixes] = useState<Set<number>>(new Set());
  // Indices of issues whose fix has been applied this session, so we
  // can show a confirmation tag and disable the button until re-run.
  const [appliedFixes, setAppliedFixes] = useState<Set<number>>(new Set());

  const toggleFixExpanded = useCallback((idx: number) => {
    setExpandedFixes((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const applyFix = useCallback((idx: number, fix: DebugFix) => {
    for (const e of fix.edits) {
      // Edits already match the unitEdits payload shape; pushed
      // straight into editStore so the next download writes them.
      addEdit(e as never);
    }
    setAppliedFixes((prev) => new Set(prev).add(idx));
    setExpandedFixes((prev) => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  }, [addEdit]);

  const fixableCount = useMemo(
    () => issues.filter((i) => i.fix).length,
    [issues],
  );

  const applyAllFixes = useCallback(() => {
    const newApplied = new Set(appliedFixes);
    issues.forEach((i, idx) => {
      if (!i.fix || newApplied.has(idx)) return;
      for (const e of i.fix.edits) addEdit(e as never);
      newApplied.add(idx);
    });
    setAppliedFixes(newApplied);
    setExpandedFixes(new Set());
  }, [issues, addEdit, appliedFixes]);

  const runDebug = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`/api/sessions/${sessionId}/debug`);
      const data = await resp.json();
      if (data.error) {
        setError(data.error);
      } else {
        setIssues(data.issues || []);
        // Re-run wipes the "applied" + expanded sets — the indices
        // referred to the previous issue list and may not match the
        // new one. User will see fixes as fresh.
        setAppliedFixes(new Set());
        setExpandedFixes(new Set());
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to run debug analysis');
    } finally {
      setLoading(false);
      setHasRun(true);
    }
  }, [sessionId]);

  // Categories found in results
  const categories = useMemo(() => {
    const cats = new Set(issues.map((i) => i.category));
    return Array.from(cats).sort();
  }, [issues]);

  // Filtered issues
  const filtered = useMemo(() => {
    return issues.filter((i) => {
      if (severityFilter !== 'all' && i.severity !== severityFilter) return false;
      if (categoryFilter !== 'all' && i.category !== categoryFilter) return false;
      return true;
    });
  }, [issues, severityFilter, categoryFilter]);

  // Counts by severity
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const i of issues) {
      if (i.severity in c) c[i.severity as keyof typeof c]++;
    }
    return c;
  }, [issues]);

  return (
    <div style={{ maxWidth: 850 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
          Mission Debug
        </h2>
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: '#aaaaaa' }}>
        Analyze the loaded mission for frequency conflicts, TACAN/ICLS duplicates, carrier/tanker/AWACS issues,
        client flight problems, and other common misconfigurations.
      </p>

      {/* Run button */}
      {!hasRun && (
        <div style={{ textAlign: 'center', padding: '30px 0' }}>
          <button
            onClick={runDebug}
            disabled={loading || !sessionId}
            style={{
              ...runBtnStyle,
              opacity: loading || !sessionId ? 0.5 : 1,
              cursor: loading || !sessionId ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Analyzing...' : !sessionId ? 'Load a mission first' : 'Run Debug Analysis'}
          </button>
        </div>
      )}

      {error && (
        <div style={{
          padding: '10px 14px', background: 'rgba(217, 80, 80, 0.1)',
          border: '1px solid rgba(217, 80, 80, 0.3)', borderRadius: 4,
          color: '#d95050', fontSize: 13, marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      {hasRun && !error && (
        <>
          {/* Summary bar */}
          <div style={{
            display: 'flex', gap: 12, marginBottom: 14, padding: '10px 14px',
            background: '#222222', borderRadius: 6, border: '1px solid #3a3a3a',
            alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', marginRight: 8 }}>
              Results: {issues.length} findings
            </span>
            <div style={{
              display: 'flex', gap: 4, padding: '3px 8px', borderRadius: 3,
              background: counts.error > 0 ? 'rgba(217, 80, 80, 0.15)' : 'rgba(63, 185, 80, 0.1)',
              color: counts.error > 0 ? '#d95050' : '#3fb950',
              fontSize: 12, fontWeight: 600,
            }}>
              {counts.error} error{counts.error !== 1 ? 's' : ''}
            </div>
            <div style={{
              display: 'flex', gap: 4, padding: '3px 8px', borderRadius: 3,
              background: counts.warning > 0 ? 'rgba(210, 153, 34, 0.1)' : 'rgba(90, 122, 138, 0.1)',
              color: counts.warning > 0 ? '#d29922' : '#aaaaaa',
              fontSize: 12, fontWeight: 600,
            }}>
              {counts.warning} warning{counts.warning !== 1 ? 's' : ''}
            </div>
            <div style={{
              padding: '3px 8px', borderRadius: 3,
              background: 'rgba(74, 143, 212, 0.08)', color: '#4a8fd4',
              fontSize: 12, fontWeight: 600,
            }}>
              {counts.info} info
            </div>

            <button
              onClick={runDebug}
              disabled={loading}
              style={{
                ...btnStyle, marginLeft: 'auto', fontSize: 11, padding: '4px 10px',
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? 'Running...' : 'Re-run'}
            </button>
            {fixableCount > 0 && (
              <button
                onClick={applyAllFixes}
                disabled={appliedFixes.size === fixableCount}
                title="Apply every available fix at once"
                style={{
                  background: 'rgba(63, 185, 80, 0.15)',
                  border: '1px solid rgba(63, 185, 80, 0.3)',
                  borderRadius: 4,
                  color: '#3fb950',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '4px 10px',
                  cursor: appliedFixes.size === fixableCount ? 'default' : 'pointer',
                  opacity: appliedFixes.size === fixableCount ? 0.4 : 1,
                  fontFamily: 'inherit',
                }}
              >
                {appliedFixes.size === fixableCount
                  ? `✓ ${fixableCount}/${fixableCount} applied`
                  : `Auto-Fix All (${fixableCount - appliedFixes.size})`}
              </button>
            )}
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#aaaaaa', marginRight: 4 }}>Severity:</span>
            {(['all', 'error', 'warning', 'info'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSeverityFilter(s)}
                style={severityFilter === s ? btnActive : btnStyle}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}

            <span style={{ fontSize: 11, color: '#aaaaaa', marginLeft: 12, marginRight: 4 }}>Category:</span>
            <button
              onClick={() => setCategoryFilter('all')}
              style={categoryFilter === 'all' ? btnActive : btnStyle}
            >
              All
            </button>
            {categories.filter((c) => c !== 'summary').map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                style={categoryFilter === cat ? btnActive : btnStyle}
              >
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>

          {/* Issue cards */}
          <div style={{ maxHeight: 500, overflow: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{
                padding: '20px', textAlign: 'center', color: '#3fb950', fontSize: 14,
                background: 'rgba(63, 185, 80, 0.06)', borderRadius: 6,
                border: '1px solid rgba(63, 185, 80, 0.2)',
              }}>
                {severityFilter === 'all' && categoryFilter === 'all'
                  ? 'No issues found — mission looks clean!'
                  : 'No matching issues for this filter.'}
              </div>
            ) : (
              filtered.map((issue) => {
                const style = severityColors[issue.severity] || severityColors.info;
                // Use the index in the unfiltered list as the stable
                // key for fix expansion / applied state — filtered
                // indices change when severity or category filters
                // toggle.
                const idx = issues.indexOf(issue);
                const fix = issue.fix;
                const isExpanded = expandedFixes.has(idx);
                const isApplied = appliedFixes.has(idx);
                return (
                  <div key={idx} style={{
                    ...cardStyle,
                    background: style.bg,
                    border: `1px solid ${style.border}`,
                    flexDirection: 'column',
                    alignItems: 'stretch',
                  }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1 }}>
                        {style.icon}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, color: style.text, fontSize: 13 }}>
                            {issue.title}
                          </span>
                          <span style={{
                            fontSize: 10, padding: '1px 6px', borderRadius: 3,
                            background: 'rgba(90, 122, 138, 0.15)', color: '#aaaaaa',
                          }}>
                            {issue.category}
                          </span>
                          {isApplied && (
                            <span style={{
                              fontSize: 10, padding: '1px 6px', borderRadius: 3,
                              background: 'rgba(63, 185, 80, 0.18)',
                              border: '1px solid rgba(63, 185, 80, 0.3)',
                              color: '#3fb950', fontWeight: 700, letterSpacing: 0.5,
                            }}>
                              ✓ FIX APPLIED — RE-RUN TO VERIFY
                            </span>
                          )}
                          {fix && !isApplied && (
                            <button
                              onClick={() => toggleFixExpanded(idx)}
                              style={{
                                marginLeft: 'auto',
                                background: 'rgba(63, 185, 80, 0.10)',
                                border: '1px solid rgba(63, 185, 80, 0.3)',
                                borderRadius: 3,
                                color: '#3fb950',
                                fontSize: 11, fontWeight: 600,
                                padding: '2px 10px',
                                cursor: 'pointer', fontFamily: 'inherit',
                              }}
                            >
                              {isExpanded ? '▲ Hide Fix' : '▼ Show Fix'}
                            </button>
                          )}
                        </div>
                        <div style={{ color: '#bbbbbb', fontSize: 12, lineHeight: 1.4 }}>
                          {issue.detail}
                        </div>
                        {(issue.groupName || issue.unitName) && (
                          <div style={{ marginTop: 3, fontSize: 11, color: '#4a4a4a' }}>
                            {issue.groupName && <span>Group: {issue.groupName}</span>}
                            {issue.groupName && issue.unitName && <span> | </span>}
                            {issue.unitName && <span>Unit: {issue.unitName}</span>}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Auto-fix preview — expanded view shows before/after
                        side-by-side with explicit Apply / Cancel actions.
                        Lives inside the issue card so the user can see it
                        in the context of the issue it solves. */}
                    {fix && isExpanded && (
                      <div style={{
                        marginTop: 10,
                        padding: '10px 12px',
                        background: 'rgba(0, 0, 0, 0.25)',
                        border: '1px solid rgba(63, 185, 80, 0.25)',
                        borderRadius: 4,
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#3fb950', marginBottom: 8 }}>
                          AUTO-FIX: {fix.description}
                        </div>
                        <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                          <FixSideTable label="BEFORE" data={fix.before} accent="#d95050" />
                          <div style={{
                            color: '#666', fontSize: 16, alignSelf: 'center',
                            padding: '0 4px',
                          }}>→</div>
                          <FixSideTable label="AFTER" data={fix.after} accent="#3fb950" />
                        </div>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => toggleFixExpanded(idx)}
                            style={{
                              background: 'transparent',
                              border: '1px solid #3a3a3a',
                              borderRadius: 3,
                              color: '#aaaaaa',
                              fontSize: 11,
                              padding: '4px 12px',
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => applyFix(idx, fix)}
                            style={{
                              background: 'rgba(63, 185, 80, 0.18)',
                              border: '1px solid rgba(63, 185, 80, 0.4)',
                              borderRadius: 3,
                              color: '#3fb950',
                              fontSize: 11, fontWeight: 600,
                              padding: '4px 14px',
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            Apply Fix → queue {fix.edits.length} edit{fix.edits.length !== 1 ? 's' : ''}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
