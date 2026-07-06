/**
 * Tacview ACMI → AAR flight debrief (v1.19.111).
 *
 * Parses a Tacview flight recording (`.acmi` text, or `.zip.acmi`/binary zip
 * wrapping a `.txt.acmi`) into a full-sortie picture — not just combat. We
 * stream the file, build an object registry, and emit a timeline of:
 *   • spawn/entry of each aircraft (first seen)      → 'spawn'
 *   • RTB / despawn (removed, not destroyed)         → 'rtb'
 *   • kills / losses (destroyed)                     → 'kill' / 'loss'
 *   • ground / naval destructions                    → 'kill' / 'loss'
 *   • Tacview Messages / Bookmarks                   → 'note'
 * plus a summary (duration, aircraft by coalition, destroyed count, roster).
 *
 * Earlier version only surfaced `Event=Destroyed`, so a sortie with few/no
 * kills looked empty — this shows the whole flight.
 *
 * Format ref: Tacview ACMI 2.x — comma-separated `Key=Value` fields, `#<sec>`
 * time frames, `0,` global lines, `\,` `\|` `\\` escaping inside values.
 */
import JSZip from 'jszip';

export type AcmiEventType = 'spawn' | 'rtb' | 'kill' | 'loss' | 'note';

export interface AcmiEvent {
  type: AcmiEventType;
  time_min: number;
  unit: string;
  side: string;
  killer?: string;
  detail?: string;
  source: 'tacview';
}

export interface AcmiParticipant { name: string; type: string; side: string; pilot?: string; }

export interface AcmiSummary {
  durationMin: number;
  destroyed: number;
  aircraft: number;
  bySide: Record<string, number>;
  participants: AcmiParticipant[];
}

export interface AcmiResult { events: AcmiEvent[]; summary: AcmiSummary; }

interface Obj {
  name?: string; type?: string; coalition?: string; pilot?: string; group?: string;
  firstSec: number; lastSec: number; seenAir: boolean; destroyed: boolean; killerId?: string;
}

/** Split an ACMI line into fields, honouring `\,` escapes inside values. */
function splitFields(rest: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '\\' && i + 1 < rest.length) { cur += rest[i + 1]; i++; continue; }
    if (c === ',') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function isMunition(type?: string): boolean {
  if (!type) return false;
  return /weapon|flare|chaff|decoy|shrapnel|bullet|explosion|container|parachute|misc|projectile/i.test(type);
}
function isAircraft(type?: string): boolean {
  if (!type) return false;
  return /\bair\b|fixedwing|rotor|heli|aircraft|plane/i.test(type);
}
/** blue/allies → loss (friendly down); red/enemies → kill; else loss. */
function classify(coalition?: string): 'kill' | 'loss' {
  return /red|enem/i.test(coalition || '') ? 'kill' : 'loss';
}
function label(o: Obj, id: string): string {
  return o.pilot || o.name || `Object ${id}`;
}
function unesc(s: string): string { return s.replace(/\\(.)/g, '$1'); }

export function parseAcmi(text: string): AcmiResult {
  const objects = new Map<string, Obj>();
  const messages: AcmiEvent[] = [];
  let curSec = 0;
  let maxSec = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('//')) continue;

    if (line[0] === '#') {
      const t = parseFloat(line.slice(1));
      if (Number.isFinite(t)) { curSec = t; if (t > maxSec) maxSec = t; }
      continue;
    }
    if (line[0] === '-') {
      const o = objects.get(line.slice(1).trim());
      if (o) o.lastSec = curSec;
      continue;
    }

    const comma = line.indexOf(',');
    if (comma < 0) continue;
    const id = line.slice(0, comma);
    const fields = splitFields(line.slice(comma + 1));

    if (id === '0') {
      for (const f of fields) {
        if (!f.startsWith('Event=')) continue;
        const parts = f.slice(6).split('|').map(unesc);
        const kind = (parts[0] || '').toLowerCase();
        if (kind === 'destroyed' && parts[1]) {
          const o = objects.get(parts[1]);
          if (o) { o.destroyed = true; o.lastSec = curSec; if (parts[2]) o.killerId = parts[2]; }
        } else if (kind === 'message' || kind === 'bookmark') {
          const txt = parts[parts.length - 1];
          if (txt) messages.push({
            type: 'note', time_min: curSec / 60,
            unit: kind === 'bookmark' ? 'Bookmark' : 'Message',
            side: '—', detail: txt, source: 'tacview',
          });
        }
      }
      continue;
    }

    let o = objects.get(id);
    if (!o) { o = { firstSec: curSec, lastSec: curSec, seenAir: false, destroyed: false }; objects.set(id, o); }
    o.lastSec = curSec;
    for (const f of fields) {
      const eq = f.indexOf('=');
      if (eq < 0) continue;
      const key = f.slice(0, eq);
      const val = unesc(f.slice(eq + 1));
      switch (key) {
        case 'Name': o.name = val; break;
        case 'Type': o.type = val; if (isAircraft(val)) o.seenAir = true; break;
        case 'Coalition': o.coalition = val; break;
        case 'Pilot': o.pilot = val; break;
        case 'Group': o.group = val; break;
        default: break;
      }
    }
  }

  const events: AcmiEvent[] = [...messages];
  const participants: AcmiParticipant[] = [];
  const bySide: Record<string, number> = {};
  let destroyed = 0;
  let aircraft = 0;

  for (const [id, o] of objects) {
    if (isMunition(o.type)) continue;
    const side = o.coalition || '—';
    const isAir = o.seenAir || isAircraft(o.type);
    if (o.destroyed) destroyed++;

    if (isAir) {
      aircraft++;
      bySide[side] = (bySide[side] || 0) + 1;
      participants.push({ name: o.name || `Object ${id}`, type: o.type || '', side, pilot: o.pilot });
      events.push({
        type: 'spawn', time_min: o.firstSec / 60, unit: label(o, id), side,
        detail: o.type ? o.type.replace(/\+/g, ' ') : undefined, source: 'tacview',
      });
      if (o.destroyed) {
        const k = o.killerId ? objects.get(o.killerId) : undefined;
        events.push({
          type: classify(o.coalition), time_min: o.lastSec / 60, unit: label(o, id), side,
          killer: k ? label(k, o.killerId!) : undefined, source: 'tacview',
        });
      } else {
        events.push({ type: 'rtb', time_min: o.lastSec / 60, unit: label(o, id), side, source: 'tacview' });
      }
    } else if (o.destroyed) {
      const k = o.killerId ? objects.get(o.killerId) : undefined;
      events.push({
        type: classify(o.coalition), time_min: o.lastSec / 60, unit: label(o, id), side,
        killer: k ? label(k, o.killerId!) : undefined,
        detail: o.type ? o.type.replace(/\+/g, ' ') : undefined, source: 'tacview',
      });
    }
  }

  events.sort((a, b) => a.time_min - b.time_min);
  participants.sort((a, b) => a.side.localeCompare(b.side) || a.name.localeCompare(b.name));

  return { events, summary: { durationMin: maxSec / 60, destroyed, aircraft, bySide, participants } };
}

/** Parse a Tacview file — `.acmi`/`.txt.acmi` (text) or `.zip.acmi` (zip). */
export async function parseAcmiFile(file: File): Promise<AcmiResult> {
  const name = file.name.toLowerCase();
  const readZip = async () => {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    const pick = entries.find((f) => /\.(txt\.)?acmi$/i.test(f.name)) || entries[0];
    if (!pick) throw new Error('No ACMI entry found inside the zip.');
    return parseAcmi(await pick.async('string'));
  };
  if (name.endsWith('.zip.acmi') || name.endsWith('.zip')) return readZip();
  // Some `.acmi` files are actually zips — sniff the PK magic.
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return readZip();
  return parseAcmi(await file.text());
}
