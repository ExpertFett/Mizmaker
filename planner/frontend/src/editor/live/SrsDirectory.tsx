/**
 * SRS Directory — Phase 2 of the LotATC-style controller scope.
 *
 * SRS (Simple Radio Standalone) is a native Windows audio driver — there's
 * no browser voice client we can ship. What we CAN do for the controller
 * (DM) is hand them a clean lookup table of every flight's radio frequency
 * so they don't have to dig through .miz files mid-mission.
 *
 * Data sources, in order of preference per entry:
 *   1. ClientUnit.radioPresets[0].channels[0].freq_mhz / .modulation
 *      — player preset 1 channel 1 overrides whatever the group had in the
 *        .miz, so this is what's actually selected in-cockpit.
 *   2. MissionGroup.frequency / .modulation (MHz)
 *      — the group's default radio (used by AI flights / unprogrammed
 *        clients).
 *
 * Dedup: by (callsign or groupName) + freq + modulation. We DO NOT collapse
 * groups that share a freq — the call still needs the callsign.
 *
 * Sort order: same SOP convention RadioLadderCard uses — facility comms →
 * AWACS → JTAC/AFAC → tankers → strike package — then by frequency. This
 * way the DM reads top-to-bottom and tunes the frequencies they're most
 * likely to need first.
 *
 * Bonus: per-row "Copy" button puts the freq on the OS clipboard so the
 * DM can paste into SRS's frequency input without retyping.
 *
 * Mission-not-loaded case: returns a placeholder explaining why and what
 * to do (load a .miz, or use "Go Live with no mission" if that's already
 * the case).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMissionStore } from '../../store/missionStore';
import type { MissionGroup, ClientUnit } from '../../types/mission';
import { getSrsStatus, type SrsStatus } from '../../api/groups';

const C = {
  bg: 'rgba(13,19,29,0.96)',
  border: '#243349',
  borderHi: '#3a6ea5',
  accent: '#4a9eff',
  accentDim: 'rgba(74,158,255,0.18)',
  text: '#dce6f2',
  textDim: '#8aa0ba',
  green: '#3fb950',
  amber: '#ffd24a',
};

type Row = {
  callsign: string;     // e.g. "Uzi 1-1" — the row's primary label
  groupName: string;    // groups it back to the group/flight
  aircraft: string;     // type code, may be empty for non-flying groups
  freqMhz: number;
  modulation: number;   // 0=AM, 1=FM
  role: string;
  coalition: string;
  source: 'preset' | 'group';
  tacan?: string;
};

/** Match the RadioLadderCard's tier order so the directory and the kneeboard
 *  card use the same mental model. Lower number = higher in the table. */
function roleTier(g: MissionGroup): number {
  const task = (g.task || '').toLowerCase();
  const cat = (g.category || '').toLowerCase();
  const utype = ((g.units || [])[0]?.type || '').toUpperCase();
  if (cat === 'ship') {
    if (/CVN|CV_|LHA|LHD|STENNIS|LINCOLN|ROOSEVELT|VINSON|TRUMAN|EISENHOWER|WASHINGTON|FORRESTAL/.test(utype)) return 0;
    return 1;
  }
  if (task === 'awacs') return 2;
  if (task === 'afac' || task === 'reconnaissance') return 3;
  if (task === 'refueling') return 4;
  return 5;
}
function roleLabel(g: MissionGroup): string {
  const task = (g.task || '').toLowerCase();
  if (task === 'refueling') return 'TANKER';
  if (task === 'awacs') return 'AWACS';
  if (task === 'cap') return 'CAP';
  if (task === 'cas') return 'CAS';
  if (task === 'sead') return 'SEAD';
  if (task === 'strike' || task === 'pinpoint strike') return 'STRIKE';
  if (task === 'antiship strike') return 'ANTISHIP';
  if (task === 'escort') return 'ESCORT';
  if (task === 'intercept') return 'INTERCEPT';
  if (task === 'transport') return 'TRANSPORT';
  if (g.category === 'ship') return 'NAVAL';
  if (g.category === 'helicopter') return 'HELO';
  return (task || g.category || '').toUpperCase();
}

function formatTacan(g: MissionGroup): string | undefined {
  if (!g.tacan || !g.tacan.channel) return undefined;
  return `${g.tacan.channel}${g.tacan.band || ''}${g.tacan.callsign ? ` (${g.tacan.callsign})` : ''}`;
}

export function SrsDirectory({ groupId, onClose }: { groupId?: string; onClose?: () => void }) {
  const groups = useMissionStore((s) => s.groups);
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const [coalitionFilter, setCoalitionFilter] = useState<'all' | 'blue' | 'red'>('blue');
  const [search, setSearch] = useState('');
  // Optional SRS-Server stats poll (Phase 2). Backend returns
  // {configured:false} when SRS_SERVER_URL is unset — we just hide the
  // "● N on" pills in that case. When configured but unreachable, the
  // panel shows a muted "SRS server offline" note.
  const [srsStatus, setSrsStatus] = useState<SrsStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    const fetchOnce = () => getSrsStatus(groupId)
      .then((s) => { if (!cancelled) setSrsStatus(s); })
      .catch(() => { /* network blips tolerated — keep last good state */ });
    fetchOnce();
    // 10s cadence keeps the pill fresh without hammering SRS-Server.
    pollRef.current = setInterval(fetchOnce, 10000);
    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current); };
  }, [groupId]);

  // Build a (freq_mhz, modulation) → connected-client-count lookup so each
  // row can show its pill in O(1). Rounded to 3 dp to match what the
  // directory's own rows show; SRS-Server's freq precision varies.
  const liveCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!srsStatus?.available || !srsStatus.clients) return m;
    for (const c of srsStatus.clients) {
      for (const f of c.freqs ?? []) {
        const k = `${f.freq_mhz.toFixed(3)}|${f.modulation}`;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return m;
  }, [srsStatus]);

  const rows = useMemo<Row[]>(() => {
    if (!groups || groups.length === 0) return [];
    // Player overrides: keyed by groupName so we can mark a group row as
    // "has a preset override" and emit a per-client row for each programmed slot.
    const overrideByGroup = new Map<string, ClientUnit[]>();
    for (const u of clientUnits ?? []) {
      const ch1 = u.radioPresets?.[0]?.channels?.[0];
      if (!ch1 || !Number.isFinite(ch1.freq_mhz)) continue;
      const arr = overrideByGroup.get(u.groupName) ?? [];
      arr.push(u); overrideByGroup.set(u.groupName, arr);
    }

    const out: Row[] = [];
    for (const g of groups) {
      // Coalition filter applied AFTER row building so the coalition badge
      // colours still draw correctly when 'all' is selected.
      const aircraft = (g.units?.[0]?.type) || '';
      const overrides = overrideByGroup.get(g.groupName) ?? [];
      const tacan = formatTacan(g);
      if (overrides.length > 0) {
        // One row per programmed client; preset 1 channel 1 is "selected" at spawn.
        for (const u of overrides) {
          const ch = u.radioPresets![0].channels[0];
          out.push({
            callsign: u.name || g.groupName,
            groupName: g.groupName,
            aircraft: u.type || aircraft,
            freqMhz: ch.freq_mhz,
            modulation: ch.modulation,
            role: roleLabel(g),
            coalition: g.coalition,
            source: 'preset',
            tacan,
          });
        }
      } else if (g.frequency && g.frequency > 0) {
        out.push({
          callsign: g.groupName,
          groupName: g.groupName,
          aircraft,
          freqMhz: g.frequency,
          modulation: g.modulation,
          role: roleLabel(g),
          coalition: g.coalition,
          source: 'group',
          tacan,
        });
      }
    }

    // Sort: facility → AWACS → JTAC → tanker → strike, then by freq.
    out.sort((a, b) => {
      const ga = groups.find((g) => g.groupName === a.groupName)!;
      const gb = groups.find((g) => g.groupName === b.groupName)!;
      const ta = roleTier(ga), tb = roleTier(gb);
      if (ta !== tb) return ta - tb;
      return a.freqMhz - b.freqMhz;
    });

    // Dedup: same callsign + freq + mod = one row.
    const seen = new Set<string>();
    return out.filter((r) => {
      const key = `${r.callsign}|${r.freqMhz.toFixed(3)}|${r.modulation}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }, [groups, clientUnits]);

  const visible = useMemo(() => rows.filter((r) => {
    if (coalitionFilter !== 'all' && r.coalition !== coalitionFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!r.callsign.toLowerCase().includes(q) && !r.aircraft.toLowerCase().includes(q) && !r.role.toLowerCase().includes(q) && !String(r.freqMhz).includes(q)) return false;
    }
    return true;
  }), [rows, coalitionFilter, search]);

  const copy = (text: string) => { try { navigator.clipboard?.writeText(text); } catch { /* ignore */ } };
  const copyAll = () => {
    const lines = visible.map((r) => `${r.callsign}\t${r.freqMhz.toFixed(3)} ${r.modulation === 0 ? 'AM' : 'FM'}\t${r.aircraft}\t${r.role}${r.tacan ? `\tTCN ${r.tacan}` : ''}`);
    copy(`SRS DIRECTORY (${coalitionFilter.toUpperCase()})\n${lines.join('\n')}`);
  };

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: C.accentDim, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.text }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          📻 SRS DIRECTORY
          {srsStatus?.configured && srsStatus.available && (
            <span title={`SRS-Server reports ${srsStatus.count ?? 0} client(s) connected`}
                  style={{ fontWeight: 400, fontSize: 10, color: C.green, letterSpacing: 0.5 }}>
              ● {srsStatus.count ?? 0} live
            </span>
          )}
          {srsStatus?.configured && srsStatus.available === false && (
            <span title="SRS-Server unreachable — directory still works"
                  style={{ fontWeight: 400, fontSize: 10, color: C.textDim, letterSpacing: 0.5 }}>
              ● offline
            </span>
          )}
        </span>
        {onClose && <span onClick={onClose} style={{ cursor: 'pointer', color: C.textDim, fontWeight: 400 }}>×</span>}
      </div>

      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['blue', 'red', 'all'] as const).map((c) => (
            <button key={c} onClick={() => setCoalitionFilter(c)}
                    style={{ flex: 1, padding: '4px 6px', fontSize: 10, letterSpacing: 1, fontWeight: 700, border: `1px solid ${coalitionFilter === c ? C.borderHi : C.border}`, borderRadius: 3, cursor: 'pointer', background: coalitionFilter === c ? C.accentDim : 'transparent', color: coalitionFilter === c ? C.text : C.textDim }}>
              {c.toUpperCase()}
            </button>
          ))}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search callsign / freq / role…"
               style={{ background: 'rgba(0,0,0,0.35)', border: `1px solid ${C.border}`, color: C.text, padding: '4px 7px', fontSize: 11, borderRadius: 3, outline: 'none', fontFamily: 'inherit' }} />
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 12, color: C.textDim, fontSize: 11, lineHeight: 1.55 }}>
          No mission loaded — the SRS directory pulls from <span style={{ color: C.text }}>MissionGroup.frequency</span> and per-client preset 1 ch 1.
          Load a <code style={{ background: 'rgba(255,255,255,0.05)', padding: '1px 4px', borderRadius: 2 }}>.miz</code> in the Editor and the table populates here.
        </div>
      ) : (
        <>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', maxHeight: 340 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, color: C.text }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: 'rgba(9,13,20,0.98)', zIndex: 1 }}>
                  <th style={th}>Callsign</th>
                  <th style={th}>Freq</th>
                  <th style={th}>Role</th>
                  <th style={{ ...th, width: 36, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr key={`${r.callsign}-${i}-${r.freqMhz}`} style={{ borderTop: `1px solid ${C.border}`, background: r.coalition === 'red' ? 'rgba(224,85,79,0.04)' : r.coalition === 'blue' ? 'rgba(74,158,255,0.04)' : 'transparent' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{r.callsign}</div>
                      <div style={{ color: C.textDim, fontSize: 10 }}>
                        {r.aircraft || '—'}
                        {r.tacan && <span style={{ color: C.amber, marginLeft: 6 }}>TCN {r.tacan}</span>}
                      </div>
                    </td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, monospace', color: C.amber, fontWeight: 600 }}>
                      {r.freqMhz.toFixed(3)} <span style={{ color: C.textDim, fontSize: 10 }}>{r.modulation === 0 ? 'AM' : 'FM'}</span>
                      {(() => {
                        const n = liveCounts.get(`${r.freqMhz.toFixed(3)}|${r.modulation}`) ?? 0;
                        if (n === 0) return null;
                        return (
                          <span title={`${n} client(s) currently tuned to this frequency in SRS`}
                                style={{ display: 'inline-block', marginLeft: 6, padding: '0 4px', fontSize: 9, fontWeight: 700, color: C.green, border: `1px solid ${C.green}`, borderRadius: 2, verticalAlign: 'middle' }}>
                            ● {n} on
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ ...td, color: C.textDim, fontSize: 10, letterSpacing: 0.5 }}>{r.role}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button onClick={() => copy(r.freqMhz.toFixed(3))} title="Copy frequency to clipboard"
                              style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, padding: '2px 5px', fontSize: 10, borderRadius: 3, cursor: 'pointer' }}>
                        copy
                      </button>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 10, textAlign: 'center', color: C.textDim, fontSize: 11 }}>No matches.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '6px 10px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: C.textDim }}>
            <span>{visible.length} / {rows.length} entries</span>
            <button onClick={copyAll} title="Copy entire directory as tab-separated text"
                    style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, padding: '3px 7px', fontSize: 10, borderRadius: 3, cursor: 'pointer' }}>
              copy all
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: C.textDim, padding: '5px 8px', borderBottom: `1px solid ${C.border}` };
const td: React.CSSProperties = { padding: '5px 8px', verticalAlign: 'top' };
