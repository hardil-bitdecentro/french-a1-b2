// IndexedDB key-value store for large data (the imported word deck), browser only.
const DB = 'fr-a1-b2';
const STORE = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const idbGet = (key) => run('readonly', (s) => s.get(key));
export const idbSet = (key, value) => run('readwrite', (s) => s.put(value, key));
export const idbDel = (key) => run('readwrite', (s) => s.delete(key));
