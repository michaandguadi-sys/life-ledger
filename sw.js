/* Life Ledger service worker: app shell network-first (updates arrive, works offline).
   Only same-origin GETs are touched; calls to api.anthropic.com pass straight through. */
const V = 'shell-v1';
const SHELL = ['./', './index.html', './local.js', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
	e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
	e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
	const url = new URL(e.request.url);
	if (e.request.method !== 'GET' || url.origin !== location.origin) return;
	e.respondWith((async () => {
		const c = await caches.open(V);
		try {
			const res = await fetch(e.request);
			if (res.ok) c.put(e.request, res.clone());
			return res;
		} catch (err) {
			return (await c.match(e.request, { ignoreSearch: true })) || (await c.match('./index.html')) || Response.error();
		}
	})());
});
