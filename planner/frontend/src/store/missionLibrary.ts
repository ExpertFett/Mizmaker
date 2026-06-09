/**
 * Mission Library — client-side multi-mission save/restore via
 * IndexedDB (task #56, v1.19.73).
 *
 * Why IndexedDB and not the backend?
 *   Mission .miz blobs are private + the landing page promises
 *   "nothing is stored on our servers." Per-browser local storage
 *   gives a user 20+ missions of recall without compromising that
 *   guarantee, at zero cost. Cross-device sync (Supabase Storage
 *   bucket gated by Discord auth) is a v2 follow-up, not v1.
 *
 * Scope (Tier A — what ships in this commit):
 *   - .miz blob + a snapshot of every Zustand store the user might
 *     have edited (editStore queue, sop selection, visibility,
 *     goals, dmpis, selected tab/group) so they pick up exactly
 *     where they left off, not just "the same .miz".
 *   - "My Missions" page (Phase B) lists the most-recent 20 with
 *     name / last-opened / edit count / size / open + delete.
 *   - LRU evict at 21 entries so the IndexedDB footprint stays
 *     bounded.
 *   - Schema-version guard (`schemaVersion: 1`) so a future format
 *     bump can either migrate or warn instead of crashing.
 *
 * Deferred to v2:
 *   - Server-side sync (Supabase Storage)
 *   - Schema migrators (we just version-gate for now)
 *   - Multi-tab single-writer lock (single tab assumed)
 *
 * No external dep — we wrap idbRequest in a tiny promise helper.
 * The full `idb` package would be ~3 KB gz, but for one object
 * store with five methods the boilerplate isn't worth the import.
 */

const DB_NAME = 'dcsopt.missionLibrary';
const DB_VERSION = 1;
const STORE = 'missions';
const INDEX_LAST_OPENED = 'lastOpenedAt';
const MAX_ENTRIES = 20;

export const MISSION_LIBRARY_SCHEMA_VERSION = 1;

/**
 * Snapshot of the per-mission Zustand state the user might want to
 * pick up where they left off. All fields are best-effort — restore
 * never throws on a missing field, just falls back to the empty
 * value the store would have on a fresh upload.
 */
export interface MissionSnapshot {
  /** editStore.edits — the queued unit/group/mission edits. */
  edits: unknown[];
  /** triggerStore.rules — full rules array after any user edits. */
  triggerRules: unknown[];
  /** sopStore.activeId — which SOP is selected (null = none). */
  sopActiveId: string | null;
  /** visibilityStore.hiddenForParticipants as a serialised number[]. */
  visibilityHidden: number[];
  /** goalsStore.goals — mission objectives list. */
  goals: unknown[];
  /** dmpiStore.dmpis — target markers list. */
  dmpis: unknown[];
  /** mapStore-ish: which editor tab was last selected. */
  selectedTab: string | null;
  /** missionStore.selectedGroupId — which group had focus. */
  selectedGroupId: number | null;
}

export interface MissionLibraryEntry {
  id: string;
  name: string;
  mizBlob: Blob;
  savedAt: number;
  lastOpenedAt: number;
  size: number;
  snapshot: MissionSnapshot;
  schemaVersion: number;
}

/**
 * Promisify an IDBRequest. Returns the result on success, rejects
 * with the error on failure. All public functions below use this so
 * the call sites look like normal async/await.
 */
function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Open (and lazily create) the IndexedDB. The onupgradeneeded
 * handler runs on first install AND on any DB_VERSION bump — we
 * only have one version so it just creates the store.
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        // Index for LRU eviction + "Recent Missions" sort.
        store.createIndex(INDEX_LAST_OPENED, INDEX_LAST_OPENED, { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function emptySnapshot(): MissionSnapshot {
  return {
    edits: [],
    triggerRules: [],
    sopActiveId: null,
    visibilityHidden: [],
    goals: [],
    dmpis: [],
    selectedTab: null,
    selectedGroupId: null,
  };
}

/**
 * Save / update a mission. If `id` already exists, the entry is
 * replaced and `savedAt` is preserved; if it's new, both savedAt
 * and lastOpenedAt are set to now.
 *
 * After the put, runs LRU eviction so the store never exceeds
 * MAX_ENTRIES.
 */
export async function saveMission(
  entry: Omit<MissionLibraryEntry, 'schemaVersion' | 'savedAt' | 'lastOpenedAt' | 'size'> & {
    savedAt?: number;
    lastOpenedAt?: number;
  },
): Promise<MissionLibraryEntry> {
  const db = await openDb();
  try {
    const now = Date.now();
    const full: MissionLibraryEntry = {
      ...entry,
      size: entry.mizBlob.size,
      savedAt: entry.savedAt ?? now,
      lastOpenedAt: entry.lastOpenedAt ?? now,
      schemaVersion: MISSION_LIBRARY_SCHEMA_VERSION,
    };
    {
      const tx = db.transaction(STORE, 'readwrite');
      await reqAsPromise(tx.objectStore(STORE).put(full));
    }
    await evictLru(db);
    return full;
  } finally {
    db.close();
  }
}

/**
 * Load one mission by id. Returns null when not found OR when the
 * entry's schemaVersion is newer than what we understand. (Older
 * versions can be promoted by a future migration pass.)
 */
export async function loadMission(id: string): Promise<MissionLibraryEntry | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const result = await reqAsPromise(tx.objectStore(STORE).get(id));
    if (!result) return null;
    const entry = result as MissionLibraryEntry;
    if (entry.schemaVersion > MISSION_LIBRARY_SCHEMA_VERSION) {
      // Newer schema than this build understands — treat as absent
      // so we don't corrupt state by mis-restoring.
      return null;
    }
    return entry;
  } finally {
    db.close();
  }
}

/**
 * List all stored missions, ordered most-recently-opened first.
 * Use this to populate the "My Missions" page.
 */
export async function listMissions(): Promise<MissionLibraryEntry[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const all = await reqAsPromise(tx.objectStore(STORE).getAll());
    return (all as MissionLibraryEntry[])
      .filter((e) => e.schemaVersion <= MISSION_LIBRARY_SCHEMA_VERSION)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } finally {
    db.close();
  }
}

export async function deleteMission(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await reqAsPromise(tx.objectStore(STORE).delete(id));
  } finally {
    db.close();
  }
}

/**
 * Bump an entry's lastOpenedAt to now. Called when the user opens a
 * recent mission — keeps the LRU ordering meaningful even when the
 * user just reads the .miz back without re-saving edits.
 */
export async function touchMission(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const entry = await reqAsPromise(store.get(id));
    if (!entry) return;
    (entry as MissionLibraryEntry).lastOpenedAt = Date.now();
    await reqAsPromise(store.put(entry));
  } finally {
    db.close();
  }
}

/**
 * LRU eviction. After every save, if we're over MAX_ENTRIES, drop
 * the oldest-by-lastOpenedAt entries until we're back under the cap.
 *
 * Uses the lastOpenedAt index for an in-order cursor walk so we
 * never have to load + sort every entry's full blob in memory.
 */
async function evictLru(db: IDBDatabase): Promise<void> {
  const countTx = db.transaction(STORE, 'readonly');
  const count = await reqAsPromise(countTx.objectStore(STORE).count());
  if (count <= MAX_ENTRIES) return;

  const toEvict = count - MAX_ENTRIES;
  const evictTx = db.transaction(STORE, 'readwrite');
  const store = evictTx.objectStore(STORE);
  const idx = store.index(INDEX_LAST_OPENED);
  return new Promise<void>((resolve, reject) => {
    let evicted = 0;
    const cursorReq = idx.openCursor(); // ascending by lastOpenedAt → oldest first
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || evicted >= toEvict) {
        resolve();
        return;
      }
      cursor.delete();
      evicted++;
      cursor.continue();
    };
  });
}

/**
 * Smoke-grade reset for tests / debugging. Deletes the entire
 * database so the next openDb() starts from a clean schema. Not
 * exposed in the UI.
 */
export async function _resetLibrary(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // best-effort; another tab held it open
  });
}

export const MISSION_LIBRARY_MAX = MAX_ENTRIES;
export { emptySnapshot };
