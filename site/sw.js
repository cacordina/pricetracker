// Service worker : le site s'ouvre sans réseau et démarre plus vite.
// - Code du site : copie complète par version, servie depuis le cache. À la publication, scripts/build-sw.mjs
//   remplace VERSION et PRECACHE ; une nouvelle version s'installe d'un bloc et le site se recharge au
//   changement d'écran suivant (app.js), pour ne jamais mélanger deux versions.
// - Données (prix, catalogue, historiques) : réseau d'abord, dernière copie reçue si le réseau manque.
// - Tout le reste (Supabase, images des cartes, polices, Tesseract) passe sans être touché.
const VERSION = 'dev';
const PRECACHE = [];

const SHELL = `shell-${VERSION}`;
const DATA = 'data';
const DATA_TIMEOUT_MS = 6000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    if (PRECACHE.length) {
      const cache = await caches.open(SHELL);
      await cache.addAll(PRECACHE.map((path) => new Request(path, { cache: 'reload' })));
    }
    // Les données de la première visite ont été chargées avant le service worker : on en garde une copie
    // tout de suite, pour que le site s'ouvre hors connexion dès la visite suivante. Sans réseau, tant pis.
    const data = await caches.open(DATA);
    await Promise.all(['data/catalog.json', 'data/snapshot.json'].map(async (path) => {
      if (await data.match(path)) return;
      const response = await fetch(path, { cache: 'no-cache' }).catch(() => null);
      if (response?.ok) await data.put(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('shell-') && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (path.startsWith('data/')) event.respondWith(networkFirst(request, DATA, DATA_TIMEOUT_MS));
  else if (request.mode === 'navigate') event.respondWith(shell(new Request('index.html'), request));
  else event.respondWith(shell(request, request));
});

/** Code du site : la copie de la version installée ; en développement (PRECACHE vide), réseau d'abord. */
async function shell(key, request) {
  if (!PRECACHE.length) return networkFirst(request, SHELL, 0, key);
  const hit = await caches.match(key, { cacheName: SHELL, ignoreSearch: true });
  return hit ?? fetch(request);
}

/** Réseau d'abord ; la dernière copie si le réseau échoue ou tarde (au-delà de `timeout` ms, 0 = attendre). */
async function networkFirst(request, cacheName, timeout, key = request) {
  const cache = await caches.open(cacheName);
  const network = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(key, response.clone());
    return response;
  });
  network.catch(() => {}); // un échec est traité plus bas ; évite une erreur « non gérée » quand le cache a répondu
  const fallback = async () => (await cache.match(key, { ignoreSearch: true })) ?? network;
  if (!timeout) return network.catch(fallback);
  const late = new Promise((resolve) => setTimeout(() => resolve('late'), timeout));
  try {
    const first = await Promise.race([network, late]);
    if (first !== 'late') return first;
    return (await cache.match(key, { ignoreSearch: true })) ?? network;
  } catch {
    return fallback();
  }
}
