/**
 * Radio Ladder Card — shared mission-wide kneeboard card.
 * Master frequency reference for all flights and support assets.
 */

import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, notesBox, TEXT, DIM, ACCENT, ROW_ALT, footerStyle, MissionDateLine } from './cardStyles';
import type { MissionGroup, MissionOverviewData } from '../types/mission';

interface RadioLadderCardProps {
  groups: MissionGroup[];
  coalition: string;
  overview?: MissionOverviewData;
  /** Planner-typed notes rendered inside the NOTES box. (v0.9.70) */
  notes?: string;
}

function formatFreq(freq: number, mod: number): string {
  return `${freq.toFixed(3)} ${mod === 0 ? 'AM' : 'FM'}`;
}

function getRoleLabel(g: MissionGroup): string {
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
  if (g.category === 'helicopter') return 'HELO';
  if (g.category === 'ship') return 'NAVAL';
  return task.toUpperCase() || g.category.toUpperCase();
}

export function RadioLadderCard({ groups, coalition, overview, notes }: RadioLadderCardProps) {
  // Order per Fett's SOP convention: facility comms first (the things
  // pilots talk to before takeoff and after landing — carriers/airfield
  // tower), then command-and-control (AWACS), then JTAC/FAC, then
  // tankers (push freqs you contact mid-mission), then the strike/CAS/
  // CAP package itself. Reading top-to-bottom mirrors the typical
  // mission flow: launch → join → cleared off → push → talk to JTAC →
  // tank → engage → recover. For divert situations the bottom-up
  // reading still works (you'd rejoin tanker, contact AWACS for state,
  // then talk to whatever recovery field).
  const coalitionGroups = groups
    .filter((g) => g.coalition === coalition && g.frequency > 0)
    .sort((a, b) => {
      const roleOrder = (g: MissionGroup) => {
        const task = (g.task || '').toLowerCase();
        const cat = (g.category || '').toLowerCase();
        const utype = ((g.units || [])[0]?.type || '').toUpperCase();
        // Tier 0: facility comms — carriers, recovery ships
        if (cat === 'ship') {
          // Prefer CVN/LHA over arbitrary surface combatants
          if (/CVN|CV_|LHA|LHD|STENNIS|LINCOLN|ROOSEVELT|VINSON|TRUMAN|EISENHOWER|WASHINGTON|FORRESTAL/.test(utype)) return 0;
          return 1;
        }
        // Tier 2: command and control
        if (task === 'awacs') return 2;
        // Tier 3: JTAC / FAC(A) — typically AFAC tasked or helo recon
        if (task === 'afac' || task === 'reconnaissance') return 3;
        // Tier 4: tankers (push freqs)
        if (task === 'refueling') return 4;
        // Tier 5: strike package — CAP/CAS/SEAD/STRIKE etc
        return 5;
      };
      const oa = roleOrder(a), ob = roleOrder(b);
      if (oa !== ob) return oa - ob;
      return a.frequency - b.frequency;
    });

  // Deduplicate by frequency (some groups share frequencies)
  const seen = new Set<string>();
  const uniqueEntries = coalitionGroups.filter((g) => {
    const key = `${g.frequency.toFixed(3)}-${g.modulation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div style={{ ...cardRoot, position: 'relative' }}>
      <div style={headerStyle}>
        <div style={titleStyle}>RADIO LADDER</div>
        <div style={subtitleStyle}>
          {coalition.toUpperCase()} coalition | {uniqueEntries.length} frequencies
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 30 }}>#</th>
            <th style={{ ...th, textAlign: 'left' }}>CALLSIGN / GROUP</th>
            <th style={{ ...th, width: 80 }}>ROLE</th>
            <th style={{ ...th, width: 120 }}>FREQUENCY</th>
          </tr>
        </thead>
        <tbody>
          {uniqueEntries.map((g, i) => (
            <tr key={g.groupId} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
              <td style={{ ...cell, textAlign: 'center', color: ACCENT, fontWeight: 600 }}>{i + 1}</td>
              <td style={{ ...cell, fontWeight: 500 }}>{g.groupName}</td>
              <td style={{ ...cell, textAlign: 'center', fontSize: 17, color: DIM }}>{getRoleLabel(g)}</td>
              <td style={{ ...cell, textAlign: 'center', color: ACCENT, fontWeight: 600 }}>
                {formatFreq(g.frequency, g.modulation)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {uniqueEntries.length === 0 && (
        <div style={{ padding: '20px 16px', fontSize: 17, color: DIM, textAlign: 'center' }}>
          No radio frequencies found.
        </div>
      )}

      <div style={sectionTitle}>NOTES</div>
      <div style={notesBox}>
        {notes && notes.trim() && (
          <div style={{
            fontSize: 17, color: TEXT,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.35,
          }}>
            {notes.trim()}
          </div>
        )}
      </div>

      <div style={footerStyle}>Generated by DCS Mission Planner | VMFA-224(AW)</div>
    </div>
  );
}
