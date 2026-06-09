/**
 * In-memory holder for the original .miz Blob the user uploaded
 * (v1.19.73, task #56). Stash on upload, read on download so the
 * mission library auto-save can persist the ORIGINAL bytes — not
 * the post-edit serialisation. The edits queue restores the rest
 * on next open.
 *
 * Module-level state instead of a Zustand store because Blobs
 * aren't serialisable, won't survive a JSON state snapshot, and
 * have no business showing up in devtools state inspectors. One
 * blob, one lifetime, plain getter/setter is the right shape.
 *
 * Reset when the user navigates away from the editor (clear()).
 */

let stashedBlob: Blob | null = null;
let stashedName: string | null = null;

export function setOriginalMiz(blob: Blob, name: string): void {
  stashedBlob = blob;
  stashedName = name;
}

export function getOriginalMiz(): { blob: Blob; name: string } | null {
  if (!stashedBlob || !stashedName) return null;
  return { blob: stashedBlob, name: stashedName };
}

export function clearOriginalMiz(): void {
  stashedBlob = null;
  stashedName = null;
}
