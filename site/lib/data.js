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

export const loadSnapshot = () => getJson('snapshot.json');

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
