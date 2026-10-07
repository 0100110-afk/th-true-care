/* Service worker: mở app được khi mạng yếu/mất mạng.
   - HTML/JS/CSS của app: lấy mạng trước, lỗi mạng thì dùng bản đã lưu (để bản mới luôn được ưu tiên).
   - Firestore / Firebase Auth / Google APIs: KHÔNG chặn — dữ liệu đã có lớp lưu riêng trong IndexedDB.
   Tăng VERSION khi muốn xoá sạch bản lưu cũ trên máy người dùng. */
const VERSION = 'care-v1';
const SHELL = ['./', './index.html', './desktop.html', './mobile.html', './manifest.webmanifest',
  './css/auth.css', './js/gas-shim.js', './js/core.js', './js/app.js', './js/firebase-config.js',
  './icons/icon-192.png', './icons/favicon-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const staticCdn = /(^|\.)(gstatic\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com)$/.test(url.hostname)
    && !url.pathname.includes('/v1/');
  if (!sameOrigin && !staticCdn) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: sameOrigin }))
  );
});
