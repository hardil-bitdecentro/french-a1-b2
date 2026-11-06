// Sync server for the French study app. Stores opaque, client-encrypted blobs in Workers KV.
//
//   GET  /v1/:id/:name   → 200 { v, data, t }  (v = 0, data = null when nothing is stored yet)
//   PUT  /v1/:id/:name   body { base, data } → 200 { v } | 409 { v } (someone wrote first: pull, merge, retry)
//                        (for the deck, base "*" overwrites unconditionally)
//
// :id is a 64-hex value derived from the user's sync key; :name is "state" or "deck".
// Auth: "Authorization: Bearer <64-hex token>". The first write for an id stores SHA-256(token);
// every later read/write must present the same token. The server never sees plaintext.
//
// Study reminders, for an id that already has a token stored:
//   PUT    /v1/:id/push/:device        body { sub, tz, slots, quiet, timer } → 200 { ok }
//   DELETE /v1/:id/push/:device        → 200 { ok }
//   POST   /v1/:id/push/:device/test   → 200 { status, detail } with the push service's own status
// A cron every minute sends what is due. All devices share the one KV key "push:index", so a run is a single read
// (the free plan allows 1,000 writes a day) and a write only when something was sent.
//
// KV is eventually consistent, so a run can read a copy up to a minute old and write it back over a PUT, and it can
// repeat a send. Both are harmless here: each client PUTs its whole config at start-up, and a repeat has the same tag,
// which the phone collapses into one notification.
import { sendPush, b64urlDecode } from './push.js';

const NAMES = { state: 2 * 1024 * 1024, deck: 4 * 1024 * 1024 }; // max size of the sealed data (chars)
const HEX64 = /^[0-9a-f]{64}$/;

const PUSH_ROUTE = /^\/v1\/([0-9a-f]{64})\/push\/([0-9a-f]{16,64})(\/test)?$/;
const PUSH_INDEX = 'push:index';
const MAX_PUSH_BODY = 8 * 1024; // chars
const MAX_DEVICES_PER_ID = 5;
const MAX_DEVICES = 20;
// A slot still fires this long after its time, in case a cron run was skipped. Kept short because a KV read can be
// a minute old, so a run may not yet see that the slot was sent. The service worker hides any repeat (see `once`).
const CATCH_UP_MINUTES = 2;
const MAX_SENDS_PER_RUN = 8; // a send takes about 1 ms of CPU and the free plan allows 10 ms a run; the rest go next minute
const TIMER_RETRY_MS = 60 * 60 * 1000; // a timer whose send keeps failing is dropped after this long
const HOME_URL = './#/today';
const SLOT_TEXT = {
  morning: ['Morning session', 'Flashcards, then the book.'],
  afternoon: ['Afternoon session', 'Videos and speaking.'],
  evening: ['Evening session', 'New words, then your mistakes.'],
  streak: ['Keep your streak', 'Tick your tasks before midnight.'],
};
const TEST_PAYLOAD = { title: 'Test reminder', body: 'Reminders are working.', tag: 'test', url: HOME_URL };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

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
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
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

/** True when o is a plain object with every required key and nothing beyond the required and optional ones. */
function hasOnlyKeys(o, required, optional = []) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const keys = Object.keys(o);
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
}

function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}

async function validKeys(keys) {
  if (!hasOnlyKeys(keys, ['p256dh', 'auth'])) return false;
  if (typeof keys.p256dh !== 'string' || !BASE64URL.test(keys.p256dh) || keys.p256dh.length > 100) return false;
  if (typeof keys.auth !== 'string' || !BASE64URL.test(keys.auth) || keys.auth.length > 100) return false;
  try {
    if (b64urlDecode(keys.auth).length !== 16) return false;
    // Importing it also rejects a point that isn't on the curve, which would otherwise only fail at send time.
    await crypto.subtle.importKey('raw', b64urlDecode(keys.p256dh), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return true;
  } catch {
    return false;
  }
}

function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function validSlots(slots) {
  if (!Array.isArray(slots) || slots.length > Object.keys(SLOT_TEXT).length) return false;
  const validId = (id) => typeof id === 'string' && Object.hasOwn(SLOT_TEXT, id);
  const validTime = (time) => typeof time === 'string' && HHMM.test(time);
  const valid = (s) => hasOnlyKeys(s, ['id', 'time', 'on']) && validId(s.id) && validTime(s.time);
  if (!slots.every((s) => valid(s) && typeof s.on === 'boolean')) return false;
  return new Set(slots.map((s) => s.id)).size === slots.length;
}

function validTimer(t) {
  if (!hasOnlyKeys(t, ['at', 'title'], ['url'])) return false;
  if (!Number.isSafeInteger(t.at) || t.at <= 0) return false;
  if (typeof t.title !== 'string' || !t.title || t.title.length > 120) return false;
  if (t.url === undefined) return true;
  return typeof t.url === 'string' && t.url.length <= 200 && t.url.startsWith('./#/');
}

/** The stored form of a PUT body, built field by field so that a repeat of the same config compares equal. */
async function parseDevice(b) {
  if (!hasOnlyKeys(b, ['sub', 'tz', 'slots', 'quiet', 'timer']))
    return { error: 'expected sub, tz, slots, quiet, timer' };
  if (!hasOnlyKeys(b.sub, ['endpoint', 'keys']) || !validEndpoint(b.sub.endpoint)) return { error: 'bad endpoint' };
  if (!(await validKeys(b.sub.keys))) return { error: 'bad keys' };
  if (!validTimeZone(b.tz)) return { error: 'bad tz' };
  if (!validSlots(b.slots)) return { error: 'bad slots' };
  if (b.quiet !== null && !validDate(b.quiet)) return { error: 'bad quiet' };
  if (b.timer !== null && !validTimer(b.timer)) return { error: 'bad timer' };
  const { endpoint, keys } = b.sub;
  return {
    device: {
      sub: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
      tz: b.tz,
      slots: b.slots.map(({ id, time, on }) => ({ id, time, on })),
      quiet: b.quiet,
      timer: b.timer && {
        at: b.timer.at,
        title: b.timer.title,
        ...(b.timer.url === undefined ? {} : { url: b.timer.url }),
      },
    },
  };
}

async function pushRoute(req, env, h, id, device, isTest) {
  const allowed = isTest ? ['POST'] : ['PUT', 'DELETE'];
  if (!allowed.includes(req.method)) return json(405, { error: 'method not allowed' }, h);

  const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!HEX64.test(auth)) return json(401, { error: 'missing token' }, h);
  const stored = await env.SYNC.get(`${id}:auth`);
  if (!stored || !sameHex(stored, await sha256hex(auth))) return json(403, { error: 'forbidden' }, h);

  const key = `${id}:${device}`;

  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > MAX_PUSH_BODY) return json(413, { error: 'too large' }, h);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'bad json' }, h);
    }
    const parsed = await parseDevice(body);
    if (parsed.error) return json(400, { error: parsed.error }, h);

    const index = (await env.SYNC.get(PUSH_INDEX, 'json')) || {};
    const previous = index[key];
    if (!previous) {
      const keys = Object.keys(index);
      const mine = keys.filter((k) => k.startsWith(`${id}:`)).length;
      if (mine >= MAX_DEVICES_PER_ID || keys.length >= MAX_DEVICES) return json(409, { error: 'too many devices' }, h);
    }
    const next = { ...parsed.device, lastSent: previous ? previous.lastSent : {} };
    // The app repeats this at every start, so an unchanged config mustn't spend a KV write.
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      index[key] = next;
      await env.SYNC.put(PUSH_INDEX, JSON.stringify(index));
    }
    return json(200, { ok: true }, h);
  }

  const index = (await env.SYNC.get(PUSH_INDEX, 'json')) || {};

  if (req.method === 'DELETE') {
    if (index[key]) {
      delete index[key];
      await env.SYNC.put(PUSH_INDEX, JSON.stringify(index));
    }
    return json(200, { ok: true }, h);
  }

  const record = index[key];
  if (!record) return json(404, { error: 'not found' }, h);
  let sent;
  try {
    sent = await sendPush(record.sub, TEST_PAYLOAD, env);
  } catch {
    return json(502, { error: 'could not reach the push service' }, h);
  }
  if (isGone(sent.status)) {
    delete index[key];
    await env.SYNC.put(PUSH_INDEX, JSON.stringify(index));
  }
  return json(200, { status: sent.status, detail: sent.detail }, h);
}

/** The subscription no longer exists, and never will again. */
function isGone(status) {
  return status === 404 || status === 410;
}

const clocks = new Map();

/** The record's local date (YYYY-MM-DD) and minutes since local midnight. */
function localClock(tz, now) {
  let clock = clocks.get(tz);
  if (!clock) {
    clock = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    clocks.set(tz, clock);
  }
  const p = Object.fromEntries(clock.formatToParts(now).map((part) => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/**
 * What one record should send now. Slots compare local wall-clock times, so they keep their hour across a clock change:
 * on the day the clocks go back, lastSent stops a time that happens twice from firing twice; on the day they go
 * forward, a slot in the hour that doesn't exist (02:00–02:54 in Paris) is skipped that one day.
 */
function dueJobs(key, record, now) {
  const { date, minutes } = localClock(record.tz, now);
  const jobs = [];
  for (const { id, time, on } of record.slots) {
    if (!on || record.lastSent[id] === date) continue;
    if (id === 'streak' && record.quiet === date) continue;
    const late = minutes - toMinutes(time);
    if (late < 0 || late > CATCH_UP_MINUTES) continue;
    const [title, body] = SLOT_TEXT[id];
    jobs.push({
      key,
      slot: id,
      date,
      payload: { title, body, tag: `${id}-${date}`, once: `${id}-${date}`, url: HOME_URL },
    });
  }
  if (record.timer && record.timer.at <= now) {
    const { title, url } = record.timer;
    jobs.push({
      key,
      payload: {
        title: "Time's up",
        body: title,
        tag: 'timer',
        once: `timer-${record.timer.at}`,
        url: url || HOME_URL,
      },
    });
  }
  return jobs;
}

async function sendDue(env, now) {
  const index = await env.SYNC.get(PUSH_INDEX, 'json');
  if (!index) return;

  const jobs = [];
  for (const [key, record] of Object.entries(index)) {
    try {
      jobs.push(...dueJobs(key, record, now));
    } catch (err) {
      console.warn('push: skipped a record', String(err));
    }
  }
  const batch = jobs.slice(0, MAX_SENDS_PER_RUN);
  if (!batch.length) return;

  const results = await Promise.allSettled(batch.map((job) => sendPush(index[job.key].sub, job.payload, env)));

  let changed = false;
  results.forEach((result, i) => {
    const job = batch[i];
    const record = index[job.key];
    if (!record) return; // already removed by another send in this run
    const sent = result.status === 'fulfilled' ? result.value : null;
    if (sent && isGone(sent.status)) {
      delete index[job.key];
      changed = true;
      return;
    }
    const ok = !!sent && sent.ok;
    if (!ok) console.warn('push: send failed', sent ? `${sent.status} ${sent.detail}` : String(result.reason));
    if (job.slot) {
      // A failed slot stays due and is tried again next minute, until its catch-up window closes.
      if (ok) {
        record.lastSent[job.slot] = job.date;
        changed = true;
      }
    } else if (ok || now - record.timer.at > TIMER_RETRY_MS) {
      record.timer = null;
      changed = true;
    }
  });
  if (changed) await env.SYNC.put(PUSH_INDEX, JSON.stringify(index));
}

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const path = new URL(req.url).pathname;
    const push = path.match(PUSH_ROUTE);
    if (push) return pushRoute(req, env, h, push[1], push[2], !!push[3]);

    const m = path.match(/^\/v1\/([0-9a-f]{64})\/(state|deck)$/);
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
      // The deck has a single writer at a time (the device that imported it), so it may overwrite with base "*".
      const force = name === 'deck' && body.base === '*';
      if (current && !force && body.base !== v) return json(409, { v }, h);
      const next = { v: v + 1, data: body.data, t: Date.now() };
      await env.SYNC.put(blobKey, JSON.stringify(next));
      return json(200, { v: next.v }, h);
    }

    return json(405, { error: 'method not allowed' }, h);
  },

  async scheduled(event, env) {
    await sendDue(env, event.scheduledTime ?? Date.now());
  },
};
