// Chargement des fichiers de données publiés (catalogue, instantané, historiques).
import { DATA_URL } from '../config.js';
import { historyFile } from './metrics.js';

const cache = new Map();

function getJson(path, { optional = false } = {}) {
  if (!cache.has(path)) {
    const promise = fetch(`${DATA_URL}/${path}`, { cache: 'no-cache' }).then((res) => {
      if (res.status === 404 && optional) return null;
      if (!res.ok) throw new Error(`Données indisponibles (${path} : HTTP ${res.status})`);
      return res.json();
    });
    promise.catch(() => cache.delete(path)); // un échec ne doit pas rester en cache
    cache.set(path, promise);
  }
  return cache.get(path);
}

/** Catalogue des cartes japonaises, avec un index `byId`. */
export async function loadCatalog() {
  const catalog = await getJson('catalog.json');
  catalog.byId ??= new Map(catalog.cards.map((c) => [c.id, c]));
  return catalog;
}

/**
 * Instantané du jour. Une variation que l'instantané signale comme non disponible (`approx`) n'est jamais affichée :
 * les anciens instantanés y mettaient une estimation trompeuse, les nouveaux y mettent null.
 */
export const loadSnapshot = () => {
  if (!cache.has('snapshot.json#clean')) {
    const promise = getJson('snapshot.json').then((snapshot) => {
      const drop = [snapshot.approx?.d7 && 5, snapshot.approx?.d30 && 6].filter(Boolean); // colonnes d7, d30
      if (drop.length) for (const row of Object.values(snapshot.cards)) for (const i of drop) row[i] = null;
      return snapshot;
    });
    promise.catch(() => cache.delete('snapshot.json#clean')); // un échec ne doit pas rester en cache
    cache.set('snapshot.json#clean', promise);
  }
  return cache.get('snapshot.json#clean');
};

/** Historique d'une extension, ou null si elle n'a jamais été cotée. */
export const loadHistory = (setId) => getJson(`history/${historyFile(setId)}`, { optional: true });

/** Historiques de plusieurs extensions : { [setId]: history } (les absents sont omis). */
export async function loadHistories(setIds) {
  const unique = [...new Set(setIds)];
  const list = await Promise.all(unique.map((id) => loadHistory(id).catch(() => null)));
  return Object.fromEntries(unique.map((id, i) => [id, list[i]]).filter(([, h]) => h));
}

/** Prix TCGplayer du jour ({ date, rate, rateDate, cards }), ou null s'ils ne sont pas (encore) publiés. */
export const loadUsSnapshot = () => getJson('us/snapshot.json', { optional: true }).catch(() => null);

/** Historique TCGplayer d'une extension ({ dates, rates, cards }), ou null. */
export const loadUsHistory = (setId) => getJson(`us/history/${historyFile(setId)}`, { optional: true }).catch(() => null);
