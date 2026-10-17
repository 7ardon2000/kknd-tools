/** Remembers the player's SPRITES.LVL in this browser (IndexedDB), so it is only chosen once. */

const DB = 'kknd-battle';
const STORE = 'gamefiles';
const KEY = 'sprites.lvl';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Stored SPRITES.LVL bytes, or null (also when storage is unavailable). */
export async function loadStored() {
  try {
    const v = await run('readonly', (s) => s.get(KEY));
    return v ? new Uint8Array(v) : null;
  } catch {
    return null;
  }
}

export async function store(bytes) {
  try {
    await run('readwrite', (s) => s.put(bytes.slice().buffer, KEY));
  } catch {
    // private window or blocked storage: it is asked for again next time
  }
}

export async function forget() {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    // nothing stored
  }
}
