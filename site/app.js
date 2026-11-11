// Routeur par hash et démarrage du site.
import { loadCatalog, loadSnapshot } from './lib/data.js';
import { esc } from './lib/ui.js';
import { frDate } from './lib/chart.js';
import * as store from './lib/store.js';
import { wishStatus } from './lib/metrics.js';

const ROUTES = {
  accueil: () => import('./views/home.js'),
  marche: () => import('./views/market.js'),
  collection: () => import('./views/collection.js'),
  ajout: () => import('./views/quickadd.js'),
  album: () => import('./views/album.js'),
  envies: () => import('./views/wishlist.js'),
  recherche: () => import('./views/search.js'),
  scan: () => import('./views/scan.js'),
  carte: () => import('./views/card.js'),
  extensions: () => import('./views/sets.js'),
  extension: () => import('./views/set.js'),
  connexion: () => import('./views/login.js'),
};
const TAB_OF = { ajout: 'collection', album: 'collection', recherche: null, carte: null, connexion: null, extensions: null, extension: null };

const view = document.getElementById('view');
let renderId = 0;

// Retour arrière : chaque page visitée (entrée d'historique) garde sa position de défilement,
// pour revenir au même endroit d'une liste après avoir ouvert une carte. Une nouvelle page s'ouvre en haut.
history.scrollRestoration = 'manual';
const SCROLLS_KEY = 'carnet:scrolls';
const scrolls = new Map((() => { try { return Object.entries(JSON.parse(sessionStorage.getItem(SCROLLS_KEY) ?? '{}')); } catch { return []; } })());
let rendering = false; // pendant un changement d'écran, le défilement ne doit rien écraser
const entryId = () => history.state?.carnet ?? null;
// Profondeur de la page dans la navigation de l'app (0 = première page ouverte) : le bouton retour revient
// en arrière s'il y a une page précédente dans l'app, sinon il mène à la page parente (sans quitter l'app).
let shownDepth = -1;
function markEntry() {
  history.replaceState({ ...(history.state ?? {}), carnet: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, depth: shownDepth + 1 }, '');
}

// Pages qui ne sont pas un onglet : bouton retour, et page parente quand il n'y a pas de page précédente.
const PARENT = { carte: '#/accueil', extension: '#/extensions', extensions: '#/accueil', album: '#/extensions', recherche: '#/accueil', connexion: '#/accueil', ajout: '#/collection' };
const backButton = document.getElementById('back');
backButton.onclick = () => {
  if ((history.state?.depth ?? 0) > 0) history.back();
  else location.hash = PARENT[backButton.dataset.route] ?? '#/accueil';
};
window.addEventListener('scroll', () => {
  const entry = entryId();
  if (!rendering && entry) scrolls.set(entry, Math.round(window.scrollY));
}, { passive: true });
// Gardé pour la session (rechargement, mise à jour du site) ; seules les 60 dernières pages comptent.
const keepScrolls = () => {
  try { sessionStorage.setItem(SCROLLS_KEY, JSON.stringify(Object.fromEntries([...scrolls].slice(-60)))); } catch { /* stockage bloqué */ }
};
window.addEventListener('pagehide', keepScrolls);
document.addEventListener('visibilitychange', () => { if (document.hidden) keepScrolls(); });

async function render() {
  // Les liens de confirmation Supabase reviennent avec un hash qui n'est pas une route : on l'ignore.
  const [, name = 'accueil', param] = location.hash.match(/^#\/([a-z]+)(?:\/(.+))?$/) ?? [];
  const load = ROUTES[name] ?? ROUTES.accueil;
  const id = ++renderId;
  const tab = name in TAB_OF ? TAB_OF[name] : name;
  for (const link of document.querySelectorAll('.tabs a')) {
    link.classList.toggle('on', link.dataset.tab === tab);
    link.toggleAttribute('aria-current', link.dataset.tab === tab);
  }
  for (const link of document.querySelectorAll('.top [data-top]')) link.classList.toggle('on', link.dataset.top === name);
  const sub = name in PARENT;
  backButton.hidden = !sub;
  backButton.dataset.route = name;
  document.querySelector('.top').classList.toggle('sub', sub);
  rendering = true;
  try {
    const [module, catalog, snapshot] = await Promise.all([load(), loadCatalog(), loadSnapshot()]);
    if (id !== renderId) return; // une autre navigation a eu lieu entre-temps
    const root = document.createElement('div');
    await module.render(root, { catalog, snapshot, store, param: param ? decodeURIComponent(param) : null, refresh: render });
    if (id !== renderId) return;
    view.replaceChildren(root);
    const entry = entryId();
    const saved = entry ? scrolls.get(entry) : undefined;
    if (saved === undefined && name !== 'ajout') window.scrollTo(0, 0);
    module.mounted?.(root); // après le retour en haut : un écran peut se placer ailleurs (album)
    if (saved !== undefined) window.scrollTo(0, saved); // retour arrière : l'endroit où l'on était
    if (!entry) markEntry();
    shownDepth = history.state?.depth ?? 0;
  } catch (err) {
    if (id !== renderId) return;
    console.error(err);
    view.innerHTML = `<p class="state">Impossible de charger les données.<br><span class="muted">${esc(err.message)}</span></p>
      <button class="btn sec" id="retry">Réessayer</button>`;
    view.querySelector('#retry').onclick = render;
  } finally {
    if (id === renderId) rendering = false; // une navigation plus récente garde la main
  }
}

/** Pastille sur l'onglet Envies quand une carte est passée sous son prix cible. */
async function refreshWishDot() {
  const dot = document.getElementById('wish-dot');
  try {
    if (!(await store.getSession())) throw new Error('hors connexion');
    const [wishes, snapshot] = await Promise.all([store.listWishes(), loadSnapshot()]);
    dot.hidden = !wishes.some((w) => wishStatus(w, snapshot.cards[w.id_product], null).underTarget);
  } catch {
    dot.hidden = true;
  }
}

/** Bandeau « hors connexion », avec la date des prix affichés. */
async function refreshOffline() {
  const banner = document.getElementById('offline');
  if (navigator.onLine) { banner.hidden = true; return; }
  const date = await loadSnapshot().then((s) => s.date, () => null);
  banner.textContent = `Hors connexion${date ? ` : prix du ${frDate(date)}` : ''}. Collection et envies en lecture seule.`;
  banner.hidden = false;
}

// Service worker : site utilisable sans réseau. Quand une nouvelle version du site prend la main,
// on recharge au changement d'écran suivant plutôt que de mêler l'ancien code et le nouveau.
let updateReady = false;
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) updateReady = true; });
  // Notification touchée alors que le site était ouvert : le service worker demande d'aller à la carte.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'open') location.hash = new URL(event.data.url).hash;
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker :', err)));
}

window.addEventListener('hashchange', () => (updateReady ? location.reload() : render()));
window.addEventListener('online', () => { refreshOffline(); refreshWishDot(); });
window.addEventListener('offline', refreshOffline);
window.addEventListener('wishes-changed', refreshWishDot);
store.onAuthChange(() => { render(); refreshWishDot(); });
render();
refreshWishDot();
refreshOffline();

export { frDate };
