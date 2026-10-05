/* ナディーショーダナ — Service Worker
   プロトタイプ用の最小構成。更新時は CACHE のバージョンを上げる。 */
const CACHE = 'nadi-v8';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
];

// Voice guide clips. Added individually with a catch, so a missing file
// never breaks the install step.
for (const lang of ['ja', 'en']) {
  for (const n of ['inhale-left','inhale-right','hold','exhale-left','exhale-right',
                   'prep-inhale','prep-exhale','prep-start']) {
    ASSETS.push('./audio/' + lang + '/' + n + '.mp3');
  }
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // 1件でも失敗すると全体が落ちるため個別に追加する
      .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // HTML はネットワーク優先（更新を取りこぼさない）、失敗したらキャッシュ
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // それ以外はキャッシュ優先
  e.respondWith(
    caches.match(req).then(r => r || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => r))
  );
});
