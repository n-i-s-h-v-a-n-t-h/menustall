// ChaiMenu dashboard service worker.
// - Pages: network first (always the newest version), cached copy offline.
// - Our CSS/JS/icons: stale-while-revalidate (instant load, updates in background).
// - CDN libraries & fonts: cache first (versioned URLs never change).
// - Supabase API / Realtime / Storage: never cached — stock must be live.

const VERSION = 'chaimenu-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL = [
  './',
  './index.html',
  './login.html',
  './print.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  '../css/tokens.css',
  '../css/base.css',
  '../css/admin.css',
  '../js/config.js',
  '../js/lib/supabase.js',
  '../js/lib/ui.js',
  '../js/lib/format.js',
  '../js/menu/render.js',
  '../js/admin/app.js',
  '../js/admin/auth.js',
  '../js/admin/store.js',
  '../js/admin/overview.js',
  '../js/admin/stock.js',
  '../js/admin/menu-editor.js',
  '../js/admin/image-tools.js',
  '../js/admin/tables-qr.js',
  '../js/admin/settings.js',
];

const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Live data is never cached.
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;

  // Pages and the config file: always try for the newest version first.
  if (request.mode === 'navigate' || url.pathname.endsWith('/js/config.js')) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(SHELL_CACHE)).put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    return cached || caches.match('./index.html');
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') (await caches.open(RUNTIME_CACHE)).put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  if (cached) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  return network;
}
