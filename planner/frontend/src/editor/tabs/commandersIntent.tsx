/**
 * Commander's Intent — guided three-part editor.
 *
 * The intent is the spine of a brief: it's the only section that says WHY the
 * package is flying. A generator can describe the enemy, the weather and the
 * package, but it cannot invent a commander's purpose — so OPT omits the slide
 * entirely when nobody writes one (see brief_builder._build_commanders_intent).
 *
 * That left a hole. This replaces the old free-text box with the standard
 * Purpose / Method / End State prompts, so writing an intent is three short
 * lines rather than a blank page. The prompts live in the UI as placeholders
 * and hints — they are NEVER part of the value, so an unfilled field
 * contributes nothing and the slide stays omitted.
 *
 * Storage stays a single `commanders_intent` string (unchanged wire format):
 *
 *     Purpose: ...
 *
 *     Method: ...
 *
 *     End State: ...
 *
 * Text that doesn't match those labels — an AI-written paragraph, or prose
 * pasted from a real brief — is preserved verbatim in the free-text field so
 * switching to this editor never destroys existing content.
 */

export interface IntentParts {
  purpose: string;
  method: string;
  endState: string;
  /** Anything that isn't one of the three labelled parts. */
  freeform: string;
}

const EMPTY: IntentParts = { purpose: '', method: '', endState: '', freeform: '' };

const LABELS: Array<[keyof IntentParts, RegExp]> = [
  ['purpose', /^\s*purpose\s*:/i],
  ['method', /^\s*method\s*:/i],
  ['endState', /^\s*end[\s-]*state\s*:/i],
];

/** Split a stored intent string into its three parts (plus any unlabelled
 *  remainder). Pure — safe to call on every render. */
export function parseIntent(text: string): IntentParts {
  if (!text || !text.trim()) return { ...EMPTY };
  const buf: Record<keyof IntentParts, string[]> = {
    purpose: [], method: [], endState: [], freeform: [],
  };
  let current: keyof IntentParts | null = null;
  for (const line of text.split('\n')) {
    const hit = LABELS.find(([, re]) => re.test(line));
    if (hit) {
      current = hit[0];
      buf[current].push(line.replace(hit[1], '').trim());
    } else if (current) {
      buf[current].push(line);
    } else {
      buf.freeform.push(line);
    }
  }
  return {
    purpose: buf.purpose.join('\n').trim(),
    method: buf.method.join('\n').trim(),
    endState: buf.endState.join('\n').trim(),
    freeform: buf.freeform.join('\n').trim(),
  };
}

/** Rebuild the stored string. Empty parts are omitted entirely — an intent
 *  with nothing written composes to "" so the brief drops the slide. */
export function composeIntent(p: IntentParts): string {
  const out: string[] = [];
  if (p.purpose.trim()) out.push(`Purpose: ${p.purpose.trim()}`);
  if (p.method.trim()) out.push(`Method: ${p.method.trim()}`);
  if (p.endState.trim()) out.push(`End State: ${p.endState.trim()}`);
  if (p.freeform.trim()) out.push(p.freeform.trim());
  return out.join('\n\n');
}

const areaStyle: React.CSSProperties = {
  width: '100%', background: '#1a1a1a', border: '1px solid #3a3a3a',
  borderRadius: 4, color: '#e0e0e0', fontSize: 13, padding: '6px 8px',
  fontFamily: 'inherit', outline: 'none', resize: 'vertical',
  boxSizing: 'border-box', lineHeight: 1.45,
};
const labelStyle: React.CSSProperties = {
  fontSize: 10, color: '#8aa0ba', textTransform: 'uppercase',
  letterSpacing: 0.6, fontWeight: 700, marginBottom: 2,
};
const hintStyle: React.CSSProperties = {
  fontSize: 10.5, color: '#888888', marginBottom: 4, lineHeight: 1.4,
};

function Field({ label, hint, placeholder, rows, value, onChange }: {
  label: string; hint: string; placeholder: string; rows: number;
  value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={hintStyle}>{hint}</div>
      <textarea
        style={areaStyle}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * Three-part intent editor. Stateless: parses the incoming string on each
 * render and composes a new one on every edit, so there's no local copy to
 * drift out of sync with the brief (and no setState-in-render).
 */
export function CommandersIntentEditor({ value, onChange }: {
  value: string;
  onChange: (next: string) => void;
}) {
  const parts = parseIntent(value || '');
  const upd = (k: keyof IntentParts, v: string) =>
    onChange(composeIntent({ ...parts, [k]: v }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Field
        label="Purpose"
        hint="Why this package is flying — the effect you want, not the tasking."
        placeholder="Deny the enemy the Kirkenes road for the next 24 hours."
        rows={2}
        value={parts.purpose}
        onChange={(v) => upd('purpose', v)}
      />
      <Field
        label="Method"
        hint="How it gets done — sequence, main effort, who enables whom."
        placeholder="Tomcats hold the outer intercept while the Hornets sweep ahead of the CAS stack."
        rows={3}
        value={parts.method}
        onChange={(v) => upd('method', v)}
      />
      <Field
        label="End State"
        hint="What is true when you land."
        placeholder="Advance stalled short of the town. No jets lost to the SA-10."
        rows={2}
        value={parts.endState}
        onChange={(v) => upd('endState', v)}
      />
      {parts.freeform.trim() !== '' && (
        <Field
          label="Additional"
          hint="Existing text that isn't one of the three parts — kept as written."
          placeholder=""
          rows={4}
          value={parts.freeform}
          onChange={(v) => upd('freeform', v)}
        />
      )}
    </div>
  );
}
