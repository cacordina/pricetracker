// Habillage autour des écrans : silhouettes de chargement, bandeaux (hors connexion, prix anciens),
// pastille des envies, service worker (site hors connexion et mises à jour).
import { loadSnapshot } from './data.js';
import { frDate } from './chart.js';
import { wishStatus } from './collection.js';

// Silhouette d'attente, à la forme de l'écran qui arrive (grille de cartes, liste ou fiche).
const SKELETON_OF = { album: 'grid', extension: 'grid', collection: 'grid', marche: 'rows', recherche: 'rows', extensions: 'rows', envies: 'rows', carte: 'card' };
export function skeleton(name) {
  const bar = (w, h = 14) => `<div class="sk" style="width:${w};height:${h}px"></div>`;
  const kind = SKELETON_OF[name] ?? 'rows';
  const head = `${bar('55%', 26)}${bar('35%')}`;
  if (kind === 'card') {
    return `<div class="skeleton"><div class="card-head"><div class="sk sk-card" style="width:44%;max-width:210px"></div>
      <div style="flex:1">${bar('80%', 24)}${bar('50%')}${bar('60%', 40)}${bar('70%')}</div></div>${bar('100%', 60)}${bar('100%', 150)}</div>`;
  }
  if (kind === 'grid') {
    return `<div class="skeleton">${head}${bar('100%', 44)}<div class="grid">${Array(9).fill(`<div><div class="sk sk-card"></div>${bar('70%', 12)}</div>`).join('')}</div></div>`;
  }
  return `<div class="skeleton">${head}${Array(7).fill(`<div class="sk-row"><div class="sk" style="width:50px;height:70px"></div><div style="flex:1">${bar('60%')}${bar('40%', 12)}</div>${bar('56px')}</div>`).join('')}</div>`;
}

/** Pastille sur l'onglet Envies quand une carte est passée sous son prix cible. */
export async function refreshWishDot(store) {
  const dot = document.getElementById('wish-dot');
  try {
    if (!(await store.getSession())) throw new Error('hors connexion');
    const [wishes, snapshot] = await Promise.all([store.listWishes(), loadSnapshot()]);
    dot.hidden = !wishes.some((w) => wishStatus(w, snapshot.cards[w.id_product]).underTarget);
  } catch {
    dot.hidden = true;
  }
}

/** Jours de calendrier entre une date « AAAA-MM-JJ » et aujourd'hui (date locale de l'appareil). */
export function daysSince(date, now = new Date()) {
  if (!date) return 0;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - Date.parse(`${date}T00:00:00Z`)) / 86400000);
}

/**
 * Bandeau quand les derniers prix Cardmarket datent d'avant-hier ou plus : Cardmarket n'a pas publié (ou pas encore)
 * de nouveau fichier de prix. Le site garde les derniers prix valides, sans rien inventer.
 */
export async function refreshStale() {
  const banner = document.getElementById('stale');
  const date = await loadSnapshot().then((s) => s.date, () => null);
  banner.hidden = daysSince(date) < 2;
  if (!banner.hidden) banner.textContent = `Derniers prix Cardmarket du ${frDate(date)} : Cardmarket n’a pas publié de nouveaux prix depuis. Ils seront ajoutés dès leur publication.`;
}

/** Bandeau « hors connexion », avec la date des prix affichés. */
export async function refreshOffline() {
  const banner = document.getElementById('offline');
  if (navigator.onLine) { banner.hidden = true; return; }
  const date = await loadSnapshot().then((s) => s.date, () => null);
  banner.textContent = `Hors connexion${date ? ` : prix du ${frDate(date)}` : ''}. Collection et envies en lecture seule.`;
  banner.hidden = false;
}

/**
 * Service worker : site utilisable sans réseau. Renvoie une fonction qui dit si une nouvelle version du site a pris
 * la main : on recharge alors au changement d'écran suivant plutôt que de mêler l'ancien code et le nouveau.
 */
export function registerServiceWorker() {
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
  return () => updateReady;
}
