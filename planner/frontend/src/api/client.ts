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
