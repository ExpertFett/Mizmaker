/**
 * Drag-to-reorder for the Radio Ladder card.
 *
 * The derived phase order (ground → tower → check-in → … → guard) is right
 * for most sorties, but a squadron's own flow differs — a carrier package
 * checks in before it ever talks to a tower. Rather than force the planner to
 * accept the derived order or hand-build the card, let them drag the rungs
 * and remember it.
 *
 * Uses native HTML5 drag events, no dependency. The list is short (a dozen
 * rungs at most) so a simple insert-before-target model is enough — no drop
 * indicators or animation.
 */

import { useState } from 'react';
import type { LadderRow } from '../../kneeboard/radioLadder';

interface Props {
  rows: LadderRow[];
  /** Current custom order (row ids). Empty = derived order. */
  order: string[];
  onChange: (order: string[]) => void;
}

export function RadioLadderOrderEditor({ rows, order, onChange }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 11, color: '#888888' }}>
        No ladder rungs yet — pick a flight with a departure field or load an SOP.
      </div>
    );
  }

  const move = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const ids = rows.map((r) => r.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onChange(ids);
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: '#888888', marginBottom: 5 }}>
        Drag to set the order rungs print in.
        {order.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            style={{
              marginLeft: 8, fontSize: 10, cursor: 'pointer', padding: '1px 6px',
              background: 'transparent', color: '#7aa7ff',
              border: '1px solid #3a3a3a', borderRadius: 2,
            }}
          >
            reset
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((r, i) => (
          <div
            key={r.id}
            draggable
            onDragStart={() => setDragId(r.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (dragId) move(dragId, r.id); }}
            style={{
              display: 'grid',
              gridTemplateColumns: '18px 74px 1fr auto',
              alignItems: 'center',
              gap: 6,
              padding: '3px 6px',
              fontSize: 11,
              cursor: 'grab',
              background: dragId === r.id ? '#2b3a52' : '#1e1e1e',
              border: '1px solid #333333',
              borderRadius: 2,
              opacity: dragId && dragId !== r.id ? 0.75 : 1,
            }}
          >
            <span style={{ color: '#7aa7ff', fontWeight: 600 }}>{i + 1}</span>
            <span style={{ color: '#888888' }}>{r.phase}</span>
            <span style={{ color: '#dddddd', overflow: 'hidden',
                           textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.agency}
            </span>
            <span style={{ color: '#7aa7ff', fontFamily: 'monospace' }}>
              {r.freqMhz.toFixed(3)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
