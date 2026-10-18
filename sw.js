/* 離線快取：第一次開啟後，整個閱讀器（不含書，書本來就在 IndexedDB）都能離線使用。
   策略是 stale-while-revalidate：先用快取立刻開啟，背景再向網站確認有沒有新版，下次開啟就是新版。 */
'use strict';

const VERSION = 'v1';
const CACHE = 'ink-reader-' + VERSION;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/reader.css',
  'js/db.js',
  'js/zip.js',
  'js/epub.js',
  'js/txt.js',
  'js/paginator.js',
  'js/sprites.js',
  'js/guide.js',
  'js/app.js',
  'fonts/fusion-pixel-12px-proportional-tc.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ink-reader-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
    // no-cache：繞過瀏覽器 HTTP 快取向網站確認（GitHub Pages 會回 304，幾乎不耗流量）
    const update = fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      })
      .catch(() => cached || Response.error());
    if (cached) {
      event.waitUntil(update);
      return cached;
    }
    return update;
  })());
});
