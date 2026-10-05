/* ナディーショーダナ — Service Worker
   プロトタイプ用の最小構成。更新時は CACHE のバージョンを上げる。 */
const CACHE = 'nadi-v17';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
];

// Voice guide clips. Added individually with a catch, so a missing file
// never breaks the install step.
// ryo は録音した肉声で日本語のみ。種類ごとに対応言語が違う。
const VOICE_SETS = [
  { kind: 'warm',  langs: ['ja', 'en'] },
  { kind: 'space', langs: ['ja', 'en'] },
  { kind: 'male',  langs: ['ja', 'en'] },
  { kind: 'ryo',   langs: ['ja'] },
];
for (const { kind, langs } of VOICE_SETS) {
  for (const lang of langs) {
    for (const n of ['inhale-left','inhale-right','hold','exhale-left','exhale-right',
                     'prep-inhale','prep-exhale']) {
      ASSETS.push('./audio/' + kind + '/' + lang + '/' + n + '.mp3');
    }
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

  // このハンドラは same-origin 専用。将来サードパーティへのリクエストが
  // 追加されても、意図せずキャッシュされないようここで素通しする。
  if (new URL(req.url).origin !== self.location.origin) return;

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
