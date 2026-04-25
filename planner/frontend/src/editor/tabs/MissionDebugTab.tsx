/**
 * Mission Debug tab — analyzes the loaded mission for conflicts,
 * SOP deviations, and common issues.
 */

import { useState, useCallback, useMemo } from 'react';
import { useMissionStore } from '../../store/missionStore';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface DebugIssue {
  severity: 'error' | 'warning' | 'info';
  category: string;
  title: string;
  detail: string;
  groupName?: string;
  unitName?: string;
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

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function MissionDebugTab() {
  const sessionId = useMissionStore((s) => s.sessionId);

  const [issues, setIssues] = useState<DebugIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [error, setError] = useState('');
  const [severityFilter, setSeverityFilter] = useState<FilterSeverity>('all');
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>('all');

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
              filtered.map((issue, idx) => {
                const style = severityColors[issue.severity] || severityColors.info;
                return (
                  <div key={idx} style={{
                    ...cardStyle,
                    background: style.bg,
                    border: `1px solid ${style.border}`,
                  }}>
                    <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1 }}>
                      {style.icon}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontWeight: 600, color: style.text, fontSize: 13 }}>
                          {issue.title}
                        </span>
                        <span style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 3,
                          background: 'rgba(90, 122, 138, 0.15)', color: '#aaaaaa',
                        }}>
                          {issue.category}
                        </span>
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
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
