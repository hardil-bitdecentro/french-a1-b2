import { describe, expect, it } from 'vitest';
import { createSync, SYNC_KEY_STORAGE } from '../site/syncctl.js';
import {
  emptyState,
  setDone,
  setNote,
  doneIds,
  noteText,
  putCard,
  liveCards,
  setSetting,
  applyReset,
} from '../site/store.js';
import worker from '../worker/src/index.js';

const ORIGIN = 'https://hardil-bitdecentro.github.io';

function memoryKV() {
  const m = new Map();
  return {
    get: async (k, type) => (m.has(k) ? (type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => void m.set(k, v),
  };
}

function storage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

/** One simulated device: its own local state, deck and storage, talking to the shared Worker. */
function device(env, deck = null, prune = undefined) {
  const d = { state: emptyState(), deck, statuses: [] };
  d.sync = createSync({
    url: 'https://sync.example',
    storage: storage(),
    getState: () => d.state,
    setState: (s) => (d.state = s),
    getDeck: async () => d.deck,
    setDeck: async (x) => (d.deck = x),
    onStatus: (s) => d.statuses.push(s.state),
    fetchImpl: (url, init = {}) =>
      worker.fetch(new Request(url, { ...init, headers: { ...(init.headers || {}), Origin: ORIGIN } }), env),
    debounceMs: 0,
    prune,
  });
  return d;
}

describe('two devices syncing through the Worker', () => {
  it('pairs a phone with the laptop and copies progress and the deck', async () => {
    const env = { SYNC: memoryKV(), ALLOWED_ORIGINS: ORIGIN };
    const laptop = device(env, { name: 'deck', words: [{ r: 0, w: 'de', a: 'de', m: 'of', g: '' }] });
    setDone(laptop.state, '2026-11-04', 'book', true, 100);
    const key = await laptop.sync.enable();

    const phone = device(env);
    await phone.sync.pair(`https://x.github.io/french-a1-b2/#/pair/${key}`);
    expect(doneIds(phone.state, '2026-11-04')).toEqual(['book']);
    expect(phone.deck.words[0].m).toBe('of');
    expect(phone.statuses.at(-1)).toBe('ok');
  });

  it('merges edits made on both devices', async () => {
    const env = { SYNC: memoryKV(), ALLOWED_ORIGINS: ORIGIN };
    const laptop = device(env);
    const key = await laptop.sync.enable();
    const phone = device(env);
    await phone.sync.pair(key);

    setDone(laptop.state, '2026-11-04', 'book', true, 200);
    setNote(phone.state, '2026-11-04', 'je suis allé', 210);
    putCard(phone.state, { id: 'm1', kind: 'mine', front: 'le loyer', back: 'rent', s: {} }, 220);
    await laptop.sync.syncNow();
    await phone.sync.syncNow();
    await laptop.sync.syncNow();

    for (const d of [laptop, phone]) {
      expect(doneIds(d.state, '2026-11-04')).toEqual(['book']);
      expect(noteText(d.state, '2026-11-04')).toBe('je suis allé');
      expect(liveCards(d.state).map((c) => c.front)).toEqual(['le loyer']);
    }
  });

  it('sends a re-imported deck (e.g. with sentences) to the other device on a normal sync', async () => {
    const env = { SYNC: memoryKV(), ALLOWED_ORIGINS: ORIGIN };
    const laptop = device(env, { name: 'v1', words: [{ r: 0, w: 'de', a: 'de', m: 'of', g: '' }] });
    const key = await laptop.sync.enable();
    const phone = device(env);
    await phone.sync.pair(key);
    expect(phone.deck.name).toBe('v1');

    // Re-import on the laptop (what the app's setDeck does): new deck + newer "deckAt" in the state.
    laptop.deck = {
      name: 'v2',
      importedAt: 5000,
      words: laptop.deck.words,
      sentences: [['Est-ce vous ?', 'Is it you?', 'b']],
    };
    setSetting(laptop.state, 'deckAt', 5000, 5000);
    await laptop.sync.syncNow();
    await phone.sync.syncNow();
    expect(phone.deck.name).toBe('v2');
    expect(phone.deck.sentences).toHaveLength(1);

    // Afterwards neither device keeps downloading the deck.
    let deckGets = 0;
    const orig = env.SYNC.get;
    env.SYNC.get = async (k, t) => {
      if (k.endsWith(':deck')) deckGets++;
      return orig(k, t);
    };
    await phone.sync.syncNow();
    await laptop.sync.syncNow();
    expect(deckGets).toBe(0);
  });

  it('a reset sticks: old progress on the server cannot come back, and the server copy gets cleaned', async () => {
    const env = { SYNC: memoryKV(), ALLOWED_ORIGINS: ORIGIN };
    const AT = 1000;
    const laptop = device(env);
    setDone(laptop.state, '2026-11-04', 'book', true, 900); // synced before the reset
    const key = await laptop.sync.enable();

    // A phone on the new app version: it applies the reset to whatever sync brings in.
    const phone = device(env, null, (s) => applyReset(s, AT));
    await phone.sync.pair(key);
    expect(doneIds(phone.state, '2026-11-04')).toEqual([]);

    // The server copy no longer has it either, so an old-free device stays clean.
    const fresh = device(env);
    await fresh.sync.pair(key);
    expect(doneIds(fresh.state, '2026-11-04')).toEqual([]);

    // New progress still syncs normally.
    setDone(phone.state, '2026-11-06', 'book', true, 2000);
    await phone.sync.syncNow();
    await fresh.sync.syncNow();
    expect(doneIds(fresh.state, '2026-11-06')).toEqual(['book']);
  });

  it('rejects a bad pairing code and can be turned off', async () => {
    const env = { SYNC: memoryKV(), ALLOWED_ORIGINS: ORIGIN };
    const phone = device(env);
    await expect(phone.sync.pair('not-a-code')).rejects.toThrow('not a valid sync code');
    await phone.sync.enable();
    expect(phone.sync.enabled).toBe(true);
    phone.sync.disable();
    expect(phone.sync.enabled).toBe(false);
  });

  it('does nothing when no server is configured', async () => {
    const s = createSync({
      url: '',
      storage: storage(),
      getState: emptyState,
      setState: () => {},
      getDeck: async () => null,
      setDeck: async () => {},
    });
    expect(s.configured).toBe(false);
    await s.syncNow();
    expect(SYNC_KEY_STORAGE).toBe('fr-a1-b2:sync-key');
  });
});
