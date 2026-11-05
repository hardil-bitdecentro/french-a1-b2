// Offline support. The newest files are used whenever the network answers; the saved copies when it doesn't.
importScripts('sw-push.js');

const CACHE = 'french-v1';
const PRECACHE = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'logic.js',
  'store.js',
  'cards.js',
  'cards-view.js',
  'pages.js',
  'speak.js',
  'photo-view.js',
  'photo.js',
  'ocr-words.js',
  'reminders.js',
  'sw-push.js',
  'syncctl.js',
  'sync.js',
  'db.js',
  'config.js',
  'vendor/ts-fsrs.mjs',
  'vendor/qrcode.mjs',
  'fonts/atkinson-400.woff2',
  'fonts/atkinson-700.woff2',
  'data/schedule.json',
  'manifest.webmanifest',
  'icon.svg',
  'icon-512.png',
  'apple-touch-icon.png',
];
// The photo reader is large and rarely changes, so it has its own cache that app updates don't download again.
const OCR_CACHE = 'ocr-v1';
const OCR_FILES = [
  'tesseract.min.js',
  'worker.min.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'fra.traineddata',
];
const NETWORK_WAIT_MS = 3500;

async function saveOcrFiles() {
  const cache = await caches.open(OCR_CACHE);
  await Promise.allSettled(
    OCR_FILES.map(async (file) => {
      const url = `vendor/ocr/${file}`;
      if (!(await cache.match(url))) await cache.add(url);
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
  event.waitUntil(saveOcrFiles());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== OCR_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function ocrFile(request) {
  const cache = await caches.open(OCR_CACHE);
  const saved = await cache.match(request, { ignoreSearch: true });
  if (saved) return saved;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  // Every page address, including ?text=… from a share, is the same one page. Text shared in is never saved.
  const isShell = request.mode === 'navigate' && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
  const key = isShell ? 'index.html' : url.pathname;
  // no-cache asks the server every time, so old and new files never mix after an update.
  const network = fetch(isShell ? 'index.html' : request.url, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_WAIT_MS));
  const fast = await Promise.race([network.catch(() => undefined), timeout]);
  if (fast) return fast;
  const saved = await cache.match(key);
  if (saved) return saved;
  // Nothing saved and the network is slow or down: keep waiting for it.
  return network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Sync, audio and videos go straight to the network. Only this app's own files are saved.
  if (url.origin !== self.location.origin) return;
  event.respondWith(url.pathname.includes('/vendor/ocr/') ? ocrFile(request) : networkFirst(request));
});
