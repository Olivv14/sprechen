const CACHE = 'sprechen-core-03d838211c5333bf';
const RESOURCES = ["/sprechen/.nojekyll","/sprechen/404.html","/sprechen/apple-touch-icon.png","/sprechen/assets/index-CuFachSo.css","/sprechen/assets/legacy-0a6805017f71a194.js","/sprechen/assets/paths-d164e1d69cc54926.js","/sprechen/assets/paths-c98b257b77db36eb.css","/sprechen/audio/pod-de-accent.mp3","/sprechen/audio/pod-de-bar.mp3","/sprechen/audio/pod-de-bill.mp3","/sprechen/audio/pod-de-handsfree.mp3","/sprechen/audio/pod-de-hotel.mp3","/sprechen/audio/pod-de-saikan.mp3","/sprechen/audio/pod-de-ubahn.mp3","/sprechen/audio/pod-de-vienna.mp3","/sprechen/corpus/ammo.json","/sprechen/corpus/audio_only.json","/sprechen/corpus/expansions_de.json","/sprechen/corpus/feeds_dw.json","/sprechen/corpus/frames_de.json","/sprechen/corpus/frames_it.json","/sprechen/corpus/frames_pt.json","/sprechen/corpus/INDEX.json","/sprechen/corpus/podcasts_index.json","/sprechen/corpus/quests.json","/sprechen/corpus/schema.json","/sprechen/corpus/taboos.json","/sprechen/corpus/tatoeba_samples.json","/sprechen/course.json","/sprechen/favicon.svg","/sprechen/fonts/fonts.css","/sprechen/fonts/jakarta-0.woff2","/sprechen/fonts/jakarta-1.woff2","/sprechen/fonts/jakarta-2.woff2","/sprechen/fonts/jakarta-3.woff2","/sprechen/fonts/LICENSE-Material-Symbols.txt","/sprechen/fonts/OFL-Plus-Jakarta-Sans.txt","/sprechen/fonts/SOURCES.md","/sprechen/fonts/symbols-0.woff2","/sprechen/icon-192.png","/sprechen/icons.svg","/sprechen/img/berlin.jpg","/sprechen/img/cafe.jpg","/sprechen/img/club.jpg","/sprechen/img/dinner.jpg","/sprechen/img/dinner.png","/sprechen/img/lina.jpg","/sprechen/img/mara.jpg","/sprechen/img/night.jpg","/sprechen/img/night.mp4","/sprechen/img/npc-flirt.png","/sprechen/img/npc-fr.png","/sprechen/img/npc-it.png","/sprechen/img/npc-pt.png","/sprechen/img/paris.svg","/sprechen/img/rain.jpg","/sprechen/index.html","/sprechen/manifest.json","/sprechen/video/CREDITS.md","/sprechen/video/terrace.mp4","/sprechen/video/ubahn.mp4"];
async function invalidate(cache) {
  if (await cache.delete('/sprechen/__ready__')) {
    for (const client of await self.clients.matchAll()) client.postMessage({ type: 'CORE_INCOMPLETE', version: CACHE });
  }
}
async function missingCore(cache) {
  const missing = [];
  for (const resource of RESOURCES) {
    const response = await cache.match(resource);
    if (!response?.ok || (!/\.html$/.test(resource) && /text\/html/i.test(response.headers.get('content-type') || ''))) missing.push(resource);
  }
  return missing;
}
async function status() {
  const cache = await caches.open(CACHE), missing = await missingCore(cache);
  if (missing.length) await invalidate(cache);
  const marker = await cache.match('/sprechen/__ready__');
  return { ready: missing.length === 0 && !!marker && await marker.text() === CACHE, version: CACHE, missing };
}
async function prepare() {
  const cache = await caches.open(CACHE);
  await cache.addAll(RESOURCES);
  if ((await missingCore(cache)).length) throw Error('Required core resources are incomplete.');
  await cache.put('/sprechen/__ready__', new Response(CACHE));
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      await prepare();
      await self.skipWaiting();
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener('activate', event => {
  // Retain older build caches for already open tabs; avoid breaking unfinished work.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE') event.waitUntil((async () => { if ((await status()).ready) await self.skipWaiting(); })());
  if (event.data === 'STATUS' || event.data === 'REPAIR') event.waitUntil((async () => {
    try {
      if (event.data === 'REPAIR') await prepare();
      event.ports[0]?.postMessage(await status());
    } catch (error) {
      await invalidate(await caches.open(CACHE));
      event.ports[0]?.postMessage({ ready: false, version: CACHE, error: error.message });
    }
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/sprechen/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (event.request.mode === 'navigate' && !/\.[^/]+$/.test(url.pathname)) {
      try { return await fetch(event.request); } catch {
        return await cache.match('/sprechen/index.html') || new Response('Offline preparation is incomplete.', { status: 503 });
      }
    }
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    if (RESOURCES.includes(url.pathname)) await invalidate(cache);
    const previous = /\/assets\/(paths|legacy)-[a-f0-9]+\.(js|css)$/.test(url.pathname) ? await caches.match(event.request, { ignoreSearch: true }) : undefined;
    if (previous) return previous;
    try {
      const response = await fetch(event.request);
      if (!/\.html$/.test(url.pathname) && /text\/html/i.test(response.headers.get('content-type') || '')) throw Error('Resource returned HTML.');
      return response;
    } catch { return new Response('Offline preparation is incomplete. Reconnect and retry offline preparation.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
  })());
});
