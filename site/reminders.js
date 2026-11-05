// Study reminders through Web Push. The Worker keeps each device's subscription and schedule and sends the
// notifications, so they arrive with the app closed. Settings stay on this device and are not synced.
//
// getAuth() returns { id, token }, a promise of it, or null when sync is off. sync.auth() from syncctl.js fits as is.
import { VAPID_PUBLIC_KEY } from './config.js';

export const PUSH_DEVICE_STORAGE = 'fr-a1-b2:push-device';
export const PUSH_CONFIG_STORAGE = 'fr-a1-b2:push-config';

const DEFAULT_SLOTS = [
  { id: 'morning', label: 'Morning: cards and the book', time: '08:00' },
  { id: 'afternoon', label: 'Afternoon: videos and speaking', time: '14:00' },
  { id: 'evening', label: 'Evening: new words', time: '20:30' },
  { id: 'streak', label: 'Streak at risk', time: '21:30' },
];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TIMER_TITLE = 120;
const MAX_TIMER_URL = 200;
const SYNC_OFF = 'Turn on sync first. Reminders sign in with your sync key.';
const NO_SERVER = 'Could not reach the reminder server. Check your connection and try again.';

function vapidKeyBytes() {
  return Uint8Array.from(atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

function sameBytes(a, b) {
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

function newDeviceId() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function loadConfig(storage) {
  let saved = null;
  try {
    saved = JSON.parse(storage.getItem(PUSH_CONFIG_STORAGE));
  } catch {
    // unreadable settings: start again from the defaults
  }
  return {
    on: !!saved?.on,
    slots: DEFAULT_SLOTS.map(({ id, time }) => {
      const mine = saved?.slots?.find((s) => s.id === id);
      return { id, time: mine?.time ?? time, on: mine?.on ?? true };
    }),
    quiet: saved?.quiet ?? null,
    timer: saved?.timer ?? null,
    pending: !!saved?.pending,
  };
}

/** The subscription for the current VAPID key, replacing one made with an older key and creating one if needed. */
async function ensureSubscription(registration) {
  const key = vapidKeyBytes();
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    const usedKey = existing.options?.applicationServerKey;
    if (!usedKey || sameBytes(usedKey, key)) return existing;
    await existing.unsubscribe();
  }
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

export function createReminders({ url, getAuth, storage, fetchImpl = (...args) => fetch(...args) }) {
  const cfg = loadConfig(storage);
  let queue = Promise.resolve();

  const save = () => storage.setItem(PUSH_CONFIG_STORAGE, JSON.stringify(cfg));

  function deviceId() {
    let id = storage.getItem(PUSH_DEVICE_STORAGE);
    if (!id) {
      id = newDeviceId();
      storage.setItem(PUSH_DEVICE_STORAGE, id);
    }
    return id;
  }

  const route = (auth) => `${url.replace(/\/$/, '')}/v1/${auth.id}/push/${deviceId()}`;
  const signIn = (auth) => ({ Authorization: `Bearer ${auth.token}` });

  /** One request at a time, so a quick set-then-clear can't arrive at the server in the wrong order. */
  function inOrder(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }

  /** Sends the whole current config. A timer already past is left out: the server would fire it a second time. */
  function put() {
    return inOrder(async () => {
      const auth = await getAuth();
      if (!auth) throw new Error(SYNC_OFF);
      const registration = await navigator.serviceWorker.getRegistration();
      const sub = await registration?.pushManager.getSubscription();
      if (!sub) throw new Error('This device has no push subscription.');
      const { endpoint, keys } = sub.toJSON();
      if (cfg.timer && cfg.timer.at <= Date.now()) cfg.timer = null;
      const res = await fetchImpl(route(auth), {
        method: 'PUT',
        headers: { ...signIn(auth), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sub: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
          tz: localTimeZone(),
          slots: cfg.slots,
          quiet: cfg.quiet,
          timer: cfg.timer,
        }),
      });
      if (!res.ok) throw new Error(`The reminder server said ${res.status}.`);
      cfg.pending = false;
      save();
    });
  }

  /** For calls the UI can't act on: never throws, and leaves the change marked so refresh() sends it. */
  async function putLater() {
    if (!cfg.on) {
      save();
      return false;
    }
    cfg.pending = true;
    save();
    try {
      await put();
      return true;
    } catch {
      return false;
    }
  }

  function support() {
    const no = (why) => ({ ok: false, why });
    if (!globalThis.navigator || !('serviceWorker' in navigator)) {
      return no('This browser cannot run an app in the background, so it cannot send reminders.');
    }
    if (!('PushManager' in globalThis)) {
      return no('This browser does not support push messages. On an iPhone, add the app to your Home Screen first.');
    }
    if (!('Notification' in globalThis)) return no('This browser does not support notifications.');
    if (Notification.permission === 'denied') {
      return no('Notifications are blocked for this site. Allow them in your browser settings, then come back.');
    }
    if (!url || !getAuth()) return no(SYNC_OFF);
    return { ok: true, why: '' };
  }

  return {
    support,
    isOn: () => cfg.on,
    slots: () => cfg.slots.map((s) => ({ ...s, label: DEFAULT_SLOTS.find((d) => d.id === s.id).label })),

    /** Call from a tap. Throws with a message for the person when it can't turn on. */
    async enable() {
      const check = support();
      if (!check.ok) throw new Error(check.why);
      // Must be the first thing awaited: Safari only shows the prompt straight after the tap.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Reminders need permission to show notifications.');
      await ensureSubscription(await navigator.serviceWorker.ready);
      cfg.on = true;
      try {
        await put();
      } catch {
        cfg.on = false;
        save();
        throw new Error(NO_SERVER);
      }
    },

    /** Never fails over the network: a subscription that is gone makes the server drop the record at its next send. */
    async disable() {
      cfg.on = false;
      cfg.pending = false;
      save();
      await inOrder(async () => {
        try {
          const auth = await getAuth();
          if (auth) await fetchImpl(route(auth), { method: 'DELETE', headers: signIn(auth) });
        } catch {
          // offline: handled by the unsubscribe below
        }
        const registration = await navigator.serviceWorker?.getRegistration();
        const sub = await registration?.pushManager.getSubscription();
        await sub?.unsubscribe();
      });
    },

    /** Saves here first. Throws if the server didn't get it; the change is kept and sent again at the next refresh(). */
    async setSlot(id, { on, time } = {}) {
      const slot = cfg.slots.find((s) => s.id === id);
      if (!slot) throw new Error(`Unknown reminder: ${id}`);
      if (time !== undefined && !TIME.test(time)) throw new Error('Use a time like 08:30.');
      if (on !== undefined) slot.on = !!on;
      if (time !== undefined) slot.time = time;
      save();
      if (!cfg.on) return;
      cfg.pending = true;
      save();
      await put();
    },

    /** The day (YYYY-MM-DD, or null) the streak reminder stays silent. Resolves to false if it's waiting to send. */
    async setQuiet(date) {
      const next = date ?? null;
      if (next === cfg.quiet) return true;
      cfg.quiet = next;
      return putLater();
    },

    /** Resolves to false if it's waiting to send. url, if given, is where a tap goes, like './#/task/2026-11-05/3'. */
    async setTimer({ at, title, url: link }) {
      cfg.timer = { at, title: String(title ?? '').slice(0, MAX_TIMER_TITLE) || 'Your timer has finished.' };
      if (typeof link === 'string' && link.startsWith('./#/') && link.length <= MAX_TIMER_URL) cfg.timer.url = link;
      return putLater();
    },

    async clearTimer() {
      if (!cfg.timer) return true;
      cfg.timer = null;
      return putLater();
    },

    /** Call on app start. Sends the current subscription and anything still waiting. Never throws. */
    async refresh() {
      if (!cfg.on) return false;
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) return false;
        if (Notification.permission !== 'granted') {
          // Permission taken back in the browser's settings: no notification can show until it's asked for again.
          cfg.on = false;
          save();
          return false;
        }
        await ensureSubscription(registration);
        await put();
        return true;
      } catch {
        return false;
      }
    },

    /** Sends a notification now. Resolves to { ok, status } with the push service's status. */
    async test() {
      const auth = await getAuth();
      if (!auth) throw new Error(SYNC_OFF);
      if (!cfg.on) throw new Error('Turn reminders on first.');
      const post = () => fetchImpl(`${route(auth)}/test`, { method: 'POST', headers: signIn(auth) });
      let res = await post();
      if (res.status === 404) {
        await put();
        res = await post();
      }
      if (!res.ok) throw new Error(`The reminder server said ${res.status}.`);
      const { status } = await res.json();
      return { ok: status >= 200 && status < 300, status };
    },
  };
}
