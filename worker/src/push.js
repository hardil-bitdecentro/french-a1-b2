// Web Push from a Worker with WebCrypto only: VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291, RFC 8188).
//
// Env: VAPID_PUBLIC_KEY (base64url of the 65-byte uncompressed point), VAPID_PRIVATE_KEY (base64url of the 32-byte
// scalar, a secret), VAPID_SUBJECT (https: or mailto: contact for the push service).

const te = new TextEncoder();
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const RECORD_SIZE = 4096;
const VAPID_LIFETIME_S = 12 * 3600;
const SEND_TIMEOUT_MS = 10000;

export function b64urlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function b64urlDecode(s) {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/**
 * Encrypts one RFC 8188 record for a browser's subscription keys ({ p256dh, auth }, base64url).
 * `fixed` ({ salt, keyPair }) exists so the RFC's test vector can be reproduced; real sends leave it out,
 * which makes both the salt and the sender's ECDH key fresh for every message.
 */
export async function encryptPayload(plaintext, keys, fixed = {}) {
  const uaPublic = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, ECDH, false, []);
  const sender = fixed.keyPair || (await crypto.subtle.generateKey(ECDH, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const salt = fixed.salt || crypto.getRandomValues(new Uint8Array(16));

  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256),
  );
  const ikm = await hkdf(authSecret, ecdhSecret, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);

  // One record, ended by the 0x02 delimiter that marks it as the last one.
  const plain = concat(typeof plaintext === 'string' ? te.encode(plaintext) : plaintext, Uint8Array.of(2));
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE);
  return concat(salt, recordSize, Uint8Array.of(asPublic.length), asPublic, ciphertext);
}

/** The VAPID Authorization header for one endpoint. WebCrypto's ECDSA signature is already the JWT's raw r||s. */
export async function vapidAuthorization(endpoint, env, nowMs = Date.now()) {
  const publicKey = b64urlDecode(env.VAPID_PUBLIC_KEY);
  const signingKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: env.VAPID_PRIVATE_KEY,
      x: b64urlEncode(publicKey.subarray(1, 33)),
      y: b64urlEncode(publicKey.subarray(33, 65)),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const encode = (value) => b64urlEncode(te.encode(JSON.stringify(value)));
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + VAPID_LIFETIME_S,
    sub: env.VAPID_SUBJECT,
  })}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, te.encode(unsigned));
  return `vapid t=${unsigned}.${b64urlEncode(new Uint8Array(signature))}, k=${env.VAPID_PUBLIC_KEY}`;
}

/**
 * Sends one notification. Resolves to { ok, status, detail } whatever the push service answered, where detail is the
 * start of its error text. Rejects only when nothing was delivered at all (bad keys, network down, timeout).
 */
export async function sendPush(sub, payload, env) {
  const body = await encryptPayload(JSON.stringify(payload), sub.keys);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: '3600',
      Urgency: 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: await vapidAuthorization(sub.endpoint, env),
    },
    body,
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  // Always read the answer: an unread response keeps its connection open, and a Worker only gets six at a time.
  const text = await res.text();
  return { ok: res.ok, status: res.status, detail: res.ok ? '' : text.slice(0, 300) };
}
