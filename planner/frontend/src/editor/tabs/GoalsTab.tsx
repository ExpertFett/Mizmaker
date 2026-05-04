/**
 * Mission Goals tab — squadron-style objective list.
 *
 * Mirrors what DCS ME's "Mission Goals" dialog shows: a flat list of
 * named objectives, each with a side and an optional point value.
 * For v1 these are session-only and surface in the brief generator
 * via {goals.blue} / {goals.red} / {goals.neutral} / {goals.all}
 * template tokens. Persistence into the .miz `goals` block + DCS
 * condition predicates is queued for a follow-up.
 */

import { useGoalsStore, type GoalSide } from '../../store/goalsStore';

const SIDE_COLORS: Record<GoalSide, string> = {
  blue: '#4a8fd4',
  red: '#d95050',
  neutral: '#aaaaaa',
  all: '#3fb950',
};

const SIDE_LABEL: Record<GoalSide, string> = {
  blue: 'BLUE',
  red: 'RED',
  neutral: 'NEUTRAL',
  all: 'ALL',
};

export function GoalsTab() {
  const goals = useGoalsStore((s) => s.goals);
  const add = useGoalsStore((s) => s.add);
  const update = useGoalsStore((s) => s.update);
  const remove = useGoalsStore((s) => s.remove);
  const move = useGoalsStore((s) => s.move);
  const clearAll = useGoalsStore((s) => s.clearAll);

  const totalsBySide = goals.reduce<Record<GoalSide, number>>(
    (acc, g) => {
      acc[g.side] = (acc[g.side] ?? 0) + 1;
      return acc;
    },
    { blue: 0, red: 0, neutral: 0, all: 0 },
  );

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
            Mission Goals & Objectives
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#aaaaaa' }}>
            Session-only objective list. Available in the Brief tab via{' '}
            <code style={{ color: '#cccccc' }}>{'{goals.blue}'}</code>{' / '}
            <code style={{ color: '#cccccc' }}>{'{goals.red}'}</code>{' / '}
            <code style={{ color: '#cccccc' }}>{'{goals.all}'}</code>{' '}
            template tokens. Not yet written into the .miz goals block.
          </p>
        </div>
        <button onClick={add} style={addBtn}>+ Add Goal</button>
      </div>

      {/* Summary strip */}
      {goals.length > 0 && (
        <div
          style={{
            display: 'flex', gap: 14, marginBottom: 14,
            padding: '8px 12px',
            background: '#0a1218', border: '1px solid #222', borderRadius: 6,
            fontSize: 12, alignItems: 'center',
          }}
        >
          <span style={{ color: '#e0e0e0', fontWeight: 600 }}>
            {goals.length} goal{goals.length !== 1 ? 's' : ''}
          </span>
          {(['blue', 'red', 'neutral', 'all'] as const).map((side) => (
            totalsBySide[side] ? (
              <span key={side} style={{ color: SIDE_COLORS[side], fontWeight: 600 }}>
                {SIDE_LABEL[side]}: {totalsBySide[side]}
              </span>
            ) : null
          ))}
          <button
            onClick={() => {
              if (confirm(`Clear all ${goals.length} goals? This cannot be undone.`)) {
                clearAll();
              }
            }}
            style={{
              marginLeft: 'auto',
              background: '#3a1a1a',
              border: '1px solid #5a2a2a',
              borderRadius: 4,
              color: '#d95050',
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Clear All
          </button>
        </div>
      )}

      {goals.length === 0 ? (
        <div style={{
          padding: '40px 20px', textAlign: 'center',
          background: 'rgba(74, 143, 212, 0.04)',
          border: '1px solid #4a4a4a', borderRadius: 6,
          color: '#aaaaaa', fontSize: 13,
        }}>
          No goals defined. Click "+ Add Goal" to create the squadron's
          mission objectives.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #3a3a3a' }}>
              <th style={{ ...thStyle, width: 36 }}>#</th>
              <th style={thStyle}>OBJECTIVE</th>
              <th style={{ ...thStyle, width: 110 }}>SIDE</th>
              <th style={{ ...thStyle, width: 70 }}>POINTS</th>
              <th style={thStyle}>NOTES</th>
              <th style={{ ...thStyle, width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {goals.map((g, i) => (
              <tr key={g.id} style={{ borderBottom: '1px solid #262626' }}>
                <td style={{ ...tdStyle, textAlign: 'center', color: SIDE_COLORS[g.side], fontWeight: 700 }}>
                  {i + 1}
                </td>
                <td style={tdStyle}>
                  <input
                    value={g.text}
                    onChange={(e) => update(g.id, { text: e.target.value })}
                    placeholder="e.g. Destroy SA-11 site at bullseye 035/22"
                    style={{ ...inputStyle, width: '95%', fontWeight: 500, color: '#e0e0e0' }}
                  />
                </td>
                <td style={tdStyle}>
                  <select
                    value={g.side}
                    onChange={(e) => update(g.id, { side: e.target.value as GoalSide })}
                    style={{ ...inputStyle, width: '95%', color: SIDE_COLORS[g.side], fontWeight: 600 }}
                  >
                    <option value="blue">BLUE</option>
                    <option value="red">RED</option>
                    <option value="neutral">NEUTRAL</option>
                    <option value="all">ALL</option>
                  </select>
                </td>
                <td style={tdStyle}>
                  <input
                    type="number"
                    value={g.points || ''}
                    onChange={(e) => update(g.id, { points: parseInt(e.target.value, 10) || 0 })}
                    placeholder="0"
                    style={{ ...inputStyle, width: '95%', fontFamily: "'B612 Mono', monospace" }}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    value={g.notes}
                    onChange={(e) => update(g.id, { notes: e.target.value })}
                    placeholder="Internal notes (not exported)"
                    style={{ ...inputStyle, width: '95%', color: '#888' }}
                  />
                </td>
                <td style={{ ...tdStyle, display: 'flex', gap: 4, paddingTop: 6 }}>
                  <button
                    onClick={() => move(g.id, 'up')}
                    disabled={i === 0}
                    title="Move up"
                    style={{ ...iconBtn, opacity: i === 0 ? 0.3 : 1 }}
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => move(g.id, 'down')}
                    disabled={i === goals.length - 1}
                    title="Move down"
                    style={{ ...iconBtn, opacity: i === goals.length - 1 ? 0.3 : 1 }}
                  >
                    ▼
                  </button>
                  <button
                    onClick={() => remove(g.id)}
                    title="Remove"
                    style={{ ...iconBtn, color: '#aaaaaa' }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  color: '#aaaaaa',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: '4px 6px',
  verticalAlign: 'top',
};

const inputStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  color: '#cccccc',
  fontSize: 12,
  padding: '3px 6px',
  fontFamily: 'inherit',
};

const addBtn: React.CSSProperties = {
  background: '#4a4a4a',
  border: '1px solid #4a8fd4',
  borderRadius: 4,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  padding: '6px 14px',
  fontFamily: 'inherit',
};

const iconBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  color: '#cccccc',
  cursor: 'pointer',
  fontSize: 11,
  padding: '2px 6px',
  fontFamily: 'inherit',
  minWidth: 22,
};
