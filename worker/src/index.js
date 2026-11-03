// Sync server for the French study app. Stores opaque, client-encrypted blobs in Workers KV.
//
//   GET  /v1/:id/:name   → 200 { v, data, t }  (v = 0, data = null when nothing is stored yet)
//   PUT  /v1/:id/:name   body { base, data } → 200 { v } | 409 { v } (someone wrote first: pull, merge, retry)
//
// :id is a 64-hex value derived from the user's sync key; :name is "state" or "deck".
// Auth: "Authorization: Bearer <64-hex token>". The first write for an id stores SHA-256(token);
// every later read/write must present the same token. The server never sees plaintext.

const NAMES = { state: 2 * 1024 * 1024, deck: 4 * 1024 * 1024 }; // max size of the sealed data (chars)
const HEX64 = /^[0-9a-f]{64}$/;

const te = new TextEncoder();
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', te.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare of two equal-length hex strings. */
function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cors(req, env) {
  const origin = req.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(status, body, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const m = new URL(req.url).pathname.match(/^\/v1\/([0-9a-f]{64})\/(state|deck)$/);
    if (!m) return json(404, { error: 'not found' }, h);
    const [, id, name] = m;

    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!HEX64.test(auth)) return json(401, { error: 'missing token' }, h);
    const tokenHash = await sha256hex(auth);
    const authKey = `${id}:auth`;
    const stored = await env.SYNC.get(authKey);
    if (stored && !sameHex(stored, tokenHash)) return json(403, { error: 'forbidden' }, h);

    const blobKey = `${id}:${name}`;
    if (req.method === 'GET') {
      const blob = stored ? await env.SYNC.get(blobKey, 'json') : null;
      return json(200, blob || { v: 0, data: null }, h);
    }

    if (req.method === 'PUT') {
      let body;
      try {
        body = await req.json();
      } catch {
        return json(400, { error: 'bad json' }, h);
      }
      if (!body || typeof body.data !== 'string' || body.data.length > NAMES[name]) {
        return json(413, { error: 'missing or too large' }, h);
      }
      if (!stored) await env.SYNC.put(authKey, tokenHash);
      const current = await env.SYNC.get(blobKey, 'json');
      const v = current ? current.v : 0;
      if (current && body.base !== v) return json(409, { v }, h);
      const next = { v: v + 1, data: body.data, t: Date.now() };
      await env.SYNC.put(blobKey, JSON.stringify(next));
      return json(200, { v: next.v }, h);
    }

    return json(405, { error: 'method not allowed' }, h);
  },
};
