/**
 * Brevity quick-reference for the controller scope (Phase 6).
 *
 * Compact lookup of the most-used GCI / fighter brevity, grouped by
 * function. Not a full Multi-Service Brevity Words manual — those are
 * 200+ entries. This is the subset DMs actually say on the radio: the
 * picture-call, status, status-of-fight, and engagement directive words
 * that come up in every mission.
 *
 * Searchable + collapsible-by-section so a DM can keep it open in a
 * corner of the scope without it dominating the screen.
 */

import { useMemo, useState } from 'react';

const C = {
  bg: 'rgba(13,19,29,0.96)',
  border: '#243349',
  accent: '#4a9eff',
  accentDim: 'rgba(74,158,255,0.18)',
  text: '#dce6f2',
  textDim: '#8aa0ba',
  amber: '#ffd24a',
};

interface Entry { word: string; def: string }
interface Section { title: string; entries: Entry[] }

// Curated subset — bias toward what a DM actually needs in the heat of
// a CAP / strike. Source: NATO ATP-1 Vol II + USN Brevity Words 2024.
const SECTIONS: Section[] = [
  { title: 'Picture / Track Calls', entries: [
    { word: 'PICTURE', def: 'Request for / report of the current air picture.' },
    { word: 'SINGLE', def: 'One contact.' },
    { word: 'GROUP', def: 'Two or more aircraft within 3 NM of each other.' },
    { word: 'PACKAGE', def: 'Coordinated multi-flight tasking under a single commander.' },
    { word: 'BULLSEYE', def: 'Bearing / range from the agreed reference point.' },
    { word: 'BRAA', def: 'Bearing / Range / Altitude / Aspect from own ship.' },
    { word: 'HOT', def: 'Target is HEAD-ON or aspect < 30°.' },
    { word: 'FLANK', def: 'Aspect 30°–60° (one side of the merge cone).' },
    { word: 'BEAM', def: 'Aspect 60°–120° (perpendicular).' },
    { word: 'COLD', def: 'Tail aspect, > 120°.' },
    { word: 'POP-UP', def: 'New contact appearing on radar (no prior sort).' },
    { word: 'DROP', def: 'Lost contact / track no longer held.' },
  ] },
  { title: 'Status / Fuel', entries: [
    { word: 'JOKER', def: 'Fuel state requiring withdrawal from combat to RTB with reserves.' },
    { word: 'BINGO', def: 'Fuel state mandating immediate RTB.' },
    { word: 'STATE', def: 'Request / report of remaining fuel + weapons.' },
    { word: 'WINCHESTER', def: 'Out of ordnance (any) — no longer offensive capable.' },
    { word: 'BRUISER', def: 'Friendly fighter-launched anti-ship missile in the air.' },
    { word: 'FOX 1', def: 'Friendly semi-active missile (e.g. AIM-7) in flight.' },
    { word: 'FOX 2', def: 'Friendly IR missile (AIM-9) in flight.' },
    { word: 'FOX 3', def: 'Friendly active radar missile (AIM-120) in flight.' },
    { word: 'RIFLE', def: 'Friendly AGM (A2G) launch announced.' },
    { word: 'MAGNUM', def: 'Friendly HARM / anti-radiation launch announced.' },
  ] },
  { title: 'Engagement / Tactics', entries: [
    { word: 'COMMIT', def: 'Engage / proceed offensively.' },
    { word: 'PUSH', def: 'Begin coordinated offensive move; mash freq advance.' },
    { word: 'POSIT', def: 'Request / report current position.' },
    { word: 'BOGEY', def: 'Radar / visual contact, UNKNOWN identity.' },
    { word: 'BANDIT', def: 'Contact identified HOSTILE (cleared to engage).' },
    { word: 'HOSTILE', def: 'Confirmed enemy by ID rules.' },
    { word: 'FRIENDLY', def: 'Confirmed friendly.' },
    { word: 'TALLY', def: 'Visual on the target / threat.' },
    { word: 'VISUAL', def: 'Sight of a FRIENDLY aircraft.' },
    { word: 'NO JOY', def: 'No visual contact on threat or friendly.' },
    { word: 'PADLOCKED', def: 'Cannot break visual lock on a target.' },
    { word: 'JUDY', def: 'Intercepting fighter has the target and will run own intercept.' },
    { word: 'CLEARED HOT', def: 'Authorisation to deliver weapon on target.' },
    { word: 'ABORT', def: 'Cease attack run / break engagement.' },
    { word: 'BREAK [L/R/U/D]', def: 'Immediate maximum-G turn in direction.' },
    { word: 'CHECK [L/R] [N]', def: 'Heading correction by N degrees.' },
    { word: 'VECTOR', def: 'Steer commanded heading.' },
    { word: 'PUSHING', def: 'Switching to assigned freq now.' },
  ] },
  { title: 'CAS / Air-to-Ground', entries: [
    { word: 'CONTACT [LOC]', def: 'Sight of object / location.' },
    { word: 'IN-DRY', def: 'In on a target run for dry pass / no release.' },
    { word: 'IN-HOT', def: 'In on a target run, will release.' },
    { word: 'OFF [DIR]', def: 'Pulling off target in commanded direction.' },
    { word: 'SHACK', def: 'Direct hit (bomb / rocket on target).' },
    { word: 'SPLASH', def: 'Target destroyed (air or ground).' },
    { word: 'TOT', def: 'Time on / over target.' },
    { word: 'TOT WINDOW', def: 'Allowed window for the strike to be over target.' },
    { word: 'SPOTTER', def: 'JTAC / FAC marking a target.' },
    { word: 'KILL BOX', def: 'Geographic area where attacks are authorised.' },
    { word: '9-LINE', def: 'Standardised CAS target brief from JTAC.' },
    { word: 'TYPE 1 / 2 / 3', def: 'CAS control types — visual / talk-on / coords-only.' },
    { word: 'DANGER CLOSE', def: 'Target within risk distance of friendlies — requires approval.' },
  ] },
];

export function BrevityCard({ onClose }: { onClose?: () => void }) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.map((s) => ({
      ...s,
      entries: s.entries.filter((e) =>
        e.word.toLowerCase().includes(q) || e.def.toLowerCase().includes(q)),
    })).filter((s) => s.entries.length > 0);
  }, [search]);

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: C.accentDim, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.text }}>
        <span>📖 BREVITY</span>
        {onClose && <span onClick={onClose} style={{ cursor: 'pointer', color: C.textDim, fontWeight: 400 }}>×</span>}
      </div>
      <div style={{ padding: '7px 10px', borderBottom: `1px solid ${C.border}` }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search word or definition…"
               style={{ width: '100%', background: 'rgba(0,0,0,0.35)', border: `1px solid ${C.border}`, color: C.text, padding: '4px 7px', fontSize: 11, borderRadius: 3, outline: 'none', fontFamily: 'inherit' }} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0', maxHeight: 380 }}>
        {filtered.map((s) => {
          const isCollapsed = collapsed.has(s.title);
          return (
            <div key={s.title} style={{ borderBottom: `1px solid ${C.border}` }}>
              <div onClick={() => setCollapsed((p) => { const n = new Set(p); n.has(s.title) ? n.delete(s.title) : n.add(s.title); return n; })}
                   style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', cursor: 'pointer', background: 'rgba(255,255,255,0.02)', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: C.amber }}>
                <span>{s.title}</span>
                <span style={{ color: C.textDim }}>{isCollapsed ? '▸' : '▾'}</span>
              </div>
              {!isCollapsed && s.entries.map((e) => (
                <div key={e.word} style={{ padding: '3px 10px', display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11, color: C.text }}>
                  <span style={{ minWidth: 84, fontWeight: 700, color: C.amber, fontFamily: 'ui-monospace, monospace' }}>{e.word}</span>
                  <span style={{ flex: 1, color: C.textDim, lineHeight: 1.4 }}>{e.def}</span>
                </div>
              ))}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ padding: 14, textAlign: 'center', color: C.textDim, fontSize: 11 }}>No matches.</div>
        )}
      </div>
    </div>
  );
}
