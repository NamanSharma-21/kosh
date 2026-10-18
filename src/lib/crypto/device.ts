/**
 * Optional "keep unlocked on this device".
 *
 * Stores the already-imported, NON-EXTRACTABLE CryptoKeys in IndexedDB. Scripts
 * on the page can still use them while the app is open, but the raw key bytes
 * can't be read back out, and clearing site data (or pressing Lock) removes them.
 */
import type { Unlocked } from './vault';

const DB_NAME = 'kosh-device';
const STORE = 'keys';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveDeviceKeys(userId: string, keys: Unlocked): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await run('readwrite', (s) => s.put(keys, userId));
}

export async function loadDeviceKeys(userId: string): Promise<Unlocked | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    return ((await run('readonly', (s) => s.get(userId))) as Unlocked | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function clearDeviceKeys(userId?: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    await run('readwrite', (s) => (userId ? s.delete(userId) : s.clear()));
  } catch {
    /* nothing to clear */
  }
}
