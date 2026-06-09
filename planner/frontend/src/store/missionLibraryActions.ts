/**
 * Mission Library actions (v1.19.73, task #56 Phase B+C).
 *
 * Bridges the IndexedDB layer (missionLibrary.ts) to the various
 * Zustand stores so call sites don't have to know which store holds
 * what. Two public actions:
 *
 *   saveCurrentMission(mizBlob, name)
 *     Build a MissionSnapshot from the live store state and persist
 *     it. Called automatically on every .miz download (see
 *     ExportPanel) so the user never has to think "did I save?".
 *
 *   loadLibraryEntry(entry)
 *     Re-upload the entry's .miz to the backend to get a fresh
 *     session, then hydrate all the per-mission stores from the
 *     snapshot. The user picks up exactly where they left off, not
 *     just "the same .miz".
 *
 * Why bridge here (instead of inside missionLibrary.ts)?
 *   missionLibrary.ts is pure storage — it knows nothing about
 *   Zustand or the rest of the app. Keeping it that way means it's
 *   trivially unit-testable later and the store/* file structure
 *   stays predictable.
 */

import { uploadMission } from '../api/client';
import { useMissionStore } from './missionStore';
import { useEditStore } from './editStore';
import { useTriggerStore } from './triggerStore';
import { useSopStore } from '../sop/sopStore';
import { useVisibilityStore } from './visibilityStore';
import { useGoalsStore } from './goalsStore';
import { useDmpiStore } from './dmpiStore';
import {
  saveMission,
  loadMission,
  touchMission,
  emptySnapshot,
  type MissionLibraryEntry,
  type MissionSnapshot,
} from './missionLibrary';

/**
 * Snapshot every relevant store. Each block is defensive — if a
 * store hasn't been initialised yet (or the user is on a route
 * where it's empty) we just store the zero value, which restore
 * will then accept harmlessly.
 */
function snapshotStores(): MissionSnapshot {
  const snap = emptySnapshot();
  try {
    snap.edits = [...useEditStore.getState().edits];
  } catch { /* keep empty */ }
  try {
    snap.triggerRules = [...useTriggerStore.getState().rules];
  } catch { /* keep empty */ }
  try {
    snap.sopActiveId = useSopStore.getState().activeId;
  } catch { /* keep null */ }
  try {
    snap.visibilityHidden = Array.from(useVisibilityStore.getState().hiddenForParticipants);
  } catch { /* keep empty */ }
  try {
    snap.goals = [...useGoalsStore.getState().goals];
  } catch { /* keep empty */ }
  try {
    snap.dmpis = [...useDmpiStore.getState().dmpis];
  } catch { /* keep empty */ }
  try {
    snap.selectedGroupId = useMissionStore.getState().selectedGroupId;
  } catch { /* keep null */ }
  return snap;
}

/**
 * Save the current session's mission + edit state to the library.
 *
 * Idempotent by mission name — saving twice with the same name
 * updates the existing entry instead of stacking duplicates. The
 * 20-slot LRU eviction in saveMission() then bounces the oldest
 * entry if we've gone over the cap.
 *
 * @param mizBlob  the original (unedited) .miz bytes the session
 *                 was created from. We deliberately keep the
 *                 ORIGINAL .miz, not the post-edit serialisation —
 *                 the edits queue restores the rest.
 * @param name     filename for the library row (no path).
 */
export async function saveCurrentMission(mizBlob: Blob, name: string): Promise<MissionLibraryEntry> {
  // Stable id derived from name so a second save replaces the row
  // rather than creating a duplicate. Filenames are user-controlled
  // so we just lowercase + strip whitespace for the slug.
  const id = `name:${name.toLowerCase().trim().replace(/\s+/g, '_')}`;
  return saveMission({
    id,
    name,
    mizBlob,
    snapshot: snapshotStores(),
  });
}

/**
 * Load an entry by id and hydrate every store. Returns true on
 * success, false when the entry is missing OR its schemaVersion is
 * newer than this build knows how to read.
 *
 * The mission_text round-trip is via the backend: we re-upload the
 * blob to /api/upload, take the parsed response, and feed it to
 * missionStore.loadMission. The .miz blob never leaves the user's
 * browser permanently — it's just bouncing through the in-memory
 * Flask session.
 */
export async function loadLibraryEntry(id: string): Promise<boolean> {
  const entry = await loadMission(id);
  if (!entry) return false;

  // Upload the blob to the backend to get a session + parsed mission.
  const file = new File([entry.mizBlob], entry.name, { type: 'application/octet-stream' });
  let parsed: unknown;
  try {
    parsed = await uploadMission(file);
  } catch (e) {
    console.error('Mission library: re-upload failed', e);
    return false;
  }
  // missionStore.loadMission expects an UploadResponse shape — pass through.
  try {
    useMissionStore.getState().loadMission(parsed as never);
  } catch (e) {
    console.error('Mission library: hydrate missionStore failed', e);
    return false;
  }

  // Hydrate the peripheral stores from the snapshot. Each one wrapped
  // so a single field failure (corrupted entry, store shape changed)
  // doesn't block the others. The user gets a partially-restored
  // session rather than a hard failure.
  const snap = entry.snapshot;
  try {
    if (Array.isArray(snap.edits)) {
      useEditStore.setState({ edits: snap.edits as never });
    }
  } catch (e) { console.warn('hydrate edits failed', e); }
  try {
    if (Array.isArray(snap.triggerRules)) {
      useTriggerStore.setState({
        rules: snap.triggerRules as never,
        loaded: true,
        isDirty: snap.triggerRules.length > 0,
      });
    }
  } catch (e) { console.warn('hydrate triggers failed', e); }
  try {
    if (snap.sopActiveId !== undefined) {
      useSopStore.setState({ activeId: snap.sopActiveId });
    }
  } catch (e) { console.warn('hydrate sop failed', e); }
  try {
    if (Array.isArray(snap.visibilityHidden)) {
      useVisibilityStore.setState({
        hiddenForParticipants: new Set(snap.visibilityHidden),
      });
    }
  } catch (e) { console.warn('hydrate visibility failed', e); }
  try {
    if (Array.isArray(snap.goals)) {
      useGoalsStore.setState({ goals: snap.goals as never });
    }
  } catch (e) { console.warn('hydrate goals failed', e); }
  try {
    if (Array.isArray(snap.dmpis)) {
      useDmpiStore.setState({ dmpis: snap.dmpis as never });
    }
  } catch (e) { console.warn('hydrate dmpis failed', e); }
  try {
    if (typeof snap.selectedGroupId === 'number' || snap.selectedGroupId === null) {
      useMissionStore.getState().selectGroup(snap.selectedGroupId);
    }
  } catch (e) { console.warn('hydrate selectedGroup failed', e); }

  // Best-effort LRU bump — fire-and-forget so the UI doesn't wait
  // for the disk write before navigating into the editor.
  void touchMission(id);
  return true;
}
