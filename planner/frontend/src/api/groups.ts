/**
 * API client for the Live/DM-terminal multi-tenant group endpoints
 * (backend services/groups.py → /api/groups*).
 *
 * All routes require a Discord login (401 if not) and return 503 when the
 * server has no Supabase configured. Errors are thrown with the server's
 * message so the UI can show why.
 */

export interface GroupSummary {
  id: string;
  name: string;
  role: 'admin' | 'operator';
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
  opts: { role?: 'admin' | 'operator'; expiresInHours?: number; maxUses?: number } = {},
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
