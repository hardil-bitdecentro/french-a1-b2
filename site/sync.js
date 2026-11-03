// End-to-end encrypted sync. One random "sync key" per person, shared between devices by QR code.
// From it we derive: a storage id, an access token (sent to the server, which stores only its hash)
// and an AES-GCM key (never leaves the device). The server only ever sees gzip+AES-GCM ciphertext.
// Works in browsers and in Node (WebCrypto + CompressionStream are globals in both).

const te = new TextEncoder();
const td = new TextDecoder();

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function newSyncKey() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function validSyncKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key) && unb64url(key).length === 32;
}

const sha256 = (s) => crypto.subtle.digest('SHA-256', te.encode(s));

/** id + token (hex) and the AES key, all derived from the sync key with domain separation. */
export async function deriveKeys(syncKey) {
  const [id, token, raw] = await Promise.all([
    sha256(`fr-a1-b2|id|${syncKey}`),
    sha256(`fr-a1-b2|auth|${syncKey}`),
    sha256(`fr-a1-b2|enc|${syncKey}`),
  ]);
  const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { id: hex(id), token: hex(token), aes };
}

async function gzip(bytes) {
  return new Uint8Array(
    await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
  );
}
async function gunzip(bytes) {
  return new Uint8Array(
    await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),
  );
}

/** JSON → gzip → AES-GCM → base64 ("iv|ciphertext"). */
export async function seal(aes, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const packed = await gzip(te.encode(JSON.stringify(value)));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, packed));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return bytesToB64(out);
}

export async function open(aes, sealed) {
  const bytes = b64ToBytes(sealed);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, aes, bytes.subarray(12));
  return JSON.parse(td.decode(await gunzip(new Uint8Array(plain))));
}

/** Link that pairs another device. The key is in the #fragment, which browsers never send to servers. */
export function pairLink(baseUrl, syncKey) {
  return `${baseUrl.replace(/#.*$/, '')}#/pair/${syncKey}`;
}

/**
 * Tiny client for the sync Worker. `name` is "state" or "deck".
 * get → { v, value } | null (nothing stored yet) ; put → { ok: true, v } | { conflict: true, v }
 */
export function client(baseUrl, keys, fetchImpl = fetch) {
  const url = (name) => `${baseUrl.replace(/\/$/, '')}/v1/${keys.id}/${name}`;
  const headers = { Authorization: `Bearer ${keys.token}` };
  return {
    async get(name) {
      const r = await fetchImpl(url(name), { headers });
      if (!r.ok) throw new Error(`sync get ${name}: ${r.status}`);
      const body = await r.json();
      if (body.data == null) return null;
      return { v: body.v, value: await open(keys.aes, body.data) };
    },
    async put(name, value, base) {
      const data = await seal(keys.aes, value);
      const r = await fetchImpl(url(name), {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ base: base ?? null, data }),
      });
      if (r.status === 409) return { conflict: true, v: (await r.json()).v };
      if (!r.ok) throw new Error(`sync put ${name}: ${r.status}`);
      return { ok: true, v: (await r.json()).v };
    },
  };
}
