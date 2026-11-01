// Сервис-воркер: приложение открывается без связи. Данные операций хранятся отдельно, в памяти браузера.
const CACHE = 'kc-money-v2';
const SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './icon-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Firebase и обращения к облаку не кэшируем
  if (url.hostname.endsWith('googleapis.com') && url.hostname !== 'fonts.googleapis.com') return;
  if (url.hostname.endsWith('gstatic.com') && url.pathname.indexOf('/firebasejs/') >= 0) return;
  // скрипт выписок (Apps Script): ответы содержат секретную ссылку и всегда должны быть свежими
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') return;
  e.respondWith(
    fetch(e.request).then(r => { if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request).then(m => m || caches.match('./index.html')))
  );
});
