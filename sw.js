// Service Worker — แคช "เปลือกแอป" (HTML/CSS/JS/ไอคอน) ไว้ให้เปิดแอปได้แม้ไม่มีเน็ต
// หมายเหตุ: ข้อมูลแคตตาล็อก (CSV จาก Google Sheet) ไม่ได้แคชที่นี่ — จัดการแยกด้วย localStorage
// ในไฟล์ script.js แทน เพราะลิงก์ CSV ของ Google มีการ redirect หลายชั้น แคชที่ระดับ HTTP ไม่นิ่งพอ

const CACHE_NAME = 'catalog-hub-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './assets/c2loop-mark-white.svg',
  './assets/c2loop-mark-green.svg',
  './assets/c2loop-icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// เฉพาะไฟล์ในโดเมนตัวเอง (app shell) เท่านั้นที่ใช้ cache-first — คำขออื่น (Google Sheet, Apps Script, QR, Drive)
// ปล่อยผ่านไปที่เน็ตเวิร์กตามปกติ ไม่ยุ่งเกี่ยว
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      }).catch(() => cached);
    })
  );
});
