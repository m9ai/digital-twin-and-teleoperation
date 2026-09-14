/**
 * Persistent byte-level cache for robot meshes.
 *
 * A Service Worker can only intercept network requests, but most meshes in
 * this app arrive through `blob:` URLs created from user uploads — invisible
 * to the SW. This IndexedDB store covers both cases and is what makes a second
 * load of the same model feel instant (and work offline).
 *
 * Everything here is best-effort: if IndexedDB is unavailable (private mode,
 * quota) the loader silently falls back to a plain fetch.
 */

const DB_NAME = 'robot-mesh-cache';
const DB_VERSION = 1;
const STORE = 'meshes';
/** LRU-ish cap; meshes are large, so keep the store bounded. */
const MAX_ENTRIES = 120;

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryFallback = new Map<string, ArrayBuffer>();

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const transaction = db.transaction(STORE, mode);
          const request = run(transaction.objectStore(STORE));
          request.onsuccess = () => resolve((request.result as T) ?? null);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

export interface MeshCacheEntry {
  key: string;
  bytes: ArrayBuffer;
  size: number;
  savedAt: number;
}

export async function readMeshCache(key: string): Promise<ArrayBuffer | null> {
  const entry = await tx<MeshCacheEntry>('readonly', (store) => store.get(key) as IDBRequest<MeshCacheEntry | undefined>);
  if (entry?.bytes) return entry.bytes;
  return memoryFallback.get(key) ?? null;
}

export async function writeMeshCache(key: string, bytes: ArrayBuffer): Promise<void> {
  memoryFallback.set(key, bytes);

  const db = await openDatabase();
  if (!db) return;

  try {
    await tx('readwrite', (store) =>
      store.put({ key, bytes, size: bytes.byteLength, savedAt: Date.now() } satisfies MeshCacheEntry)
    );
    await pruneMeshCache();
  } catch {
    // Quota exceeded or unavailable: the in-memory copy is still useful.
  }
}

/** Drop the oldest entries once the store grows past `MAX_ENTRIES`. */
async function pruneMeshCache(): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  try {
    const all = await tx<MeshCacheEntry[]>('readonly', (store) => store.getAll() as IDBRequest<MeshCacheEntry[]>);
    if (!all || all.length <= MAX_ENTRIES) return;

    const stale = all.sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0)).slice(0, all.length - MAX_ENTRIES);
    for (const entry of stale) {
      await tx('readwrite', (store) => store.delete(entry.key));
    }
  } catch {
    // ignore
  }
}

export async function clearMeshCache(): Promise<void> {
  memoryFallback.clear();
  await tx('readwrite', (store) => store.clear());
}

export async function meshCacheStats(): Promise<{ entries: number; bytes: number }> {
  const all = await tx<MeshCacheEntry[]>('readonly', (store) => store.getAll() as IDBRequest<MeshCacheEntry[]>);
  if (!all) return { entries: memoryFallback.size, bytes: 0 };
  return {
    entries: all.length,
    bytes: all.reduce((sum, entry) => sum + (entry.size ?? 0), 0),
  };
}
