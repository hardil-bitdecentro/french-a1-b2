import { describe, expect, it } from 'vitest';
import { newSyncKey, validSyncKey, deriveKeys, seal, open, pairLink, client } from '../site/sync.js';
import worker from '../worker/src/index.js';

function memoryKV() {
  const m = new Map();
  return {
    async get(k, type) {
      const v = m.get(k);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) {
      m.set(k, v);
    },
    raw: m,
  };
}

describe('sync keys and encryption', () => {
  it('generates 32-byte keys and rejects malformed ones', () => {
    const k = newSyncKey();
    expect(validSyncKey(k)).toBe(true);
    expect(validSyncKey('short')).toBe(false);
    expect(validSyncKey(k + 'x')).toBe(false);
  });

  it('derives the same id/token from the same key, different from another key', async () => {
    const k = newSyncKey();
    const a = await deriveKeys(k);
    const b = await deriveKeys(k);
    const c = await deriveKeys(newSyncKey());
    expect(a.id).toBe(b.id);
    expect(a.token).toBe(b.token);
    expect(a.id).not.toBe(c.id);
    expect(a.id).not.toBe(a.token);
    expect(a.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('round-trips data, and the wrong key cannot open it', async () => {
    const keys = await deriveKeys(newSyncKey());
    const value = { notes: { '2026-11-04': ['je suis allé', 1] }, big: 'x'.repeat(50000) };
    const sealed = await seal(keys.aes, value);
    expect(sealed).not.toContain('je suis');
    expect(sealed.length).toBeLessThan(5000); // gzip before encryption
    expect(await open(keys.aes, sealed)).toEqual(value);
    const other = await deriveKeys(newSyncKey());
    await expect(open(other.aes, sealed)).rejects.toThrow();
  });

  it('puts the key in the #fragment of the pairing link', () => {
    const k = newSyncKey();
    expect(pairLink('https://x.github.io/app/#/today', k)).toBe(`https://x.github.io/app/#/pair/${k}`);
  });
});

describe('sync client ↔ worker', () => {
  const ORIGIN = 'https://hardil-bitdecentro.github.io';
  const setup = () => {
    const env = { SYNC: memoryKV(), ALLOWED_ORIGINS: ORIGIN };
    const fetchImpl = (url, init = {}) =>
      worker.fetch(new Request(url, { ...init, headers: { ...(init.headers || {}), Origin: ORIGIN } }), env);
    return { env, fetchImpl };
  };

  it('stores only ciphertext and reads it back', async () => {
    const { env, fetchImpl } = setup();
    const keys = await deriveKeys(newSyncKey());
    const c = client('https://sync.example', keys, fetchImpl);
    expect(await c.get('state')).toBeNull();
    expect(await c.put('state', { hello: 'bonjour' }, null)).toEqual({ ok: true, v: 1 });
    expect(await c.get('state')).toEqual({ v: 1, value: { hello: 'bonjour' } });
    const stored = [...env.SYNC.raw.values()].join(' ');
    expect(stored).not.toContain('bonjour');
    expect(stored).not.toContain(keys.token); // only its hash is kept
  });

  it('detects a concurrent write (409) so the client can merge and retry', async () => {
    const { fetchImpl } = setup();
    const keys = await deriveKeys(newSyncKey());
    const c = client('https://sync.example', keys, fetchImpl);
    await c.put('state', { a: 1 }, null);
    await c.put('state', { a: 2 }, 1);
    expect(await c.put('state', { a: 3 }, 1)).toEqual({ conflict: true, v: 2 });
  });

  it('refuses a different token for the same id', async () => {
    const { env, fetchImpl } = setup();
    const keys = await deriveKeys(newSyncKey());
    await client('https://sync.example', keys, fetchImpl).put('state', { a: 1 }, null);
    const thief = { ...keys, token: 'f'.repeat(64) };
    await expect(client('https://sync.example', thief, fetchImpl).get('state')).rejects.toThrow('403');
    const r = await worker.fetch(new Request(`https://sync.example/v1/${keys.id}/state`), env);
    expect(r.status).toBe(401);
  });

  it('only answers CORS for the app’s own origin', async () => {
    const { env } = setup();
    const ok = await worker.fetch(
      new Request('https://sync.example/v1/x', { method: 'OPTIONS', headers: { Origin: ORIGIN } }),
      env,
    );
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const evil = await worker.fetch(
      new Request('https://sync.example/v1/x', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }),
      env,
    );
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rejects unknown paths and oversized bodies', async () => {
    const { env } = setup();
    const keys = await deriveKeys(newSyncKey());
    const auth = { Authorization: `Bearer ${keys.token}` };
    expect((await worker.fetch(new Request('https://sync.example/v1/abc/state', { headers: auth }), env)).status).toBe(
      404,
    );
    const big = await worker.fetch(
      new Request(`https://sync.example/v1/${keys.id}/state`, {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({ base: null, data: 'x'.repeat(3 * 1024 * 1024) }),
      }),
      env,
    );
    expect(big.status).toBe(413);
  });
});
