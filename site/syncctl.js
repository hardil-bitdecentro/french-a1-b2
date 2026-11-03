// Sync controller: pairing, pull → merge → push with conflict retry, and the word deck.
// No DOM access, so it can be tested in Node with an in-memory storage and the real Worker.
import { deriveKeys, client, newSyncKey, validSyncKey, pairLink } from './sync.js';
import { merge, differs } from './store.js';

export const SYNC_KEY_STORAGE = 'fr-a1-b2:sync-key';

/**
 * opts: { url, storage, getState, setState, getDeck, setDeck, onStatus, fetchImpl, debounceMs }
 * setState must NOT schedule another sync (it is called with merged data from the server).
 */
export function createSync(opts) {
  const {
    url,
    storage,
    getState,
    setState,
    getDeck,
    setDeck,
    onStatus = () => {},
    fetchImpl,
    debounceMs = 15000,
  } = opts;
  let key = storage.getItem(SYNC_KEY_STORAGE);
  let api = null;
  let timer = null;
  let running = null;
  let lastOk = null;

  const status = (s, extra = {}) => onStatus({ state: s, lastOk, ...extra });

  async function connect() {
    if (!url || !key) return false;
    api = client(url, await deriveKeys(key), fetchImpl);
    return true;
  }

  async function syncState() {
    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await api.get('state');
      const local = getState();
      const merged = merge(local, remote ? remote.value : {});
      if (differs(local, merged)) setState(merged);
      if (remote && !differs(remote.value, merged)) return; // server already has everything
      const res = await api.put('state', merged, remote ? remote.v : null);
      if (res.ok) return;
    }
    throw new Error('sync: too many concurrent writes');
  }

  async function syncDeck() {
    const local = await getDeck();
    if (local) {
      const remote = await api.get('deck');
      if (!remote) await api.put('deck', stripDeck(local), null);
    } else {
      const remote = await api.get('deck');
      if (remote) await setDeck(remote.value);
    }
  }

  async function run({ deck = false } = {}) {
    if (!api && !(await connect())) return;
    status('syncing');
    try {
      await syncState();
      if (deck) await syncDeck();
      lastOk = Date.now();
      status('ok');
    } catch (err) {
      status('error', { error: String(err.message || err) });
    }
  }

  function syncNow(o) {
    if (!running) running = run(o).finally(() => (running = null));
    return running;
  }

  return {
    get enabled() {
      return !!key;
    },
    get configured() {
      return !!url;
    },
    get key() {
      return key;
    },
    /** First device: create a key and upload state + deck. */
    async enable() {
      key = newSyncKey();
      storage.setItem(SYNC_KEY_STORAGE, key);
      api = null;
      await syncNow({ deck: true });
      return key;
    },
    /** Other devices: accept a key (or a full pairing link) and download everything. */
    async pair(input) {
      const k = String(input || '')
        .trim()
        .replace(/^.*#\/pair\//, '');
      if (!validSyncKey(k)) throw new Error('That is not a valid sync code.');
      key = k;
      storage.setItem(SYNC_KEY_STORAGE, key);
      api = null;
      await syncNow({ deck: true });
    },
    disable() {
      key = null;
      api = null;
      storage.removeItem(SYNC_KEY_STORAGE);
      clearTimeout(timer);
      status('off');
    },
    link(baseUrl) {
      return key ? pairLink(baseUrl, key) : null;
    },
    syncNow,
    /** Call after every local change; batches writes (Workers KV allows ~1,000 writes/day on the free plan). */
    schedule() {
      if (!key || !url) return;
      clearTimeout(timer);
      timer = setTimeout(() => syncNow(), debounceMs);
    },
    flush() {
      if (!timer) return Promise.resolve();
      clearTimeout(timer);
      timer = null;
      return syncNow();
    },
  };
}

/** Drop runtime-only fields (like the rank index) before uploading the deck. */
function stripDeck(deck) {
  const { _byRank, ...rest } = deck;
  return rest;
}
