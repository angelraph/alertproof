// Everything lives in IndexedDB on this device only: the trader's alerts, settings and
// the payments they're waiting on. Nothing is sent anywhere.

let DB = 'alertproof';
export const useDb = name => { DB = name; };
const STORES = ['alerts', 'meta'];

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('alerts', { keyPath: 'id' });
      req.result.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  if (!STORES.includes(store)) throw new Error(store);
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const saveAlert = a => tx('alerts', 'readwrite', s => s.put(a));
export const deleteAlert = id => tx('alerts', 'readwrite', s => s.delete(id));
export const listAlerts = async () => (await tx('alerts', 'readonly', s => s.getAll())).sort((a, b) => a.addedAt - b.addedAt);
export const clearAlerts = () => tx('alerts', 'readwrite', s => s.clear());

export const getMeta = async (key, fallback) => (await tx('meta', 'readonly', s => s.get(key)))?.value ?? fallback;
export const setMeta = (key, value) => tx('meta', 'readwrite', s => s.put({ key, value }));
