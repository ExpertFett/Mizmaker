/** API client for Flask backend */

const BASE = '';

export async function uploadMission(file: File) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
  return res.json();
}

export async function editWaypoints(sessionId: string, edits: unknown[]) {
  const res = await fetch(`${BASE}/api/edit/waypoints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, edits }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Edit failed');
  return res.json();
}

export async function downloadMiz(
  sessionId: string,
  edits: unknown[],
  modifiedGroups: Record<string, unknown>,
  unitEdits?: unknown[],
): Promise<Blob> {
  const res = await fetch(`${BASE}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, edits, modifiedGroups, unitEdits: unitEdits || [] }),
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
