// Routeur par hash et démarrage du site.
import { loadCatalog, loadSnapshot } from './lib/data.js';
import { esc } from './lib/ui.js';
import { frDate } from './lib/chart.js';
import * as store from './lib/store.js';
import { wishStatus } from './lib/metrics.js';

const ROUTES = {
  marche: () => import('./views/market.js'),
  collection: () => import('./views/collection.js'),
  ajout: () => import('./views/quickadd.js'),
  album: () => import('./views/album.js'),
  envies: () => import('./views/wishlist.js'),
  recherche: () => import('./views/search.js'),
  carte: () => import('./views/card.js'),
  connexion: () => import('./views/login.js'),
};
const TAB_OF = { ajout: 'collection', album: 'collection', carte: null, connexion: null };

const view = document.getElementById('view');
let renderId = 0;

async function render() {
  // Les liens de confirmation Supabase reviennent avec un hash qui n'est pas une route : on l'ignore.
  const [, name = 'marche', param] = location.hash.match(/^#\/([a-z]+)(?:\/(.+))?$/) ?? [];
  const load = ROUTES[name] ?? ROUTES.marche;
  const id = ++renderId;
  const tab = name in TAB_OF ? TAB_OF[name] : name;
  for (const link of document.querySelectorAll('.tabs a')) {
    link.classList.toggle('on', link.dataset.tab === tab);
    link.toggleAttribute('aria-current', link.dataset.tab === tab);
  }
  try {
    const [module, catalog, snapshot] = await Promise.all([load(), loadCatalog(), loadSnapshot()]);
    if (id !== renderId) return; // une autre navigation a eu lieu entre-temps
    const root = document.createElement('div');
    await module.render(root, { catalog, snapshot, store, param: param ? decodeURIComponent(param) : null, refresh: render });
    if (id !== renderId) return;
    view.replaceChildren(root);
    if (name !== 'ajout') window.scrollTo(0, 0);
    module.mounted?.(root); // après le retour en haut : un écran peut se placer ailleurs (album)
  } catch (err) {
    if (id !== renderId) return;
    console.error(err);
    view.innerHTML = `<p class="state">Impossible de charger les données.<br><span class="muted">${esc(err.message)}</span></p>
      <button class="btn sec" id="retry">Réessayer</button>`;
    view.querySelector('#retry').onclick = render;
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

window.addEventListener('hashchange', render);
window.addEventListener('wishes-changed', refreshWishDot);
store.onAuthChange(() => { render(); refreshWishDot(); });
render();
refreshWishDot();

export { frDate };
