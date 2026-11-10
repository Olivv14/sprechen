const CACHE = 'sprechen-core-__CACHE_VERSION__';
const RESOURCES = __RESOURCES__;
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
