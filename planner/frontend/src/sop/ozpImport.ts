/**
 * Import an OvGME-style kneeboard package (.ozp / .zip) and turn it into
 * a draft SOP. The package is expected to contain a `kneeboard/` root
 * with per-airframe subfolders of PNG/JPG images — the typical output
 * from squadrons like CSG-3.
 *
 * Since the SOP text is baked into images, we can't auto-extract
 * callsigns/freqs without vision AI. For now we:
 *   - Store each image as an SOP attachment tagged by airframe
 *   - Pull out common "top-level" kneeboards (Comms / Tanker / TACAN) as
 *     SOP-wide references for easy inspection in the detail panel
 *   - Leave the structured SOP fields (flights, comms, tacans) empty so
 *     the user can fill them from the attached charts
 */

import JSZip from 'jszip';
import type { SOP, SopAttachment } from './types';
import { makeId } from './types';

export interface OzpImportResult {
  sop: SOP;
  imageCount: number;
  aircraftCount: number;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** Guess a human category for top-level (non-airframe) kneeboard images. */
function guessCategory(filename: string): string | undefined {
  const name = filename.toLowerCase();
  if (/comm|freq/.test(name)) return 'Common Comms';
  if (/transponder|iff|mode/.test(name)) return 'Transponder SOP';
  if (/tanker|aar|refuel/.test(name)) return 'Tanker SOP';
  if (/tacan_?w|tacan w/.test(name)) return 'TACAN (West)';
  if (/tacan_?z|tacan z/.test(name)) return 'TACAN (Zulu/East)';
  if (/tacan/.test(name)) return 'TACAN';
  if (/radio.*preset/.test(name)) return 'Radio Presets';
  if (/awacs|aew/.test(name)) return 'AWACS';
  if (/carrier|cvn|case i+/i.test(name)) return 'Carrier Ops';
  if (/checklist/.test(name)) return 'Checklist';
  return undefined;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = reader.result as string;
      resolve(s.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

/** Try client-side (JSZip) extraction; if that fails, ask the backend. */
async function extractEntries(
  file: File,
): Promise<{ fullPath: string; filename: string; dataBase64: string; mimeType: string }[]> {
  // Fast path: JSZip handles deflate / stored
  try {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter((f) => !f.dir && IMAGE_EXT.test(f.name));
    const out = [];
    for (const entry of entries) {
      const blob = await entry.async('blob');
      out.push({
        fullPath: entry.name,
        filename: entry.name.split('/').pop() || entry.name,
        dataBase64: await blobToBase64(blob),
        mimeType: guessMime(entry.name),
      });
    }
    return out;
  } catch (err) {
    // Fall through to backend — handles method 93 (zstd) etc.
    console.warn('JSZip extraction failed, falling back to backend:', err);
  }

  const form = new FormData();
  form.append('file', file);
  const resp = await fetch('/api/sop/extract-archive', { method: 'POST', body: form });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error || `Backend extraction failed (HTTP ${resp.status})`);
  }
  const data = (await resp.json()) as { images: { path: string; filename: string; mimeType: string; dataBase64: string }[] };
  return data.images.map((img) => ({
    fullPath: img.path,
    filename: img.filename,
    dataBase64: img.dataBase64,
    mimeType: img.mimeType,
  }));
}

export async function importOzpAsSop(file: File): Promise<OzpImportResult> {
  const rawEntries = await extractEntries(file);

  const attachments: SopAttachment[] = [];
  const airframeSet = new Set<string>();

  // Find the common prefix if the archive wraps everything in a top-level folder
  // e.g. "3a._CSG3_Kneeboards_v1.4.7/kneeboard/..."
  let kneeboardPrefix: string | null = null;
  for (const e of rawEntries) {
    if (kneeboardPrefix !== null) break;
    const m = e.fullPath.match(/^(.*?\/)?kneeboard\//i);
    if (m) kneeboardPrefix = m[0];
  }

  for (const entry of rawEntries) {
    const fullPath = entry.fullPath;
    if (!IMAGE_EXT.test(fullPath)) continue;
    if (kneeboardPrefix && !fullPath.startsWith(kneeboardPrefix)) continue;

    const relPath = kneeboardPrefix ? fullPath.substring(kneeboardPrefix.length) : fullPath;
    const segments = relPath.split('/').filter((s) => s.length > 0);
    if (segments.length === 0) continue;

    const imageName = segments[segments.length - 1];
    const aircraft = segments.length > 1 ? segments[segments.length - 2] : '';
    if (aircraft) airframeSet.add(aircraft);
    const category = aircraft ? undefined : guessCategory(imageName);

    attachments.push({
      name: imageName,
      mimeType: entry.mimeType,
      dataBase64: entry.dataBase64,
      aircraft: aircraft || undefined,
      category,
    });
  }

  // Sort: SOP-wide first (no aircraft), then by aircraft name, then by filename
  attachments.sort((a, b) => {
    const aAir = a.aircraft || '';
    const bAir = b.aircraft || '';
    if (aAir !== bAir) return aAir.localeCompare(bAir);
    return a.name.localeCompare(b.name);
  });

  const baseName = file.name.replace(/\.(ozp|zip)$/i, '');

  const sop: SOP = {
    id: makeId(),
    name: `${baseName} (imported)`,
    notes:
      `Imported from ${file.name} — ${attachments.length} kneeboard images across ` +
      `${airframeSet.size} airframes. Structured fields (callsigns, comms, TACAN, ` +
      `laser codes) are empty until you fill them in from the attached charts. ` +
      `Automatic extraction from images requires the vision AI backend (planned).`,
    updatedAt: Date.now(),
    flights: [],
    comms: [],
    tacans: [],
    attachments,
  };

  return {
    sop,
    imageCount: attachments.length,
    aircraftCount: airframeSet.size,
  };
}
