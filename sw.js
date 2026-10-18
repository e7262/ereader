/* 離線快取：第一次開啟後，整個閱讀器（不含書，書本來就在 IndexedDB）都能離線使用。

   一律從「同一份快照」提供所有程式檔，不會出現舊的 index.html 配新的 app.js。
   更新流程：頁面載入完成後通知這裡檢查 → 用 HEAD 比對每個檔案的 Last-Modified／ETag（幾乎不耗流量）
   → 有變動才把整套檔案下載到新的快取，全部成功才切換；下次開啟時就是新版。不需要手動改版本號。 */
'use strict';

const PREFIX = 'ink-reader-';
const META = PREFIX + 'meta';
const SHELL = [
  './',
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
const CHECK_EVERY = 10 * 60 * 1000; // 從背景切回來時的檢查間隔；每次開啟 App 都會檢查

const scope = new URL(self.registration.scope);

// 請求對應到快照裡的哪個檔案；index.html 與資料夾網址視為同一個
function shellPath(url) {
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
  let rel = url.pathname.slice(scope.pathname.length);
  if (rel === '' || rel === 'index.html') rel = './';
  return SHELL.includes(rel) ? rel : null;
}

async function activeName() {
  const res = await (await caches.open(META)).match('active');
  return res ? res.text() : null;
}

async function setActive(name) {
  await (await caches.open(META)).put('active', new Response(name));
  for (const key of await caches.keys()) {
    if (key.startsWith(PREFIX) && key !== META && key !== name) await caches.delete(key);
  }
}

// 整套下載到一個新的快取；任何一個檔案失敗就整批放棄，不會留下半新半舊的組合
async function snapshot() {
  const responses = await Promise.all(SHELL.map(async (path) => {
    const res = await fetch(new Request(path, { cache: 'reload' }));
    if (!res.ok) throw new Error(path + ' ' + res.status);
    return [path, res];
  }));
  const name = PREFIX + Date.now();
  const cache = await caches.open(name);
  await Promise.all(responses.map(([path, res]) => cache.put(path, res)));
  return name;
}

// 靜態網站的 Last-Modified 在 GET 與 HEAD 一致；沒有才用 ETag
const stamp = (res) => res.headers.get('last-modified') || res.headers.get('etag') || '';

async function checkForUpdate() {
  const name = await activeName();
  if (!name) return false;
  const cache = await caches.open(name);
  const results = await Promise.all(SHELL.map(async (path) => {
    const [old, head] = await Promise.all([cache.match(path), fetch(path, { method: 'HEAD', cache: 'no-store' })]);
    if (!head.ok) throw new Error(path + ' ' + head.status); // 網站暫時有問題，下次再說
    return !old || stamp(old) !== stamp(head);
  }));
  if (!results.some(Boolean)) return false;
  await setActive(await snapshot());
  return true;
}

self.addEventListener('install', (event) => {
  // 只有第一次安裝需要先存一份；之後的版本更新交給 checkForUpdate
  event.waitUntil(
    activeName()
      .then((name) => (name ? null : snapshot().then(setActive)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

let lastCheck = 0;
let checking = null;
self.addEventListener('message', (event) => {
  if (event.data !== 'check' && event.data !== 'check-now') return;
  if (checking || (event.data === 'check' && Date.now() - lastCheck < CHECK_EVERY)) return;
  lastCheck = Date.now();
  checking = checkForUpdate()
    .then((updated) => { if (updated && event.source) event.source.postMessage('updated'); })
    .catch(() => {})
    .finally(() => { checking = null; });
  event.waitUntil(checking);
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const path = shellPath(new URL(event.request.url));
  if (!path) return; // 文件、授權檔等其他檔案：照常走網路，不經過快取
  event.respondWith((async () => {
    const name = await activeName();
    const hit = name && (await (await caches.open(name)).match(path));
    return hit || fetch(event.request);
  })());
});
