// Démarrage du site : routes (par le hash de l'adresse) et affichage d'un écran.
import { loadCatalog, loadSnapshot } from './lib/data.js';
import { esc } from './lib/ui.js';
import * as store from './lib/store.js';
import { beginNavigation, placePage, endNavigation, addingPage } from './lib/nav.js';
import { skeleton, refreshWishDot, refreshStale, refreshOffline, registerServiceWorker } from './lib/shell.js';

const ROUTES = {
  accueil: () => import('./views/home.js'),
  marche: () => import('./views/market.js'),
  collection: () => import('./views/collection.js'),
  album: () => import('./views/album.js'),
  envies: () => import('./views/wishlist.js'),
  recherche: () => import('./views/search.js'),
  scan: () => import('./views/scan.js'),
  carte: () => import('./views/card.js'),
  extensions: () => import('./views/sets.js'),
  extension: () => import('./views/set.js'),
  connexion: () => import('./views/login.js'),
};
// Onglet de la barre du bas allumé pour chaque écran (null : aucun).
const TAB_OF = { album: 'collection', recherche: null, carte: null, connexion: null, extensions: null, extension: null };

const view = document.getElementById('view');
let renderId = 0;

async function render() {
  // Les liens de confirmation Supabase reviennent avec un hash qui n'est pas une route : on l'ignore.
  const [, name = 'accueil', param] = location.hash.match(/^#\/([a-z]+)(?:\/(.+))?$/) ?? [];
  // « Ajouter des cartes » n'est pas un écran : c'est la page d'une extension en mode ajout.
  if (name === 'ajout') {
    location.replace(addingPage(await loadCatalog()));
    return;
  }
  const load = ROUTES[name] ?? ROUTES.accueil;
  const id = ++renderId;
  const tab = name in TAB_OF ? TAB_OF[name] : name;
  for (const link of document.querySelectorAll('.tabs a')) {
    link.classList.toggle('on', link.dataset.tab === tab);
    link.toggleAttribute('aria-current', link.dataset.tab === tab);
  }
  for (const link of document.querySelectorAll('.top [data-top]')) link.classList.toggle('on', link.dataset.top === name);
  beginNavigation(name);
  // Au-delà d'un instant, la silhouette de l'écran attendu remplace l'ancien écran.
  const waiting = setTimeout(() => { if (id === renderId) view.innerHTML = skeleton(name); }, 150);
  try {
    const [module, catalog, snapshot] = await Promise.all([load(), loadCatalog(), loadSnapshot()]);
    if (id !== renderId) return; // une autre navigation a eu lieu entre-temps
    const root = document.createElement('div');
    await module.render(root, { catalog, snapshot, store, param: param ? decodeURIComponent(param) : null, refresh: render });
    if (id !== renderId) return;
    view.replaceChildren(root);
    placePage(() => module.mounted?.(root));
  } catch (err) {
    if (id !== renderId) return;
    console.error(err);
    view.innerHTML = `<p class="state">Impossible de charger les données.<br><span class="muted">${esc(err.message)}</span></p>
      <button class="btn sec" id="retry">Réessayer</button>`;
    view.querySelector('#retry').onclick = render;
  } finally {
    clearTimeout(waiting);
    if (id === renderId) endNavigation(); // une navigation plus récente garde la main
  }
}

const updateReady = registerServiceWorker();
window.addEventListener('hashchange', () => (updateReady() ? location.reload() : render()));
window.addEventListener('online', () => { refreshOffline(); refreshWishDot(store); });
window.addEventListener('offline', refreshOffline);
window.addEventListener('wishes-changed', () => refreshWishDot(store));
store.onAuthChange(() => { render(); refreshWishDot(store); });
render();
refreshWishDot(store);
refreshOffline();
refreshStale();
