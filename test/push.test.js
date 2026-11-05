import { createDecipheriv, createECDH, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index.js';
import { b64urlDecode, b64urlEncode, encryptPayload, sendPush, vapidAuthorization } from '../worker/src/push.js';
import { createReminders, PUSH_CONFIG_STORAGE, PUSH_DEVICE_STORAGE } from '../site/reminders.js';
import { VAPID_PUBLIC_KEY } from '../site/config.js';
import { createSync } from '../site/syncctl.js';
import { deriveKeys } from '../site/sync.js';
import { emptyState } from '../site/store.js';

const ORIGIN = 'https://hardil-bitdecentro.github.io';
const ID = 'a'.repeat(64);
const TOKEN = 'b'.repeat(64);
const DEVICE = 'c'.repeat(32);
const DEFAULT_SLOTS = [
  { id: 'morning', time: '08:00', on: true },
  { id: 'afternoon', time: '14:00', on: true },
  { id: 'evening', time: '20:30', on: true },
  { id: 'streak', time: '21:30', on: true },
];

const at = (iso) => new Date(iso).getTime();
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

function fakeKV(seed = {}) {
  const m = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const kv = {
    reads: 0,
    writes: 0,
    async get(k, type) {
      kv.reads++;
      if (!m.has(k)) return null;
      return type === 'json' ? JSON.parse(m.get(k)) : m.get(k);
    },
    async put(k, v) {
      kv.writes++;
      m.set(k, v);
    },
    async list() {
      throw new Error('KV list must never be called');
    },
    index: () => JSON.parse(m.get('push:index') || '{}'),
  };
  return kv;
}

/** A browser's push keys, made with node:crypto. */
function newBrowser(endpoint = 'https://push.example/sub/1') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    priv: ecdh.getPrivateKey(),
    pub: ecdh.getPublicKey(),
    auth,
    sub: { endpoint, keys: { p256dh: ecdh.getPublicKey('base64url'), auth: auth.toString('base64url') } },
  };
}

/** The receiving side of RFC 8291, written with node:crypto so that it shares no code with the sender. */
function decryptAsBrowser(message, { priv, pub, auth }) {
  const buf = Buffer.from(message);
  const salt = buf.subarray(0, 16);
  const idLength = buf[20];
  const asPublic = buf.subarray(21, 21 + idLength);
  const ciphertext = buf.subarray(21 + idLength);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(priv);
  const secret = ecdh.computeSecret(asPublic);
  const expand = (s, ikm, info, n) => Buffer.from(hkdfSync('sha256', ikm, s, info, n));
  const ikm = expand(auth, secret, Buffer.concat([Buffer.from('WebPush: info\0'), pub, asPublic]), 32);
  const cek = expand(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = expand(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  let end = plain.length - 1;
  while (plain[end] === 0) end--;
  expect(plain[end]).toBe(2); // the delimiter of a final record
  return plain.subarray(0, end).toString();
}

function pair(x, y) {
  const out = new Uint8Array(x.length + y.length);
  out.set(x);
  out.set(y, x.length);
  return out;
}

let vapid;
beforeAll(async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const { d } = await crypto.subtle.exportKey('jwk', keys.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  vapid = {
    VAPID_PUBLIC_KEY: b64urlEncode(raw),
    VAPID_PRIVATE_KEY: d,
    VAPID_SUBJECT: 'https://hardil-bitdecentro.github.io/french-a1-b2/',
  };
});

/** Replaces the global fetch with a fake push service. statusFor(url) picks the answer; an Error is thrown. */
function fakePushService(statusFor = () => 201) {
  const calls = [];
  vi.stubGlobal('fetch', async (url, init) => {
    calls.push({ url, ...init });
    const status = statusFor(url);
    if (status instanceof Error) throw status;
    return new Response(status === 201 ? null : 'refused', { status });
  });
  return calls;
}

function makeEnv(seed = {}) {
  return { SYNC: fakeKV({ [`${ID}:auth`]: tokenHash(TOKEN), ...seed }), ALLOWED_ORIGINS: ORIGIN, ...vapid };
}

function record(browser, over = {}) {
  return {
    sub: browser.sub,
    tz: 'Europe/Paris',
    slots: DEFAULT_SLOTS,
    quiet: null,
    timer: null,
    lastSent: {},
    ...over,
  };
}

const run = (env, iso) => worker.scheduled({ scheduledTime: at(iso) }, env);

function pushRequest(method, path, { token = TOKEN, body, id = ID, device = DEVICE } = {}) {
  const headers = { Origin: ORIGIN };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const init = { method, headers };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(`https://sync.example/v1/${id}/push/${device}${path}`, init);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RFC 8291 payload encryption', () => {
  // Every value below is copied from RFC 8291 Appendix A. They're published test keys, not secrets.
  const RFC = {
    plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg', // gitleaks:allow
    header:
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
    // The body shown in section 5. Its example says Content-Length: 145, but these bytes are 144.
    message: [
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml',
      'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT',
      'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    ].join(''),
  };

  async function rfcSenderKeys() {
    const pub = b64urlDecode(RFC.asPublic);
    const ecdh = { name: 'ECDH', namedCurve: 'P-256' };
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      d: RFC.asPrivate,
      x: b64urlEncode(pub.subarray(1, 33)),
      y: b64urlEncode(pub.subarray(33, 65)),
    };
    return {
      privateKey: await crypto.subtle.importKey('jwk', jwk, ecdh, true, ['deriveBits']),
      publicKey: await crypto.subtle.importKey('raw', pub, ecdh, true, []),
    };
  }

  it('reproduces the Appendix A message byte for byte', async () => {
    const message = await encryptPayload(
      b64urlDecode(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { salt: b64urlDecode(RFC.salt), keyPair: await rfcSenderKeys() },
    );
    expect(b64urlDecode(RFC.header).length).toBe(86);
    expect(b64urlEncode(message.subarray(0, 86))).toBe(RFC.header);
    expect(b64urlEncode(message.subarray(86))).toBe(RFC.ciphertext);
    expect(b64urlEncode(message)).toBe(RFC.message);
  });

  it('has a receiver that opens the Appendix A message', () => {
    const message = pair(b64urlDecode(RFC.header), b64urlDecode(RFC.ciphertext));
    const plain = decryptAsBrowser(message, {
      priv: Buffer.from(b64urlDecode(RFC.uaPrivate)),
      pub: Buffer.from(b64urlDecode(RFC.uaPublic)),
      auth: Buffer.from(b64urlDecode(RFC.auth)),
    });
    expect(plain).toBe('When I grow up, I want to be a watermelon');
  });

  it('round-trips through the receiver, with accents, and differs every time', async () => {
    const browser = newBrowser();
    const text = JSON.stringify({ title: "C'est l'heure", body: 'Révise les verbes à être' });
    const a = await encryptPayload(text, browser.sub.keys);
    const b = await encryptPayload(text, browser.sub.keys);
    expect(decryptAsBrowser(a, browser)).toBe(text);
    expect(decryptAsBrowser(b, browser)).toBe(text);
    expect(b64urlEncode(a.subarray(0, 16))).not.toBe(b64urlEncode(b.subarray(0, 16)));
    expect(new DataView(a.buffer, a.byteOffset).getUint32(16)).toBe(4096);
    expect(a[20]).toBe(65);
  });

  it('cannot be opened with another subscription or the wrong auth secret', async () => {
    const browser = newBrowser();
    const message = await encryptPayload('secret', browser.sub.keys);
    expect(() => decryptAsBrowser(message, newBrowser())).toThrow();
    expect(() => decryptAsBrowser(message, { ...browser, auth: randomBytes(16) })).toThrow();
  });
});

describe('VAPID', () => {
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc:def';

  function parts(header) {
    const m = header.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(m).not.toBeNull();
    const [head, claims, signature] = m[1].split('.');
    const decode = (s) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
    return { head: decode(head), claims: decode(claims), signature, signed: `${head}.${claims}`, k: m[2] };
  }

  const verify = async (signature, signed) => {
    const key = await crypto.subtle.importKey(
      'raw',
      b64urlDecode(vapid.VAPID_PUBLIC_KEY),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(signed);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlDecode(signature), data);
  };

  it('signs a JWT that verifies with WebCrypto, with the right claims', async () => {
    const now = at('2026-11-05T12:00:00Z');
    const { head, claims, signature, signed, k } = parts(await vapidAuthorization(ENDPOINT, vapid, now));
    expect(head).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.exp).toBe(now / 1000 + 12 * 3600);
    expect(claims.sub).toBe(vapid.VAPID_SUBJECT);
    expect(k).toBe(vapid.VAPID_PUBLIC_KEY);
    expect(b64urlDecode(signature).length).toBe(64); // raw r||s, not DER
    expect(await verify(signature, signed)).toBe(true);
  });

  it('produces a signature that fails for changed claims', async () => {
    const { signature, signed } = parts(await vapidAuthorization(ENDPOINT, vapid));
    expect(await verify(signature, `${signed}x`)).toBe(false);
  });

  it('sends the required headers and an encrypted body', async () => {
    const calls = fakePushService();
    const browser = newBrowser(ENDPOINT);
    const result = await sendPush(browser.sub, { title: 'Hi' }, vapid);
    expect(result).toEqual({ ok: true, status: 201, detail: '' });
    const [{ url, method, headers, body }] = calls;
    expect(url).toBe(ENDPOINT);
    expect(method).toBe('POST');
    expect(headers.TTL).toBe('3600');
    expect(headers.Urgency).toBe('high');
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(JSON.parse(decryptAsBrowser(body, browser))).toEqual({ title: 'Hi' });
  });

  it('reports the status and error text of a refusal without throwing', async () => {
    fakePushService(() => 403);
    expect(await sendPush(newBrowser().sub, {}, vapid)).toEqual({ ok: false, status: 403, detail: 'refused' });
  });
});

describe('push routes', () => {
  const body = (browser = newBrowser(), over = {}) => ({
    sub: browser.sub,
    tz: 'Europe/Paris',
    slots: DEFAULT_SLOTS,
    quiet: null,
    timer: null,
    ...over,
  });

  describe('auth', () => {
    const attempts = [
      ['PUT', ''],
      ['DELETE', ''],
      ['POST', '/test'],
    ];

    it.each(attempts)('%s rejects a request without a token', async (method, path) => {
      const env = makeEnv();
      const res = await worker.fetch(
        pushRequest(method, path, { token: null, body: method === 'PUT' ? body() : undefined }),
        env,
      );
      expect(res.status).toBe(401);
      expect(env.SYNC.writes).toBe(0);
    });

    it.each(attempts)('%s rejects the wrong token', async (method, path) => {
      const env = makeEnv();
      const res = await worker.fetch(
        pushRequest(method, path, { token: 'f'.repeat(64), body: method === 'PUT' ? body() : undefined }),
        env,
      );
      expect(res.status).toBe(403);
      expect(env.SYNC.writes).toBe(0);
    });

    it.each(attempts)('%s rejects an id with no token stored yet, and does not claim it', async (method, path) => {
      const env = makeEnv();
      const res = await worker.fetch(
        pushRequest(method, path, { id: 'd'.repeat(64), body: method === 'PUT' ? body() : undefined }),
        env,
      );
      expect(res.status).toBe(403);
      expect(env.SYNC.writes).toBe(0);
    });

    it('accepts a token that the sync routes stored', async () => {
      const env = makeEnv();
      const keys = await deriveKeys('some-sync-key');
      const headers = { Authorization: `Bearer ${keys.token}`, 'Content-Type': 'application/json' };
      const state = new Request(`https://sync.example/v1/${keys.id}/state`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ base: null, data: 'sealed' }),
      });
      expect((await worker.fetch(state, env)).status).toBe(200);
      const res = await worker.fetch(pushRequest('PUT', '', { id: keys.id, token: keys.token, body: body() }), env);
      expect(res.status).toBe(200);
    });
  });

  describe('PUT validation', () => {
    const tooLong = 'https://push.example/' + 'x'.repeat(1024);
    const offCurve = b64urlEncode(pair(Uint8Array.of(4), new Uint8Array(64).fill(7)));
    const withKeys = (keys) => ({ sub: { endpoint: 'https://push.example/1', keys } });
    const goodKeys = newBrowser().sub.keys;
    const bad = [
      ['an http endpoint', { sub: { endpoint: 'http://push.example/1', keys: goodKeys } }],
      ['an endpoint that is no URL', { sub: { endpoint: 'nope', keys: goodKeys } }],
      ['an endpoint with credentials', { sub: { endpoint: 'https://u:p@push.example/1', keys: goodKeys } }],
      ['a very long endpoint', { sub: { endpoint: tooLong, keys: goodKeys } }],
      ['extra fields in sub', { sub: { endpoint: 'https://push.example/1', keys: goodKeys, expirationTime: null } }],
      ['a short p256dh', withKeys({ ...goodKeys, p256dh: 'BAAA' })],
      ['a p256dh off the curve', withKeys({ ...goodKeys, p256dh: offCurve })],
      ['p256dh with bad characters', withKeys({ ...goodKeys, p256dh: '!!!!' })],
      ['a short auth', withKeys({ ...goodKeys, auth: 'AAAA' })],
      ['auth that is no string', withKeys({ ...goodKeys, auth: 16 })],
      ['a tz Intl refuses', { tz: 'Mars/Olympus' }],
      ['an empty tz', { tz: '' }],
      ['a tz that is no string', { tz: 2 }],
      ['slots that are no array', { slots: {} }],
      ['an unknown slot', { slots: [{ id: 'night', time: '08:00', on: true }] }],
      ['the slot id "constructor"', { slots: [{ id: 'constructor', time: '08:00', on: true }] }],
      ['a slot id in an array', { slots: [{ id: ['morning'], time: '08:00', on: true }] }],
      ['a repeated slot', { slots: [DEFAULT_SLOTS[0], DEFAULT_SLOTS[0]] }],
      ['the time 24:00', { slots: [{ id: 'morning', time: '24:00', on: true }] }],
      ['the time 8:00', { slots: [{ id: 'morning', time: '8:00', on: true }] }],
      ['a time in an array', { slots: [{ id: 'morning', time: ['08:00'], on: true }] }],
      ['on that is no boolean', { slots: [{ id: 'morning', time: '08:00', on: 1 }] }],
      ['extra fields in a slot', { slots: [{ id: 'morning', time: '08:00', on: true, label: 'x' }] }],
      ['a badly written quiet date', { quiet: '05/11/2026' }],
      ['a quiet date that does not exist', { quiet: '2026-02-30' }],
      ['a timer with no title', { timer: { at: 1 } }],
      ['a timer at a fractional time', { timer: { at: 1.5, title: 'x' } }],
      ['a timer at a date string', { timer: { at: '2026-11-05', title: 'x' } }],
      ['a very long timer title', { timer: { at: 1, title: 'x'.repeat(121) } }],
      ['a timer url to another site', { timer: { at: 1, title: 'x', url: 'https://evil.example/' } }],
      ['a timer url with a script', { timer: { at: 1, title: 'x', url: 'javascript:alert(1)' } }],
      ['extra fields in a timer', { timer: { at: 1, title: 'x', sound: 'loud' } }],
      ['an extra top-level field', { admin: true }],
    ];

    it.each(bad)('refuses %s', async (_name, over) => {
      const env = makeEnv();
      const res = await worker.fetch(pushRequest('PUT', '', { body: body(undefined, over) }), env);
      expect(res.status).toBe(400);
      expect(env.SYNC.writes).toBe(0);
    });

    it.each(['sub', 'tz', 'slots', 'quiet', 'timer'])('refuses a body without %s', async (field) => {
      const incomplete = body();
      delete incomplete[field];
      const res = await worker.fetch(pushRequest('PUT', '', { body: incomplete }), makeEnv());
      expect(res.status).toBe(400);
    });

    it('refuses text that is not JSON', async () => {
      const res = await worker.fetch(pushRequest('PUT', '', { body: '{nope' }), makeEnv());
      expect(res.status).toBe(400);
    });

    it('refuses a body over the size cap', async () => {
      const res = await worker.fetch(pushRequest('PUT', '', { body: `"${'x'.repeat(9000)}"` }), makeEnv());
      expect(res.status).toBe(413);
    });

    it.each([
      ['too short', 'c'.repeat(15)],
      ['too long', 'c'.repeat(65)],
      ['in capitals', 'C'.repeat(32)],
    ])('does not route a device id that is %s', async (_name, device) => {
      const res = await worker.fetch(pushRequest('PUT', '', { device, body: body() }), makeEnv());
      expect(res.status).toBe(404);
    });

    it('accepts the shortest and longest device ids', async () => {
      for (const device of ['c'.repeat(16), 'c'.repeat(64)]) {
        const res = await worker.fetch(pushRequest('PUT', '', { device, body: body() }), makeEnv());
        expect(res.status).toBe(200);
      }
    });
  });

  describe('storing devices', () => {
    it('keeps a normalised record in push:index', async () => {
      const env = makeEnv();
      const browser = newBrowser();
      const timer = { at: 123, title: 'Cards', url: './#/task/2026-11-05/3' };
      const res = await worker.fetch(
        pushRequest('PUT', '', { body: body(browser, { quiet: '2026-11-05', timer }) }),
        env,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(env.SYNC.index()).toEqual({
        [`${ID}:${DEVICE}`]: record(browser, { quiet: '2026-11-05', timer }),
      });
    });

    it('spends no KV write on an unchanged repeat, and one on a real change', async () => {
      const env = makeEnv();
      const browser = newBrowser();
      await worker.fetch(pushRequest('PUT', '', { body: body(browser) }), env);
      expect(env.SYNC.writes).toBe(1);
      await worker.fetch(pushRequest('PUT', '', { body: body(browser) }), env);
      expect(env.SYNC.writes).toBe(1);
      await worker.fetch(pushRequest('PUT', '', { body: body(browser, { quiet: '2026-11-05' }) }), env);
      expect(env.SYNC.writes).toBe(2);
    });

    it('keeps lastSent when the client sends its config again', async () => {
      const browser = newBrowser();
      const lastSent = { morning: '2026-11-05' };
      const env = makeEnv({ 'push:index': { [`${ID}:${DEVICE}`]: record(browser, { lastSent }) } });
      await worker.fetch(pushRequest('PUT', '', { body: body(browser, { tz: 'Asia/Kolkata' }) }), env);
      const stored = env.SYNC.index()[`${ID}:${DEVICE}`];
      expect(stored.tz).toBe('Asia/Kolkata');
      expect(stored.lastSent).toEqual(lastSent);
    });

    it('DELETE removes a device, and writes nothing if it was not there', async () => {
      const env = makeEnv();
      await worker.fetch(pushRequest('PUT', '', { body: body() }), env);
      let res = await worker.fetch(pushRequest('DELETE', ''), env);
      expect(res.status).toBe(200);
      expect(env.SYNC.index()).toEqual({});
      const writes = env.SYNC.writes;
      res = await worker.fetch(pushRequest('DELETE', ''), env);
      expect(res.status).toBe(200);
      expect(env.SYNC.writes).toBe(writes);
    });

    it('refuses methods a route does not have', async () => {
      const env = makeEnv();
      expect((await worker.fetch(pushRequest('GET', ''), env)).status).toBe(405);
      expect((await worker.fetch(pushRequest('POST', ''), env)).status).toBe(405);
      expect((await worker.fetch(pushRequest('PUT', '/test', { body: body() }), env)).status).toBe(405);
    });
  });

  describe('device caps', () => {
    const device = (n) => n.toString(16).padStart(16, '0');
    const put = (env, id, n) => worker.fetch(pushRequest('PUT', '', { id, device: device(n), body: body() }), env);

    it('allows 5 devices per id, then still lets those 5 update, and frees a place on delete', async () => {
      const env = makeEnv();
      for (let n = 0; n < 5; n++) expect((await put(env, ID, n)).status).toBe(200);
      expect((await put(env, ID, 5)).status).toBe(409);
      expect((await put(env, ID, 0)).status).toBe(200);
      await worker.fetch(pushRequest('DELETE', '', { device: device(0) }), env);
      expect((await put(env, ID, 5)).status).toBe(200);
    });

    it('allows 20 devices in total across ids', async () => {
      const ids = [0, 1, 2, 3, 4].map((n) => String(n).repeat(64));
      const env = makeEnv(Object.fromEntries(ids.map((id) => [`${id}:auth`, tokenHash(TOKEN)])));
      for (const id of ids.slice(0, 4)) {
        for (let n = 0; n < 5; n++) expect((await put(env, id, n)).status).toBe(200);
      }
      expect(Object.keys(env.SYNC.index())).toHaveLength(20);
      expect((await put(env, ids[4], 0)).status).toBe(409);
      expect((await put(env, ids[0], 0)).status).toBe(200);
    });
  });

  describe('POST test', () => {
    it('sends right away and returns the push service status', async () => {
      const calls = fakePushService();
      const browser = newBrowser();
      const env = makeEnv({ 'push:index': { [`${ID}:${DEVICE}`]: record(browser) } });
      const res = await worker.fetch(pushRequest('POST', '/test'), env);
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe(201);
      expect(JSON.parse(decryptAsBrowser(calls[0].body, browser))).toMatchObject({ url: './#/today', tag: 'test' });
    });

    it('passes on a refusal with its reason', async () => {
      fakePushService(() => 403);
      const env = makeEnv({ 'push:index': { [`${ID}:${DEVICE}`]: record(newBrowser()) } });
      const res = await worker.fetch(pushRequest('POST', '/test'), env);
      expect(await res.json()).toEqual({ status: 403, detail: 'refused' });
      expect(env.SYNC.writes).toBe(0);
    });

    it('answers 404 for a device it does not know', async () => {
      const calls = fakePushService();
      const res = await worker.fetch(pushRequest('POST', '/test'), makeEnv());
      expect(res.status).toBe(404);
      expect(calls).toHaveLength(0);
    });

    it('removes a subscription that is gone', async () => {
      fakePushService(() => 410);
      const env = makeEnv({ 'push:index': { [`${ID}:${DEVICE}`]: record(newBrowser()) } });
      const res = await worker.fetch(pushRequest('POST', '/test'), env);
      expect((await res.json()).status).toBe(410);
      expect(env.SYNC.index()).toEqual({});
    });

    it('answers 502 when the push service cannot be reached', async () => {
      fakePushService(() => new Error('network down'));
      const env = makeEnv({ 'push:index': { [`${ID}:${DEVICE}`]: record(newBrowser()) } });
      expect((await worker.fetch(pushRequest('POST', '/test'), env)).status).toBe(502);
    });
  });

  describe('alongside the sync routes', () => {
    it('allows the new methods in CORS for the app only', async () => {
      const preflight = (origin) =>
        worker.fetch(
          new Request(`https://sync.example/v1/${ID}/push/${DEVICE}`, {
            method: 'OPTIONS',
            headers: { Origin: origin },
          }),
          makeEnv(),
        );
      const allowed = await preflight(ORIGIN);
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get('Access-Control-Allow-Methods')).toBe('GET, PUT, POST, DELETE, OPTIONS');
      expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
      expect((await preflight('https://evil.example')).headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('puts CORS headers on push responses, errors included', async () => {
      const res = await worker.fetch(pushRequest('PUT', '', { token: null, body: body() }), makeEnv());
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    });

    it('leaves state and deck answering exactly as before', async () => {
      const env = makeEnv();
      const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
      const call = (method, name, payload) =>
        worker.fetch(
          new Request(`https://sync.example/v1/${ID}/${name}`, {
            method,
            headers,
            ...(payload ? { body: JSON.stringify(payload) } : {}),
          }),
          env,
        );
      expect(await (await call('GET', 'state')).text()).toBe('{"v":0,"data":null}');
      expect(await (await call('PUT', 'state', { base: null, data: 'x' })).text()).toBe('{"v":1}');
      const conflict = await call('PUT', 'state', { base: 0, data: 'y' });
      expect(conflict.status).toBe(409);
      expect(await conflict.text()).toBe('{"v":1}');
      expect((await (await call('GET', 'state')).json()).data).toBe('x');
      expect(await (await call('PUT', 'deck', { base: '*', data: 'd' })).text()).toBe('{"v":1}');
      expect((await call('DELETE', 'state')).status).toBe(405);
      expect((await call('POST', 'state', { base: 1, data: 'z' })).status).toBe(405);
      const unknown = new Request(`https://sync.example/v1/${ID}/other`, { headers });
      expect(await (await worker.fetch(unknown, env)).text()).toBe('{"error":"not found"}');
    });
  });
});

describe('scheduled', () => {
  const KEY = `${ID}:${DEVICE}`;

  /** One device and a fake push service; `sent()` decrypts what was sent. */
  function setup(over = {}, statusFor) {
    const browser = newBrowser();
    const env = makeEnv({ 'push:index': { [KEY]: record(browser, over) } });
    const calls = fakePushService(statusFor);
    const sent = () => calls.map((c) => JSON.parse(decryptAsBrowser(c.body, browser)));
    return { env, calls, sent, browser, stored: () => env.SYNC.index()[KEY] };
  }

  const only = (id, time) => DEFAULT_SLOTS.map((s) => ({ ...s, on: s.id === id, ...(s.id === id ? { time } : {}) }));

  describe('slots', () => {
    it.each([
      ['morning', '08:00', 'Morning session', 'Flashcards, then the book.'],
      ['afternoon', '14:00', 'Afternoon session', 'Videos and speaking.'],
      ['evening', '20:30', 'Evening session', 'New words, then your mistakes.'],
      ['streak', '21:30', 'Keep your streak', 'Tick your tasks before midnight.'],
    ])('sends %s with its text at %s local time', async (id, time, title, text) => {
      const { env, sent, stored } = setup({ slots: only(id, time) });
      const [h, m] = time.split(':').map(Number);
      // Paris is UTC+1 on this date
      await worker.scheduled({ scheduledTime: Date.UTC(2026, 10, 5, h - 1, m) }, env);
      expect(sent()).toEqual([{ title, body: text, tag: `${id}-2026-11-05`, url: './#/today' }]);
      expect(stored().lastSent).toEqual({ [id]: '2026-11-05' });
    });

    it('follows the time zone of the record', async () => {
      const { env, sent } = setup({ tz: 'Asia/Kolkata', slots: only('morning', '08:00') });
      await run(env, '2026-11-05T07:00:00Z'); // 08:00 in Paris, 12:30 in Kolkata
      expect(sent()).toEqual([]);
      await run(env, '2026-11-05T02:30:00Z'); // 08:00 in Kolkata
      expect(sent()).toHaveLength(1);
    });

    it('uses the date of the record zone, not the UTC date', async () => {
      const { env, sent } = setup({ tz: 'Pacific/Auckland', slots: only('morning', '08:00') });
      await run(env, '2026-11-04T19:00:00Z'); // 08:00 on the 5th in Auckland
      expect(sent()[0].tag).toBe('morning-2026-11-05');
    });

    it('does not send a slot that is off', async () => {
      const slots = DEFAULT_SLOTS.map((s) => ({ ...s, on: false }));
      const { env, calls } = setup({ slots });
      await run(env, '2026-11-05T07:00:00Z');
      expect(calls).toHaveLength(0);
    });

    it('sends every slot due in the same minute', async () => {
      const slots = DEFAULT_SLOTS.map((s) => ({ ...s, time: '08:00' }));
      const { env, sent, stored } = setup({ slots });
      await run(env, '2026-11-05T07:00:00Z');
      expect(
        sent()
          .map((p) => p.tag)
          .sort(),
      ).toEqual(['afternoon-2026-11-05', 'evening-2026-11-05', 'morning-2026-11-05', 'streak-2026-11-05']);
      expect(Object.keys(stored().lastSent)).toHaveLength(4);
      expect(env.SYNC.writes).toBe(1);
    });
  });

  describe('the 5-minute catch-up window', () => {
    it.each([
      ['one minute early', '2026-11-05T06:59:00Z', 0],
      ['on time', '2026-11-05T07:00:00Z', 1],
      ['one minute late', '2026-11-05T07:01:00Z', 1],
      ['five minutes late', '2026-11-05T07:05:00Z', 1],
      ['six minutes late', '2026-11-05T07:06:00Z', 0],
    ])('%s', async (_name, iso, count) => {
      const { env, calls } = setup({ slots: only('morning', '08:00') });
      await run(env, iso);
      expect(calls).toHaveLength(count);
    });

    it('sends once when the run on the minute was skipped, and not again', async () => {
      const { env, calls } = setup({ slots: only('morning', '08:00') });
      for (const iso of ['2026-11-05T07:03:00Z', '2026-11-05T07:04:00Z', '2026-11-05T07:05:00Z']) await run(env, iso);
      expect(calls).toHaveLength(1);
    });

    it('does not carry a slot before midnight over into the next day', async () => {
      const { env, calls } = setup({ slots: only('evening', '23:58') });
      await run(env, '2026-11-05T22:58:00Z'); // 23:58 on the 5th
      expect(calls).toHaveLength(1);
      await run(env, '2026-11-05T23:01:00Z'); // 00:01 on the 6th
      expect(calls).toHaveLength(1);
    });
  });

  describe('lastSent', () => {
    it('stops a repeat the same day, and lets the slot fire the next day', async () => {
      const { env, calls, stored } = setup({ slots: only('morning', '08:00') });
      await run(env, '2026-11-05T07:00:00Z');
      await run(env, '2026-11-05T07:01:00Z');
      expect(calls).toHaveLength(1);
      await run(env, '2026-11-06T07:00:00Z');
      expect(calls).toHaveLength(2);
      expect(stored().lastSent.morning).toBe('2026-11-06');
    });

    it('holds when it was stored before this run', async () => {
      const { env, calls } = setup({ slots: only('morning', '08:00'), lastSent: { morning: '2026-11-05' } });
      await run(env, '2026-11-05T07:00:00Z');
      expect(calls).toHaveLength(0);
      expect(env.SYNC.writes).toBe(0);
    });
  });

  describe('quiet', () => {
    it('skips the streak slot on the quiet day, with no write', async () => {
      const { env, calls } = setup({ slots: only('streak', '21:30'), quiet: '2026-11-05' });
      await run(env, '2026-11-05T20:30:00Z');
      expect(calls).toHaveLength(0);
      expect(env.SYNC.writes).toBe(0);
    });

    it('sends the streak slot on any other day', async () => {
      const { env, calls } = setup({ slots: only('streak', '21:30'), quiet: '2026-11-04' });
      await run(env, '2026-11-05T20:30:00Z');
      expect(calls).toHaveLength(1);
    });

    it('does not silence the other slots', async () => {
      const { env, sent } = setup({ slots: only('evening', '20:30'), quiet: '2026-11-05' });
      await run(env, '2026-11-05T19:30:00Z');
      expect(sent()[0].tag).toBe('evening-2026-11-05');
    });
  });

  describe('clock changes in Europe/Paris', () => {
    /** Runs the cron every minute between two instants and lists what went out, as [tag, UTC time]. */
    async function everyMinute(env, browser, calls, from, to) {
      const out = [];
      for (let t = at(from); t < at(to); t += 60000) {
        const before = calls.length;
        await worker.scheduled({ scheduledTime: t }, env);
        for (const c of calls.slice(before)) {
          out.push([JSON.parse(decryptAsBrowser(c.body, browser)).tag, new Date(t).toISOString().slice(0, 16)]);
        }
      }
      return out;
    }

    it('keeps 08:00 local when the clocks go forward: 07:00 UTC, then 06:00 UTC', async () => {
      const { env, calls, browser } = setup({ slots: only('morning', '08:00') });
      const out = await everyMinute(env, browser, calls, '2027-03-27T00:00:00Z', '2027-03-30T00:00:00Z');
      expect(out).toEqual([
        ['morning-2027-03-27', '2027-03-27T07:00'],
        ['morning-2027-03-28', '2027-03-28T06:00'],
        ['morning-2027-03-29', '2027-03-29T06:00'],
      ]);
    });

    it('keeps 08:00 local when the clocks go back: 06:00 UTC, then 07:00 UTC', async () => {
      const { env, calls, browser } = setup({ slots: only('morning', '08:00') });
      const out = await everyMinute(env, browser, calls, '2027-10-30T00:00:00Z', '2027-11-02T00:00:00Z');
      expect(out).toEqual([
        ['morning-2027-10-30', '2027-10-30T06:00'],
        ['morning-2027-10-31', '2027-10-31T07:00'],
        ['morning-2027-11-01', '2027-11-01T07:00'],
      ]);
    });

    it('sends every default slot once a day through the change', async () => {
      const { env, calls, browser } = setup();
      const out = await everyMinute(env, browser, calls, '2027-03-27T23:00:00Z', '2027-03-28T22:00:00Z');
      expect(out.map(([tag]) => tag).sort()).toEqual([
        'afternoon-2027-03-28',
        'evening-2027-03-28',
        'morning-2027-03-28',
        'streak-2027-03-28',
      ]);
    });

    it('sends a time that happens twice only the first time, when the clocks go back', async () => {
      const { env, calls, browser } = setup({ slots: only('evening', '02:30') });
      const out = await everyMinute(env, browser, calls, '2027-10-30T22:00:00Z', '2027-10-31T03:00:00Z');
      expect(out).toEqual([['evening-2027-10-31', '2027-10-31T00:30']]);
    });

    it('skips a time that does not exist that one day, when the clocks go forward', async () => {
      const { env, calls, browser } = setup({ slots: only('evening', '02:30') });
      const out = await everyMinute(env, browser, calls, '2027-03-27T23:00:00Z', '2027-03-29T02:00:00Z');
      expect(out).toEqual([['evening-2027-03-29', '2027-03-29T00:30']]);
    });
  });

  describe('timers', () => {
    const slots = DEFAULT_SLOTS.map((s) => ({ ...s, on: false }));
    const due = at('2026-11-05T10:00:00Z');

    it('waits until its time', async () => {
      const { env, calls } = setup({ slots, timer: { at: due, title: 'Cards' } });
      await worker.scheduled({ scheduledTime: due - 1 }, env);
      expect(calls).toHaveLength(0);
      expect(env.SYNC.writes).toBe(0);
    });

    it('fires once at its time, then is cleared', async () => {
      const { env, calls, sent, stored } = setup({ slots, timer: { at: due, title: 'Cards' } });
      await worker.scheduled({ scheduledTime: due }, env);
      expect(sent()).toEqual([{ title: "Time's up", body: 'Cards', tag: 'timer', url: './#/today' }]);
      expect(stored().timer).toBeNull();
      await worker.scheduled({ scheduledTime: due + 60000 }, env);
      expect(calls).toHaveLength(1);
    });

    it('opens the url the client gave', async () => {
      const url = './#/task/2026-11-05/3';
      const { env, sent } = setup({ slots, timer: { at: due, title: 'Cards', url } });
      await worker.scheduled({ scheduledTime: due + 30000 }, env);
      expect(sent()[0].url).toBe(url);
    });

    it('stays set after a failed send, and fires on the next run', async () => {
      let status = 500;
      const { env, calls, stored } = setup({ slots, timer: { at: due, title: 'Cards' } }, () => status);
      await worker.scheduled({ scheduledTime: due }, env);
      expect(stored().timer).not.toBeNull();
      expect(env.SYNC.writes).toBe(0);
      status = 201;
      await worker.scheduled({ scheduledTime: due + 60000 }, env);
      expect(calls).toHaveLength(2);
      expect(stored().timer).toBeNull();
    });

    it('is given up on when sends have failed for over an hour', async () => {
      const { env, stored } = setup({ slots, timer: { at: due, title: 'Cards' } }, () => 500);
      await worker.scheduled({ scheduledTime: due + 3600 * 1000 }, env);
      expect(stored().timer).not.toBeNull();
      await worker.scheduled({ scheduledTime: due + 3601 * 1000 }, env);
      expect(stored().timer).toBeNull();
    });
  });

  describe('failures', () => {
    it.each([410, 404])('removes the record on %i from the push service', async (status) => {
      const { env, stored } = setup({ slots: only('morning', '08:00') }, () => status);
      await run(env, '2026-11-05T07:00:00Z');
      expect(stored()).toBeUndefined();
      expect(env.SYNC.writes).toBe(1);
    });

    it('removes a record once though several of its sends came back gone', async () => {
      const slots = DEFAULT_SLOTS.map((s) => ({ ...s, time: '08:00' }));
      const { env, stored } = setup({ slots }, () => 410);
      await run(env, '2026-11-05T07:00:00Z');
      expect(stored()).toBeUndefined();
    });

    it('tries a slot again next minute after a failed send', async () => {
      let status = 503;
      const { env, calls, stored } = setup({ slots: only('morning', '08:00') }, () => status);
      await run(env, '2026-11-05T07:00:00Z');
      expect(stored().lastSent).toEqual({});
      expect(env.SYNC.writes).toBe(0);
      status = 201;
      await run(env, '2026-11-05T07:01:00Z');
      expect(calls).toHaveLength(2);
      expect(stored().lastSent).toEqual({ morning: '2026-11-05' });
    });

    it('lets the other devices through when one send fails', async () => {
      const browsers = ['ok1', 'refused', 'gone', 'down', 'ok2'].map((n) => newBrowser(`https://push.example/${n}`));
      const keys = browsers.map((_, i) => `${ID}:${String(i).repeat(16)}`);
      const slots = only('morning', '08:00');
      const env = makeEnv({
        'push:index': Object.fromEntries(browsers.map((b, i) => [keys[i], record(b, { slots })])),
      });
      const calls = fakePushService((url) => {
        if (url.endsWith('refused')) return 500;
        if (url.endsWith('gone')) return 410;
        if (url.endsWith('down')) return new Error('network down');
        return 201;
      });
      await run(env, '2026-11-05T07:00:00Z');
      expect(calls).toHaveLength(5);
      const index = env.SYNC.index();
      expect(index[keys[0]].lastSent).toEqual({ morning: '2026-11-05' });
      expect(index[keys[1]].lastSent).toEqual({});
      expect(index[keys[2]]).toBeUndefined();
      expect(index[keys[3]].lastSent).toEqual({});
      expect(index[keys[4]].lastSent).toEqual({ morning: '2026-11-05' });
    });

    it('lets the other devices through when one record has a time zone Intl refuses', async () => {
      const good = newBrowser('https://push.example/good');
      const slots = only('morning', '08:00');
      const env = makeEnv({
        'push:index': {
          [`${ID}:${'1'.repeat(16)}`]: record(newBrowser('https://push.example/bad'), { slots, tz: 'Mars/Olympus' }),
          [`${ID}:${'2'.repeat(16)}`]: record(good, { slots }),
        },
      });
      const calls = fakePushService();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await run(env, '2026-11-05T07:00:00Z');
      expect(calls.map((c) => c.url)).toEqual([good.sub.endpoint]);
    });

    it('leaves everything due when the private key is unusable', async () => {
      const { env, calls, stored } = setup({ slots: only('morning', '08:00') });
      env.VAPID_PRIVATE_KEY = 'not-a-key';
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await run(env, '2026-11-05T07:00:00Z');
      expect(calls).toHaveLength(0);
      expect(stored().lastSent).toEqual({});
      expect(env.SYNC.writes).toBe(0);
    });

    it('does not log endpoints or keys when a send fails', async () => {
      const { env, browser } = setup({ slots: only('morning', '08:00') }, () => 500);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await run(env, '2026-11-05T07:00:00Z');
      const logged = warn.mock.calls.flat().join(' ');
      expect(logged).toContain('500');
      expect(logged).not.toContain(browser.sub.endpoint);
      expect(logged).not.toContain(browser.sub.keys.auth);
      expect(logged).not.toContain(env.VAPID_PRIVATE_KEY);
    });
  });

  describe('free-tier limits', () => {
    it('does one KV read and no writes when nothing fires', async () => {
      const { env, calls } = setup();
      const list = vi.spyOn(env.SYNC, 'list');
      await run(env, '2026-11-05T03:00:00Z');
      expect(env.SYNC.reads).toBe(1);
      expect(env.SYNC.writes).toBe(0);
      expect(list).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
    });

    it('does one KV read and no writes with no devices at all', async () => {
      const env = makeEnv();
      await run(env, '2026-11-05T07:00:00Z');
      expect(env.SYNC.reads).toBe(1);
      expect(env.SYNC.writes).toBe(0);
    });

    const devices = (count, slots) =>
      Object.fromEntries(
        [...Array(count).keys()].map((n) => [
          `${ID}:${n.toString(16).padStart(16, '0')}`,
          record(newBrowser(), { slots }),
        ]),
      );

    it('does one read and one write when several records fire', async () => {
      const env = makeEnv({ 'push:index': devices(5, only('morning', '08:00')) });
      const calls = fakePushService();
      await run(env, '2026-11-05T07:00:00Z');
      expect(calls).toHaveLength(5);
      expect(env.SYNC.reads).toBe(1);
      expect(env.SYNC.writes).toBe(1);
    });

    it('sends at most 8 a run, for the CPU limit, and the rest over the next minutes', async () => {
      const env = makeEnv({ 'push:index': devices(20, only('morning', '08:00')) });
      const calls = fakePushService();
      await run(env, '2026-11-05T07:00:00Z');
      expect(calls).toHaveLength(8);
      await run(env, '2026-11-05T07:01:00Z');
      expect(calls).toHaveLength(16);
      await run(env, '2026-11-05T07:02:00Z');
      expect(calls).toHaveLength(20);
      await run(env, '2026-11-05T07:03:00Z');
      expect(calls).toHaveLength(20);
      expect(Object.values(env.SYNC.index()).every((r) => r.lastSent.morning === '2026-11-05')).toBe(true);
    });
  });
});

describe('createReminders', () => {
  const AUTH = { id: ID, token: TOKEN };

  function memoryStorage() {
    const m = new Map();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  }

  /** navigator, PushManager and Notification as a browser has them, with the real Worker behind fetchImpl. */
  function setup({ permission = 'default', answer = 'granted', auth = AUTH } = {}) {
    const browser = newBrowser();
    const env = makeEnv();
    const push = fakePushService();
    let subscription = null;
    const makeSubscription = (key) => {
      const sub = {
        options: { applicationServerKey: key.buffer },
        toJSON: () => ({ endpoint: browser.sub.endpoint, expirationTime: null, keys: browser.sub.keys }),
        unsubscribe: vi.fn(async () => {
          subscription = null;
          return true;
        }),
      };
      return sub;
    };
    const pushManager = {
      getSubscription: async () => subscription,
      subscribe: vi.fn(async ({ applicationServerKey }) => (subscription = makeSubscription(applicationServerKey))),
    };
    const registration = { pushManager };
    vi.stubGlobal('navigator', {
      serviceWorker: { ready: Promise.resolve(registration), getRegistration: async () => registration },
    });
    vi.stubGlobal('PushManager', function PushManager() {});
    const notification = {
      permission,
      requestPermission: vi.fn(async () => {
        notification.permission = answer;
        return answer;
      }),
    };
    vi.stubGlobal('Notification', notification);

    const state = { offline: false, requests: [] };
    const fetchImpl = async (url, init = {}) => {
      if (state.offline) throw new TypeError('Failed to fetch');
      state.requests.push({ url, method: init.method, body: init.body && JSON.parse(init.body) });
      return worker.fetch(new Request(url, { ...init, headers: { ...init.headers, Origin: ORIGIN } }), env);
    };
    const storage = memoryStorage();
    const make = () => createReminders({ url: 'https://sync.example/', getAuth: () => auth, storage, fetchImpl });
    const reminders = make();
    const stored = () => Object.values(env.SYNC.index())[0];
    const setSubscription = (s) => (subscription = s);
    return {
      reminders,
      make,
      env,
      push,
      state,
      storage,
      stored,
      browser,
      pushManager,
      notification,
      makeSubscription,
      setSubscription,
    };
  }

  describe('support()', () => {
    it('explains a browser with no service workers', () => {
      const { reminders } = setup();
      vi.stubGlobal('navigator', {});
      const check = reminders.support();
      expect(check.ok).toBe(false);
      expect(check.why).toMatch(/background/);
    });

    it('explains a browser with no push, and how to get it on an iPhone', () => {
      const { reminders } = setup();
      vi.unstubAllGlobals();
      vi.stubGlobal('navigator', { serviceWorker: {} });
      expect(reminders.support().why).toMatch(/Home Screen/);
    });

    it('explains a browser with no notifications', () => {
      const { reminders } = setup();
      vi.unstubAllGlobals();
      vi.stubGlobal('navigator', { serviceWorker: {} });
      vi.stubGlobal('PushManager', function PushManager() {});
      expect(reminders.support().why).toMatch(/notifications/);
    });

    it('explains blocked notifications', () => {
      const { reminders } = setup({ permission: 'denied' });
      expect(reminders.support().why).toMatch(/blocked/);
    });

    it('explains that sync is off', () => {
      const { reminders } = setup({ auth: null });
      expect(reminders.support().why).toMatch(/sync/i);
    });

    it('is ok otherwise', () => {
      const { reminders } = setup();
      expect(reminders.support()).toEqual({ ok: true, why: '' });
    });
  });

  it('starts off with the default slots, all on', () => {
    const { reminders } = setup();
    expect(reminders.isOn()).toBe(false);
    expect(reminders.slots()).toEqual([
      { id: 'morning', time: '08:00', on: true, label: 'Morning: cards and the book' },
      { id: 'afternoon', time: '14:00', on: true, label: 'Afternoon: videos and speaking' },
      { id: 'evening', time: '20:30', on: true, label: 'Evening: new words' },
      { id: 'streak', time: '21:30', on: true, label: 'Streak at risk' },
    ]);
  });

  it('does not hand out its own slot objects', () => {
    const { reminders } = setup();
    reminders.slots()[0].time = '23:00';
    expect(reminders.slots()[0].time).toBe('08:00');
  });

  describe('enable()', () => {
    it('asks, subscribes with the VAPID key and registers a record the Worker accepts', async () => {
      const { reminders, stored, browser, pushManager, notification } = setup();
      await reminders.enable();
      expect(notification.requestPermission).toHaveBeenCalledOnce();
      const options = pushManager.subscribe.mock.calls[0][0];
      expect(options.userVisibleOnly).toBe(true);
      expect(b64urlEncode(options.applicationServerKey)).toBe(VAPID_PUBLIC_KEY);
      expect(reminders.isOn()).toBe(true);
      expect(stored()).toEqual({
        sub: browser.sub,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        slots: DEFAULT_SLOTS,
        quiet: null,
        timer: null,
        lastSent: {},
      });
    });

    it('asks for permission before anything else is awaited, so Safari counts it as part of the tap', async () => {
      const { reminders, notification } = setup();
      const pending = reminders.enable();
      expect(notification.requestPermission).toHaveBeenCalledOnce(); // synchronously
      await pending;
    });

    it('keeps one random hex device id across restarts', async () => {
      const { reminders, make, storage, state } = setup();
      await reminders.enable();
      const id = storage.getItem(PUSH_DEVICE_STORAGE);
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      const restarted = make();
      expect(restarted.isOn()).toBe(true);
      await restarted.refresh();
      expect(storage.getItem(PUSH_DEVICE_STORAGE)).toBe(id);
      expect(state.requests.at(-1).url).toContain(`/push/${id}`);
    });

    it('throws a plain message when permission is refused', async () => {
      const { reminders, stored, pushManager } = setup({ answer: 'denied' });
      await expect(reminders.enable()).rejects.toThrow(/permission/);
      expect(reminders.isOn()).toBe(false);
      expect(pushManager.subscribe).not.toHaveBeenCalled();
      expect(stored()).toBeUndefined();
    });

    it('throws support reasons without asking', async () => {
      const { reminders, notification } = setup({ auth: null });
      await expect(reminders.enable()).rejects.toThrow(/sync/i);
      expect(notification.requestPermission).not.toHaveBeenCalled();
    });

    it('throws a plain message and stays off when the server cannot be reached', async () => {
      const { reminders, state } = setup();
      state.offline = true;
      await expect(reminders.enable()).rejects.toThrow(/connection/);
      expect(reminders.isOn()).toBe(false);
    });

    it('replaces a subscription made with an older VAPID key', async () => {
      const { reminders, makeSubscription, setSubscription, pushManager } = setup();
      const old = makeSubscription(new Uint8Array(65).fill(9));
      setSubscription(old);
      await reminders.enable();
      expect(old.unsubscribe).toHaveBeenCalledOnce();
      expect(pushManager.subscribe).toHaveBeenCalledOnce();
    });

    it('reuses a subscription made with the current key', async () => {
      const { reminders, makeSubscription, setSubscription, pushManager } = setup();
      setSubscription(makeSubscription(b64urlDecode(VAPID_PUBLIC_KEY)));
      await reminders.enable();
      expect(pushManager.subscribe).not.toHaveBeenCalled();
    });
  });

  describe('disable()', () => {
    it('unsubscribes, removes the record and turns off', async () => {
      const { reminders, stored, pushManager } = setup();
      await reminders.enable();
      const sub = await pushManager.getSubscription();
      await reminders.disable();
      expect(sub.unsubscribe).toHaveBeenCalledOnce();
      expect(stored()).toBeUndefined();
      expect(reminders.isOn()).toBe(false);
    });

    it('still turns off and unsubscribes when offline', async () => {
      const { reminders, state, pushManager } = setup();
      await reminders.enable();
      const sub = await pushManager.getSubscription();
      state.offline = true;
      await reminders.disable();
      expect(sub.unsubscribe).toHaveBeenCalledOnce();
      expect(reminders.isOn()).toBe(false);
    });
  });

  describe('setSlot()', () => {
    it('saves here and on the server', async () => {
      const { reminders, make, stored } = setup();
      await reminders.enable();
      await reminders.setSlot('morning', { time: '07:15' });
      await reminders.setSlot('streak', { on: false });
      expect(stored().slots[0]).toEqual({ id: 'morning', time: '07:15', on: true });
      expect(stored().slots[3]).toEqual({ id: 'streak', time: '21:30', on: false });
      expect(make().slots()[0].time).toBe('07:15');
    });

    it('only saves here while reminders are off', async () => {
      const { reminders, state } = setup();
      await reminders.setSlot('morning', { time: '07:15' });
      expect(state.requests).toHaveLength(0);
      expect(reminders.slots()[0].time).toBe('07:15');
    });

    it('refuses a slot or a time that makes no sense', async () => {
      const { reminders } = setup();
      await expect(reminders.setSlot('night', { on: true })).rejects.toThrow(/Unknown/);
      await expect(reminders.setSlot('morning', { time: '25:00' })).rejects.toThrow(/time/);
    });

    it('throws when offline, keeps the change and sends it at the next refresh', async () => {
      const { reminders, state, stored } = setup();
      await reminders.enable();
      state.offline = true;
      await expect(reminders.setSlot('morning', { time: '07:15' })).rejects.toThrow();
      expect(reminders.slots()[0].time).toBe('07:15');
      state.offline = false;
      await reminders.refresh();
      expect(stored().slots[0].time).toBe('07:15');
    });
  });

  describe('setQuiet()', () => {
    it('sends the date, and skips the PUT when it has not changed', async () => {
      const { reminders, state, stored } = setup();
      await reminders.enable();
      const before = state.requests.length;
      await reminders.setQuiet('2026-11-05');
      expect(stored().quiet).toBe('2026-11-05');
      expect(state.requests).toHaveLength(before + 1);
      await reminders.setQuiet('2026-11-05');
      expect(state.requests).toHaveLength(before + 1);
      await reminders.setQuiet(null);
      expect(stored().quiet).toBeNull();
    });

    it('does not throw when offline, and sends it at the next refresh', async () => {
      const { reminders, state, stored, make } = setup();
      await reminders.enable();
      state.offline = true;
      await expect(reminders.setQuiet('2026-11-05')).resolves.toBe(false);
      expect(stored().quiet).toBeNull();
      state.offline = false;
      await make().refresh(); // a later app start, from what was saved
      expect(stored().quiet).toBe('2026-11-05');
    });

    it('does not throw when sync has been turned off', async () => {
      const { reminders, make, storage } = setup();
      await reminders.enable();
      const off = createReminders({
        url: 'https://sync.example',
        getAuth: () => null,
        storage,
        fetchImpl: () => {
          throw new Error('should not be called');
        },
      });
      await expect(off.setQuiet('2026-11-05')).resolves.toBe(false);
      expect(make().isOn()).toBe(true);
    });
  });

  describe('timers', () => {
    const inAnHour = () => Date.now() + 3600 * 1000;

    it('sets and clears a timer on the server', async () => {
      const { reminders, stored } = setup();
      await reminders.enable();
      const when = inAnHour();
      await reminders.setTimer({ at: when, title: 'Cards', url: './#/task/2026-11-05/3' });
      expect(stored().timer).toEqual({ at: when, title: 'Cards', url: './#/task/2026-11-05/3' });
      await reminders.clearTimer();
      expect(stored().timer).toBeNull();
    });

    it('keeps titles and urls within what the Worker accepts', async () => {
      const { reminders, stored } = setup();
      await reminders.enable();
      const when = inAnHour();
      await expect(reminders.setTimer({ at: when, title: 'x'.repeat(500), url: 'https://evil.example' })).resolves.toBe(
        true,
      );
      expect(stored().timer).toEqual({ at: when, title: 'x'.repeat(120) });
      await expect(reminders.setTimer({ at: when, title: '' })).resolves.toBe(true);
      expect(stored().timer.title).toBeTruthy();
    });

    it('does not throw when offline, and sends it at the next refresh', async () => {
      const { reminders, state, stored, storage } = setup();
      await reminders.enable();
      state.offline = true;
      await expect(reminders.setTimer({ at: inAnHour(), title: 'Cards' })).resolves.toBe(false);
      expect(JSON.parse(storage.getItem(PUSH_CONFIG_STORAGE)).pending).toBe(true);
      state.offline = false;
      await reminders.refresh();
      expect(stored().timer.title).toBe('Cards');
      expect(JSON.parse(storage.getItem(PUSH_CONFIG_STORAGE)).pending).toBe(false);
    });

    it('does not throw when clearing offline, and clears at the next refresh', async () => {
      const { reminders, state, stored } = setup();
      await reminders.enable();
      await reminders.setTimer({ at: inAnHour(), title: 'Cards' });
      state.offline = true;
      await expect(reminders.clearTimer()).resolves.toBe(false);
      expect(stored().timer).not.toBeNull();
      state.offline = false;
      await reminders.refresh();
      expect(stored().timer).toBeNull();
    });

    it('does not send a timer again after its time, so the server cannot fire it twice', async () => {
      const { reminders, stored, state } = setup();
      await reminders.enable();
      const now = Date.now();
      await reminders.setTimer({ at: now + 1000, title: 'Cards' });
      vi.spyOn(Date, 'now').mockReturnValue(now + 2000);
      await reminders.refresh();
      expect(state.requests.at(-1).body.timer).toBeNull();
      expect(stored().timer).toBeNull();
    });

    it('sends requests in the order they were made', async () => {
      const { reminders, stored } = setup();
      await reminders.enable();
      await Promise.all([
        reminders.setTimer({ at: inAnHour(), title: 'Cards' }),
        reminders.clearTimer(),
        reminders.setQuiet('2026-11-05'),
      ]);
      expect(stored().timer).toBeNull();
      expect(stored().quiet).toBe('2026-11-05');
    });
  });

  describe('refresh()', () => {
    it('does nothing while off', async () => {
      const { reminders, state } = setup();
      await expect(reminders.refresh()).resolves.toBe(false);
      expect(state.requests).toHaveLength(0);
    });

    it('restores a record the server lost', async () => {
      const { reminders, env, stored } = setup();
      await reminders.enable();
      await env.SYNC.put('push:index', '{}');
      await expect(reminders.refresh()).resolves.toBe(true);
      expect(stored()).toBeDefined();
    });

    it('spends no KV write when nothing changed', async () => {
      const { reminders, env } = setup();
      await reminders.enable();
      const writes = env.SYNC.writes;
      await reminders.refresh();
      expect(env.SYNC.writes).toBe(writes);
    });

    it('subscribes again when the browser dropped the subscription', async () => {
      const { reminders, setSubscription, pushManager } = setup();
      await reminders.enable();
      setSubscription(null);
      await expect(reminders.refresh()).resolves.toBe(true);
      expect(pushManager.subscribe).toHaveBeenCalledTimes(2);
    });

    it('turns off when permission was taken back', async () => {
      const { reminders, notification } = setup();
      await reminders.enable();
      notification.permission = 'denied';
      await expect(reminders.refresh()).resolves.toBe(false);
      expect(reminders.isOn()).toBe(false);
    });

    it('never throws when offline', async () => {
      const { reminders, state } = setup();
      await reminders.enable();
      state.offline = true;
      await expect(reminders.refresh()).resolves.toBe(false);
      expect(reminders.isOn()).toBe(true);
    });
  });

  describe('test()', () => {
    it('reports the push service status', async () => {
      const { reminders, push } = setup();
      await reminders.enable();
      await expect(reminders.test()).resolves.toEqual({ ok: true, status: 201 });
      expect(push).toHaveLength(1);
    });

    it('registers again and retries when the server does not know the device', async () => {
      const { reminders, env, push } = setup();
      await reminders.enable();
      await env.SYNC.put('push:index', '{}');
      await expect(reminders.test()).resolves.toEqual({ ok: true, status: 201 });
      expect(push).toHaveLength(1);
    });

    it('explains when reminders are off', async () => {
      const { reminders } = setup();
      await expect(reminders.test()).rejects.toThrow(/on first/);
    });
  });

  it('survives unreadable saved settings', () => {
    const { storage, make } = setup();
    storage.setItem(PUSH_CONFIG_STORAGE, '{nope');
    expect(make().isOn()).toBe(false);
    expect(make().slots()).toHaveLength(4);
  });

  it('accepts getAuth from syncctl, sends only the id and token, and is off with sync off', async () => {
    const storage = memoryStorage();
    const sync = createSync({
      url: 'https://sync.example',
      storage,
      getState: () => emptyState(),
      setState: () => {},
      getDeck: async () => null,
      setDeck: async () => {},
      fetchImpl: async () => new Response(JSON.stringify({ v: 1 }), { status: 200 }),
    });
    expect(sync.auth()).toBeNull();
    await sync.enable();
    const auth = await sync.auth();
    expect(Object.keys(auth).sort()).toEqual(['id', 'token']);
    expect(auth.id).toMatch(/^[0-9a-f]{64}$/);
    expect(auth).toEqual(await deriveKeys(sync.key).then(({ id, token }) => ({ id, token })));
    sync.disable();
    expect(sync.auth()).toBeNull();
  });
});

describe('sw-push.js', () => {
  const SCOPE = 'https://hardil-bitdecentro.github.io/french-a1-b2/';
  const source = readFileSync(new URL('../site/sw-push.js', import.meta.url), 'utf8');

  function loadWorker(open = []) {
    const listeners = {};
    const shown = [];
    const clients = { matchAll: vi.fn(async () => open), openWindow: vi.fn(async () => {}) };
    const self = {
      addEventListener: (type, fn) => (listeners[type] = fn),
      registration: {
        scope: SCOPE,
        showNotification: async (title, options) => shown.push({ title, ...options }),
      },
      clients,
    };
    vm.runInNewContext(source, { self, URL });
    const fire = async (type, event) => {
      const waits = [];
      listeners[type]({ ...event, waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    };
    return { fire, shown, clients };
  }

  const pushEvent = (json) => ({ data: { json } });

  function clickEvent(url) {
    return { notification: { data: { url }, close: vi.fn() } };
  }

  it('shows the payload with the app icon', async () => {
    const { fire, shown } = loadWorker();
    const payload = { title: 'Morning session', body: 'Flashcards.', tag: 'morning-2026-11-05', url: './#/today' };
    await fire(
      'push',
      pushEvent(() => payload),
    );
    expect(shown).toEqual([
      {
        title: 'Morning session',
        body: 'Flashcards.',
        icon: 'icon-512.png',
        tag: 'morning-2026-11-05',
        data: { url: './#/today' },
      },
    ]);
  });

  it.each([
    ['an empty push', { data: null }],
    [
      'a payload that is not JSON',
      pushEvent(() => {
        throw new SyntaxError('bad json');
      }),
    ],
    ['JSON that is no object', pushEvent(() => 'hello')],
    ['JSON null', pushEvent(() => null)],
    ['a title that is no string', pushEvent(() => ({ title: 42 }))],
  ])('falls back to a generic notification for %s', async (_name, event) => {
    const { fire, shown } = loadWorker();
    await fire('push', event);
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('French study');
    expect(shown[0].icon).toBe('icon-512.png');
    expect(shown[0].data.url).toBe('./#/today');
    expect('tag' in shown[0]).toBe(false);
  });

  it('closes the notification, then focuses an open tab and takes it to the url', async () => {
    const tab = { url: `${SCOPE}#/plan`, focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) };
    const { fire, clients } = loadWorker([tab]);
    const event = clickEvent('./#/task/2026-11-05/3');
    await fire('notificationclick', event);
    expect(event.notification.close).toHaveBeenCalledOnce();
    expect(tab.focus).toHaveBeenCalledOnce();
    expect(tab.navigate).toHaveBeenCalledWith(`${SCOPE}#/task/2026-11-05/3`);
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens the url when no tab is open', async () => {
    const { fire, clients } = loadWorker([]);
    await fire('notificationclick', clickEvent('./#/today'));
    expect(clients.openWindow).toHaveBeenCalledWith(`${SCOPE}#/today`);
  });

  it('ignores tabs of other apps on the same site', async () => {
    const other = { url: 'https://hardil-bitdecentro.github.io/other/', focus: vi.fn(), navigate: vi.fn() };
    const { fire, clients } = loadWorker([other]);
    await fire('notificationclick', clickEvent('./#/today'));
    expect(other.focus).not.toHaveBeenCalled();
    expect(clients.openWindow).toHaveBeenCalledOnce();
  });

  it('opens a new tab when the open one refuses to navigate', async () => {
    const tab = {
      url: SCOPE,
      focus: vi.fn(async () => {}),
      navigate: vi.fn(async () => {
        throw new TypeError('not controlled');
      }),
    };
    const { fire, clients } = loadWorker([tab]);
    await fire('notificationclick', clickEvent('./#/today'));
    expect(clients.openWindow).toHaveBeenCalledWith(`${SCOPE}#/today`);
  });

  it('goes home for a url outside the app', async () => {
    const { fire, clients } = loadWorker([]);
    await fire('notificationclick', clickEvent('https://evil.example/'));
    expect(clients.openWindow).toHaveBeenCalledWith(`${SCOPE}#/today`);
  });
});
