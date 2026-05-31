/**
 * API client for the Live/DM-terminal multi-tenant group endpoints
 * (backend services/groups.py → /api/groups*).
 *
 * All routes require a Discord login (401 if not) and return 503 when the
 * server has no Supabase configured. Errors are thrown with the server's
 * message so the UI can show why.
 */

/** Mission roles. Stored as: admin=Game Master, operator=Observer, plus the
 *  named tiers. 'admin' is also the only role that manages the group. */
export type LiveRole = 'admin' | 'commander' | 'jtac' | 'atc' | 'operator';
export const ROLE_LABEL: Record<string, string> = {
  admin: 'Game Master', commander: 'Commander', jtac: 'JTAC', atc: 'ATC', operator: 'Observer',
};
const ROLE_CAPS: Record<string, ReadonlySet<string>> = {
  admin: new Set(['manage', 'spawn', 'command', 'delete', 'effects', 'markers']),
  commander: new Set(['spawn', 'command', 'delete', 'effects', 'markers']),
  jtac: new Set(['effects', 'markers']),
  atc: new Set(['effects', 'markers']),
  operator: new Set(),
};
/** Does a role grant a capability? (mirrors the backend; backend still enforces) */
export function can(role: string | undefined, cap: string): boolean {
  return ROLE_CAPS[role || '']?.has(cap) ?? false;
}

export interface GroupSummary {
  id: string;
  name: string;
  role: LiveRole | string;
}

export interface ServerProfile {
  id: string;
  name: string;
  olympusHost: string | null;
  olympusPort: number | null;
  lotatcUrl: string | null;
  hasPassword: boolean;
  updatedAt?: string;
}

export interface GroupMember {
  userId: string;
  username: string | null;
  role: string;
}

export interface MeInfo {
  id: string;
  username: string | null;
}

/** HTTP status surfaced on thrown errors so callers can branch (401/503). */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',  // never serve a stale live feed from browser cache
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const d = await res.json();
      if (d && typeof d.error === 'string') msg = d.error;
    } catch { /* non-JSON */ }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function listGroups() {
  return req<{ groups: GroupSummary[]; me: MeInfo }>('/api/groups');
}

export function createGroup(name: string) {
  return req<GroupSummary>('/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function joinGroup(code: string) {
  return req<GroupSummary>('/api/groups/join', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function createInvite(
  gid: string,
  opts: { role?: LiveRole; expiresInHours?: number; maxUses?: number } = {},
) {
  return req<{ code: string; role: string; expiresAt: string | null; maxUses: number | null }>(
    `/api/groups/${gid}/invites`,
    { method: 'POST', body: JSON.stringify(opts) },
  );
}

export function listMembers(gid: string) {
  return req<{ members: GroupMember[] }>(`/api/groups/${gid}/members`);
}

export function removeMember(gid: string, userId: string) {
  return req<{ ok: true }>(`/api/groups/${gid}/members/${userId}`, { method: 'DELETE' });
}

/** Game Master assigns a member's mission role. */
export function setMemberRole(gid: string, userId: string, role: LiveRole) {
  return req<{ ok: true; role: string }>(`/api/groups/${gid}/members/${userId}`, {
    method: 'PATCH', body: JSON.stringify({ role }),
  });
}

export function listProfiles(gid: string) {
  return req<{ profiles: ServerProfile[] }>(`/api/groups/${gid}/profiles`);
}

export interface ProfileInput {
  name: string;
  olympusHost?: string;
  olympusPort?: number;
  olympusPassword?: string;
  lotatcUrl?: string;
}

export function createProfile(gid: string, data: ProfileInput) {
  return req<{ id: string }>(`/api/groups/${gid}/profiles`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateProfile(gid: string, pid: string, data: Partial<ProfileInput>) {
  return req<{ ok: true }>(`/api/groups/${gid}/profiles/${pid}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteProfile(gid: string, pid: string) {
  return req<{ ok: true }>(`/api/groups/${gid}/profiles/${pid}`, { method: 'DELETE' });
}

export interface TestResult {
  ok: boolean;
  reachable?: boolean;
  authOk?: boolean | null;
  error?: string;
}

/** Probe a saved server profile (Olympus reachability + role-password auth).
 *  The password is decrypted server-side; never travels to/from the browser. */
export function testProfile(gid: string, pid: string) {
  return req<TestResult>(`/api/groups/${gid}/profiles/${pid}/test`, { method: 'POST' });
}

export interface TelemetryResult {
  ok: boolean;
  data?: unknown;   // parsed JSON (object/array) or { _nonJson: true, bytes }
  error?: string;
}

export type TelemetryResource =
  'mission' | 'units' | 'airbases' | 'bullseye' | 'logs' | 'markers' | 'drawings';

/** Pull a live telemetry resource from the profile's Olympus server. */
export function getTelemetry(gid: string, pid: string, resource: TelemetryResource) {
  return req<TelemetryResult>(`/api/groups/${gid}/profiles/${pid}/telemetry/${resource}`);
}

export interface TelemetryHex { ok: boolean; bytes?: number; hex?: string; error?: string }

/** DEBUG: grab the first few KB of a telemetry resource as raw hex (for
 *  reverse-engineering Olympus's binary unit feed). */
export function getTelemetryHex(gid: string, pid: string, resource: TelemetryResource) {
  return req<TelemetryHex>(`/api/groups/${gid}/profiles/${pid}/telemetry/${resource}?debug=hex`);
}

export interface CommandResult { ok: boolean; status?: number; response?: unknown; error?: string }

/** Send an Olympus command (admin only) — PUT /olympus {command: params}. */
export function sendCommand(gid: string, pid: string, command: string, params: Record<string, unknown>) {
  return req<CommandResult>(`/api/groups/${gid}/profiles/${pid}/command`, {
    method: 'POST',
    body: JSON.stringify({ command, params }),
  });
}

export interface UnitLoadoutItem { name?: string; quantity?: number }
export interface UnitLoadout { name?: string; code?: string; roles?: string[]; items?: UnitLoadoutItem[] }
export interface UnitDbEntry {
  name?: string; label?: string; shortLabel?: string; category?: string; coalition?: string;
  era?: string; type?: string; description?: string; abilities?: string; filename?: string;
  loadouts?: UnitLoadout[]; liveries?: Record<string, { name?: string; countries?: string[] }>;
  engagementRange?: number; acquisitionRange?: number;  // metres (for threat rings)
}
export type UnitCategory = 'aircraft' | 'helicopter' | 'groundunit' | 'navyunit';

/** Fetch a unit-type database (for the spawn picker). */
export function getUnitDatabase(gid: string, pid: string, category: UnitCategory) {
  return req<{ ok: boolean; data?: Record<string, UnitDbEntry>; error?: string }>(
    `/api/groups/${gid}/profiles/${pid}/database/${category}`,
  );
}

/** Same-origin URL for a unit photo (proxied + authed via the session cookie). */
export function unitImageUrl(gid: string, pid: string, filename: string): string {
  return `/api/groups/${gid}/profiles/${pid}/unit-image/${encodeURIComponent(filename)}`;
}

// ─── Controller text comms (Phase 3 LotATC scope) ─────────────────────────
export interface CommsMessage {
  id: string;
  ts: string;                 // ISO timestamp
  author: string;
  authorId: string;
  role: string;
  text: string;
}

/** Backfill recent messages when CommsLog first mounts. */
export function listComms(gid: string) {
  return req<{ messages: CommsMessage[] }>(`/api/groups/${gid}/comms`);
}

/** Broadcast a typed order. Requires the `command` capability. */
export function postComms(gid: string, text: string) {
  return req<CommsMessage>(`/api/groups/${gid}/comms`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

/** Same-origin URL for the comms SSE stream. */
export function commsStreamUrl(gid: string): string {
  return `/api/groups/${gid}/comms/stream`;
}
