/* A tiny IndexedDB key/value store.
   Same shape as the storage API the Claude artifact used, so the app code
   barely changes — but this one is yours, on your phone, and holds far more
   than localStorage would (hundreds of garment photos, not a handful). */

const DB_NAME = "archive";
const STORE = "kv";
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbp;
}

function tx(mode, fn) {
  return db().then(
    (d) =>
      new Promise((res, rej) => {
        const t = d.transaction(STORE, mode);
        const s = t.objectStore(STORE);
        const r = fn(s);
        t.oncomplete = () => res(r && "result" in r ? r.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      })
  );
}

export async function kvGet(key) {
  try {
    const v = await tx("readonly", (s) => s.get(key));
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

export async function kvSet(key, value) {
  try {
    await tx("readwrite", (s) => s.put(value, key));
    return true;
  } catch (e) {
    // Almost always a quota error: the device is out of room for photos.
    console.error("Could not save", key, e);
    return false;
  }
}

export async function kvDel(key) {
  try {
    await tx("readwrite", (s) => s.delete(key));
    return true;
  } catch {
    return false;
  }
}

export async function kvKeys() {
  try {
    return (await tx("readonly", (s) => s.getAllKeys())) || [];
  } catch {
    return [];
  }
}

/** Roughly how much room the wardrobe is using, for the settings screen. */
export async function usage() {
  if (!navigator.storage?.estimate) return null;
  const { usage: u = 0, quota: q = 0 } = await navigator.storage.estimate();
  return { usedMB: +(u / 1048576).toFixed(1), quotaMB: +(q / 1048576).toFixed(0) };
}

/** Ask the browser not to evict the wardrobe when storage runs low. */
export async function makePersistent() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}
