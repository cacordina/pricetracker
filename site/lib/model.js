// Modèle de données partagé par le site et les scripts (ingestion, alertes) : une seule source pour
// les colonnes de l'instantané, la règle du prix retenu, les noms de fichiers et les noms affichés.

export const RARITY_LABEL = { AR: 'AR', SAR: 'SAR', promo: 'Promo', secret: 'Secrète', regular: '', unknown: '' };
// Colonnes d'une ligne de l'instantané.
// lowDays / lowGap : « au plus bas depuis N jours » et écart à la médiane de la période (voir lowestSince).
export const COL = { trend: 0, low: 1, avg1: 2, avg7: 3, avg30: 4, d7: 5, d30: 6, lowDays: 7, lowGap: 8 };

/**
 * Prix retenu partout (site, historique, alertes) : la moyenne des ventes sur 7 jours, plus fiable que la
 * tendance Cardmarket sur les cartes peu échangées ; à défaut la moyenne 30 jours, puis la tendance.
 */
export function mainPrice({ a7 = null, a30 = null, t = null }) {
  return a7 ?? a30 ?? t ?? null;
}

/** Prix retenu d'une ligne de l'instantané (voir mainPrice). */
export function priceOf(row) {
  if (!row) return null;
  return mainPrice({ t: row[COL.trend], a7: row[COL.avg7], a30: row[COL.avg30] });
}

/** D'où vient le prix retenu : "avg7" | "avg30" | "trend" | null. */
export function priceSource(row) {
  if (!row) return null;
  if (row[COL.avg7] !== null && row[COL.avg7] !== undefined) return 'avg7';
  if (row[COL.avg30] !== null && row[COL.avg30] !== undefined) return 'avg30';
  return row[COL.trend] !== null && row[COL.trend] !== undefined ? 'trend' : null;
}

/** Nom du fichier d'historique d'une extension (sans caractère risqué pour un nom de fichier ou une adresse). */
export const historyFile = (setId) =>
  `${String(setId).replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}.json`;

/** Texte pour la recherche : sans accents, en minuscules. */
export const normalizeText = (text) => String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Nom anglais Cardmarket sans la liste d'attaques entre crochets (« Sylveon ex [Magical Charm] » → « Sylveon ex »). */
export const englishName = (card) => (card.en ? card.en.replace(/\s*\[.*\]\s*$/, '').trim() : '');

/** Nom affiché : nom français, sinon nom Cardmarket sans la liste d'attaques, sinon nom japonais. */
export function displayName(card) {
  return card.fr || englishName(card) || card.ja;
}

/** Arrondi à une décimale (pourcentages). */
export const round1 = (x) => Math.round(x * 10) / 10;
