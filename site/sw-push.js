// Push reminders in the service worker. A classic script, loaded from sw.js with importScripts('sw-push.js').
(() => {
  const FALLBACK_TITLE = 'French study';
  const FALLBACK_BODY = 'Time for your French.';
  const HOME = './#/today';

  /** The Worker's JSON, or {} when the message is empty or isn't JSON: a push must always show something. */
  function readPayload(event) {
    try {
      const value = event.data ? event.data.json() : null;
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  const text = (value, fallback) => (typeof value === 'string' && value ? value : fallback);

  /**
   * The server can send a reminder twice, because what it reads can be a minute old. A dismissed reminder must not
   * come back, so each one is shown once. If this can't be checked, showing it again is better than losing it.
   */
  async function firstTime(once) {
    if (typeof once !== 'string' || !once) return true;
    try {
      const cache = await caches.open('push-shown');
      const key = `shown/${encodeURIComponent(once)}`;
      if (await cache.match(key)) return false;
      await cache.put(key, new Response(''));
      const all = await cache.keys();
      await Promise.all(all.slice(0, -30).map((old) => cache.delete(old)));
    } catch {
      // no cache available
    }
    return true;
  }

  async function show(title, options, once) {
    if (await firstTime(once)) await self.registration.showNotification(title, options);
  }

  self.addEventListener('push', (event) => {
    const data = readPayload(event);
    const options = {
      body: text(data.body, FALLBACK_BODY),
      icon: 'icon-512.png',
      data: { url: text(data.url, HOME) },
    };
    if (typeof data.tag === 'string' && data.tag) options.tag = data.tag;
    event.waitUntil(show(text(data.title, FALLBACK_TITLE), options, data.once));
  });

  async function openApp(url) {
    const target = new URL(url.startsWith('./#/') ? url : HOME, self.registration.scope).href;
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = open.find((c) => c.url.startsWith(self.registration.scope));
    if (!client) {
      await self.clients.openWindow(target);
      return;
    }
    try {
      await client.focus();
      await client.navigate(target);
    } catch {
      // navigate() refuses a tab this worker doesn't control yet, so show the page in a new one.
      await self.clients.openWindow(target);
    }
  }

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data = event.notification.data || {};
    event.waitUntil(openApp(text(data.url, HOME)));
  });
})();
