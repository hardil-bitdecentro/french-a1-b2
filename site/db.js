// IndexedDB for large data: the imported word deck, and voice recordings. Browser only.
const DB = 'fr-a1-b2';
const STORE = 'kv';
const CLIPS = 'clips';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(CLIPS)) db.createObjectStore(CLIPS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => {
      db.close();
      resolve(req && req.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export const idbGet = (key) => run(STORE, 'readonly', (s) => s.get(key));
export const idbSet = (key, value) => run(STORE, 'readwrite', (s) => s.put(value, key));
export const idbDel = (key) => run(STORE, 'readwrite', (s) => s.delete(key));

export const clipPut = (clip) => run(CLIPS, 'readwrite', (s) => s.put(clip));
export const clipAll = () => run(CLIPS, 'readonly', (s) => s.getAll());
export const clipDel = (id) => run(CLIPS, 'readwrite', (s) => s.delete(id));
