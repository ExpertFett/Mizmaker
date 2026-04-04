/** API client for Flask backend */

const BASE = '';

export async function uploadMission(file: File) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
  return res.json();
}

// --------------------------------------------------------------------------
// Server-authoritative waypoint editing
// --------------------------------------------------------------------------

export interface WaypointEditAction {
  groupName: string;
  action: 'move' | 'add' | 'delete' | 'reorder' | 'update';
  wpIndex?: number;
  fromIndex?: number;
  toIndex?: number;
  data?: Record<string, unknown>;
}

export async function sessionEdit(sessionId: string, edit: WaypointEditAction, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/api/sessions/${sessionId}/edit`, {
    method: 'POST',
    headers,
    body: JSON.stringify(edit),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Edit failed' }));
    throw new Error(err.error || 'Edit failed');
  }
  return res.json();
}

// --------------------------------------------------------------------------
// Unit edits — loadouts, datalink, etc. (server-authoritative)
// --------------------------------------------------------------------------

export async function sessionUnitEdit(sessionId: string, edit: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/api/sessions/${sessionId}/unit-edit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ edit }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unit edit failed' }));
    throw new Error(err.error || 'Unit edit failed');
  }
  return res.json();
}

// --------------------------------------------------------------------------
// Download — server applies all edits from its authoritative state
// --------------------------------------------------------------------------

export async function downloadMiz(
  sessionId: string,
  unitEdits?: unknown[],
): Promise<Blob> {
  const res = await fetch(`${BASE}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, unitEdits: unitEdits || [] }),
  });
  if (!res.ok) throw new Error('Download failed');
  return res.blob();
}

export async function exportJson(sessionId: string) {
  const res = await fetch(`${BASE}/api/export/json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Export failed');
  return res.json();
}

export async function getSamRanges() {
  const res = await fetch(`${BASE}/api/sam-ranges`);
  return res.json();
}

export async function closeSession(sessionId: string) {
  await fetch(`${BASE}/api/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
}

export async function dtcPreview(sessionId: string, groupName: string) {
  const res = await fetch(`${BASE}/api/dtc/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, groupName }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'DTC preview failed');
  return res.json();
}

export async function dtcGenerate(sessionId: string, groupName: string, edits: unknown): Promise<Blob> {
  const res = await fetch(`${BASE}/api/dtc/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, groupName, edits }),
  });
  if (!res.ok) throw new Error('DTC generation failed');
  return res.blob();
}

// ── Triggers & Audio ──────────────────────────────────────────────────────

import type { TriggerData, AudioFile, TriggerRule } from '../types/mission';

export async function getTriggers(sessionId: string): Promise<TriggerData> {
  const res = await fetch(`${BASE}/api/triggers?sessionId=${sessionId}`);
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to load triggers');
  return res.json();
}

export async function saveTriggers(sessionId: string, triggers: { rules: TriggerRule[] }): Promise<void> {
  const res = await fetch(`${BASE}/api/triggers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, triggers }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to save triggers');
}

export async function listAudio(sessionId: string): Promise<AudioFile[]> {
  const res = await fetch(`${BASE}/api/audio/list?sessionId=${sessionId}`);
  if (!res.ok) throw new Error('Failed to list audio');
  const data = await res.json();
  return data.audioFiles;
}

export async function uploadAudio(sessionId: string, file: File): Promise<AudioFile> {
  const form = new FormData();
  form.append('sessionId', sessionId);
  form.append('file', file);
  const res = await fetch(`${BASE}/api/audio/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
  return res.json();
}

export async function deleteAudio(sessionId: string, path: string): Promise<void> {
  const res = await fetch(`${BASE}/api/audio/${path}?sessionId=${sessionId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
}

export function audioStreamUrl(sessionId: string, path: string): string {
  return `${BASE}/api/audio/stream/${path}?sessionId=${sessionId}`;
}
