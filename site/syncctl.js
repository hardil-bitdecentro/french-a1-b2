// Sync controller: pairing, pull → merge → push with conflict retry, and the word deck.
// No DOM access, so it can be tested in Node with an in-memory storage and the real Worker.
import { deriveKeys, client, newSyncKey, validSyncKey, pairLink } from './sync.js';
import { merge, differs, setting, setSetting } from './store.js';

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

  /**
   * The deck is big, so it only moves when needed. The synced state carries two timestamps:
   * "deckAt" (newest import on any device) and "deckUp" (newest import that reached the server).
   * full = true (pairing / turning sync on) also handles decks imported before those existed.
   * Returns true when it changed the state (so the caller pushes the state again).
   */
  async function syncDeck(full) {
    const local = await getDeck();
    const state = getState();
    const wantAt = setting(state, 'deckAt', 0);
    const upAt = setting(state, 'deckUp', 0);
    const localAt = (local && local.importedAt) || 0;
    if (local && localAt && localAt >= wantAt && localAt > upAt) {
      await api.put('deck', stripDeck(local), '*');
      setState(setSetting(setSetting(state, 'deckAt', localAt), 'deckUp', localAt));
      return true;
    }
    if (local && localAt >= wantAt && !full) return false;
    if (!local || localAt < wantAt) {
      if (!full && upAt < wantAt) return false; // the newer deck hasn't been uploaded yet; try next time
      const remote = await api.get('deck');
      if (remote && (remote.value.importedAt || 0) >= localAt) await setDeck(remote.value);
      return false;
    }
    // full sync with a legacy local deck: make sure the server has a copy
    const remote = await api.get('deck');
    if (!remote) await api.put('deck', stripDeck(local), '*');
    return false;
  }

  async function run({ deck = true, full = false } = {}) {
    if (!api && !(await connect())) return;
    status('syncing');
    try {
      await syncState();
      if (deck && (await syncDeck(full))) await syncState();
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
      await syncNow({ full: true });
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
      await syncNow({ full: true });
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
