// Navigation : position de défilement de chaque page, bouton retour, raccourci « Ajouter des cartes ».
import { loadPrefs, savePrefs } from './ui.js';

// Chaque page visitée (entrée d'historique) garde sa position de défilement : « précédent » ramène au même
// endroit d'une liste. Une nouvelle page s'ouvre en haut.
history.scrollRestoration = 'manual';
const SCROLLS_KEY = 'carnet:scrolls';
const scrolls = new Map((() => { try { return Object.entries(JSON.parse(sessionStorage.getItem(SCROLLS_KEY) ?? '{}')); } catch { return []; } })());
let navigating = false; // pendant un changement d'écran, le défilement ne doit rien écraser
const entryId = () => history.state?.carnet ?? null;

// Profondeur de la page dans la navigation de l'app (0 = première page ouverte) : le bouton retour revient
// en arrière s'il y a une page précédente dans l'app, sinon il mène à la page parente (sans quitter l'app).
let shownDepth = -1;
function markEntry() {
  history.replaceState({ ...(history.state ?? {}), carnet: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, depth: shownDepth + 1 }, '');
}

window.addEventListener('scroll', () => {
  const entry = entryId();
  if (!navigating && entry) scrolls.set(entry, Math.round(window.scrollY));
}, { passive: true });
// Gardé pour la session (rechargement, mise à jour du site) ; seules les 60 dernières pages comptent.
const keepScrolls = () => {
  try { sessionStorage.setItem(SCROLLS_KEY, JSON.stringify(Object.fromEntries([...scrolls].slice(-60)))); } catch { /* stockage bloqué */ }
};
window.addEventListener('pagehide', keepScrolls);
document.addEventListener('visibilitychange', () => { if (document.hidden) keepScrolls(); });

// Pages qui ne sont pas un onglet : bouton retour, et page parente quand il n'y a pas de page précédente.
const PARENT = { carte: '#/accueil', extension: '#/extensions', extensions: '#/accueil', album: '#/extensions', recherche: '#/accueil', connexion: '#/accueil' };
const backButton = document.getElementById('back');
backButton.onclick = () => {
  if ((history.state?.depth ?? 0) > 0) history.back();
  else location.hash = PARENT[backButton.dataset.route] ?? '#/accueil';
};

/** Début d'un changement d'écran : en-tête (bouton retour) et défilement en pause. */
export function beginNavigation(name) {
  const sub = name in PARENT;
  backButton.hidden = !sub;
  backButton.dataset.route = name;
  document.querySelector('.top').classList.toggle('sub', sub);
  navigating = true;
}

/**
 * Écran affiché : retour à l'endroit où l'on était (précédent) ou en haut (nouvelle page). `mounted` est appelé
 * entre les deux, une fois l'écran en haut : un écran peut se placer ailleurs lui-même (album sur une extension).
 */
export function placePage(mounted) {
  const entry = entryId();
  const saved = entry ? scrolls.get(entry) : undefined;
  if (saved === undefined) window.scrollTo(0, 0);
  mounted?.();
  if (saved !== undefined) window.scrollTo(0, saved);
  if (!entry) markEntry();
  shownDepth = history.state?.depth ?? 0;
}

/** Fin d'un changement d'écran (réussi ou non) : le défilement est de nouveau enregistré. */
export function endNavigation() {
  navigating = false;
}

/**
 * « Ajouter des cartes » (#/ajout) : la page de la dernière extension utilisée en mode ajout (sinon la plus récente).
 * Renvoie l'adresse où aller ; l'entrée d'historique est remplacée pour que « précédent » ne revienne pas ici.
 */
export function addingPage(catalog) {
  const used = new Set(catalog.cards.map((c) => c.s));
  const newest = Object.entries(catalog.sets).filter(([id]) => used.has(id))
    .sort(([a, x], [b, y]) => (y.date ?? '').localeCompare(x.date ?? '') || a.localeCompare(b))[0]?.[0];
  const last = loadPrefs('quickadd', {}).set;
  savePrefs('set', { ...loadPrefs('set', {}), mode: 'add' });
  return `#/extension/${encodeURIComponent(used.has(last) ? last : newest)}`;
}
