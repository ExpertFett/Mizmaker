/**
 * readyRoomImport — pure helpers for the "Import from Ready Room" path on the
 * Roster tab. Ready Room (the squadron-management sibling app) owns who's flying
 * each mission; this turns its tokened roster feed into the same
 * {headers, rows} shape RosterTab's CSV/XLSX importer already consumes, so the
 * existing auto-detect → auto-match → Apply pipeline fills the sign-up sheet
 * with zero backend changes.
 *
 * Contract consumed: `readyroom.mission_roster.v1` (served by Ready Room at
 * GET {base}/share/{ingest_token}/missions/{missionId}/roster). Kept pure +
 * framework-free so it's unit-testable in isolation (readyRoomImport.test.ts).
 */

export interface RrSignup {
  name: string | null;
  callsign: string | null;
  modex: string | null;
  status: string | null;
}
export interface RrFlight {
  callsign: string | null;
  aircraft: string | null;
  role: string | null;
  slots: number;
  signups: RrSignup[];
}
export interface RrRoster {
  schema: string;
  mission: { id: number; name: string; status: string; primary_aircraft: string | null; start_at: number | null };
  wing: { id: number; name: string; tag: string | null };
  flights: RrFlight[];
}

/** Schema family this consumer understands. We accept any `…v1` minor as long
 *  as the family matches; an incompatible future shape is rejected up-front. */
export const ROSTER_SCHEMA_PREFIX = 'readyroom.mission_roster.v1';

export function isSupportedRoster(obj: unknown): obj is RrRoster {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return typeof o.schema === 'string'
    && o.schema.startsWith(ROSTER_SCHEMA_PREFIX)
    && Array.isArray((o as { flights?: unknown }).flights);
}

export interface RrLink { base: string; token: string; missionId: number }

/**
 * Pull {base, token, missionId} out of a pasted Ready Room share link. Accepts
 * a full URL (`https://host/share/<token>/missions/<id>/roster`), the same with
 * a path prefix, or a bare path (`/share/<token>/missions/<id>`); the trailing
 * `/roster` is optional. `base` is the origin (+ any prefix) with trailing
 * slashes trimmed — empty string for a bare path. Returns null when it doesn't
 * look like a share link.
 */
export function parseRrLink(input: string): RrLink | null {
  const s = (input || '').trim();
  if (!s) return null;
  const m = s.match(/^(.*?)\/share\/([^/\s]+)\/missions\/(\d+)(?:\/roster)?\/?$/i);
  if (!m) return null;
  const base = (m[1] || '').replace(/\/+$/, '');
  const token = m[2];
  const missionId = Number(m[3]);
  if (!token || !Number.isInteger(missionId) || missionId <= 0) return null;
  return { base, token, missionId };
}

/** Build the canonical roster URL from a parsed link. */
export function rosterUrl(link: RrLink): string {
  return `${link.base}/share/${link.token}/missions/${link.missionId}/roster`;
}

/**
 * Map the v1 roster into RosterTab's importer shape — one row per signed-up
 * pilot, using the planner's own generated-sheet column names so autoDetectCols
 * lights up exactly as on a round-tripped CSV. Rows are emitted flight-then-seat
 * so RosterTab's sequential fill lands pilot 1 → seat 1, etc., when an exact
 * callsign match isn't found.
 *
 * Per flight, signup[i] (seat i, 0-based):
 *   Flight    = flight.callsign
 *   Seat      = i + 1
 *   Callsign  = "<flight.callsign> 1-<i+1>"  (→ "Uzi 1-1"; empty if no callsign)
 *   Pilot     = signup.name || signup.callsign || ""
 *   Modex     = signup.modex || ""   (side/hull number → unit onboard_num on Apply)
 */
export function rosterToRows(roster: RrRoster): { headers: string[]; rows: Record<string, string>[] } {
  const headers = ['Flight', 'Callsign', 'Pilot', 'Seat', 'Modex'];
  const rows: Record<string, string>[] = [];
  for (const flight of roster.flights || []) {
    const fc = (flight.callsign || '').trim();
    (flight.signups || []).forEach((s, i) => {
      const seat = i + 1;
      rows.push({
        Flight: fc,
        Callsign: fc ? `${fc} 1-${seat}` : '',
        Pilot: (s.name || s.callsign || '').trim(),
        Seat: String(seat),
        Modex: (s.modex || '').trim(),
      });
    });
  }
  return { headers, rows };
}
