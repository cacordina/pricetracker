// Fonctions pures du site (testées avec node --test). Prix en centimes.

export const RARITY_LABEL = { AR: 'AR', SAR: 'SAR', secret: 'Secrète', regular: '', unknown: '' };
// Colonnes d'une ligne de l'instantané.
export const COL = { trend: 0, low: 1, avg1: 2, avg7: 3, avg30: 4, d7: 5, d30: 6 };

const NBSP = ' ';
const THIN = ' ';

export function formatEuro(cents) {
  if (cents === null || cents === undefined) return '—';
  const [int, dec] = (Math.abs(cents) / 100).toFixed(2).split('.');
  return `${cents < 0 ? '−' : ''}${int.replace(/\B(?=(\d{3})+$)/g, THIN)},${dec}${NBSP}€`;
}

export function formatPct(value) {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(1).replace('.', ',')}${NBSP}%`;
}

export const historyFile = (setId) =>
  `${String(setId).replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}.json`;

/** Adresses d'image possibles, par ordre de préférence : TCGdex, puis l'image de secours TCGplayer. */
export function imageUrls(card, sets, quality = 'low') {
  const urls = [];
  const base = sets?.[card.s]?.img;
  if (base) urls.push(`${base}/${card.n}/${quality}.webp`);
  if (card.g) urls.push(`https://tcgplayer-cdn.tcgplayer.com/product/${card.g}_${quality === 'high' ? 'in_1000x1000' : '200w'}.jpg`);
  return urls;
}

export const imageUrl = (card, sets, quality = 'low') => imageUrls(card, sets, quality)[0] ?? null;

/** Fiche Cardmarket d'une carte ; `filters` ajoute des filtres d'offres (ex. { language: 7, sellerCountry: 12 }). */
export function cardmarketUrl(idProduct, filters = {}) {
  const params = new URLSearchParams({ idProduct, ...filters });
  return `https://www.cardmarket.com/fr/Pokemon/Products?${params}`;
}

const normalize = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const haystacks = new WeakMap();

/** Recherche par nom japonais ou anglais, extension, numéro ; tous les mots doivent être présents. */
export function searchCards(catalog, query, limit = 60) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const card of catalog.cards) {
    let hay = haystacks.get(card);
    if (!hay) {
      hay = normalize(`${card.ja} ${card.fr ?? ''} ${card.en ?? ''} ${card.s} ${card.n} ${catalog.sets[card.s]?.name ?? ''}`);
      haystacks.set(card, hay);
    }
    if (words.every((w) => hay.includes(w))) {
      out.push(card);
      if (out.length >= limit) break;
    }
  }
  return out;
}

const round1 = (x) => Math.round(x * 10) / 10;

/** Liste du marché : hausses, baisses ou bonnes affaires. */
export function marketList(catalog, snapshot, { rarities = null, tab = 'up', window = 7, minCents = 0, dealRatio = 0.85, limit = 100 }) {
  const col = window === 30 ? COL.d30 : COL.d7;
  const out = [];
  for (const card of catalog.cards) {
    if (rarities && !rarities.includes(card.r)) continue;
    const row = snapshot.cards[card.id];
    const trend = row?.[COL.trend];
    if (trend === null || trend === undefined || trend < minCents) continue;
    let change;
    if (tab === 'deals') {
      const avg30 = row[COL.avg30];
      if (!avg30 || trend > avg30 * dealRatio) continue;
      change = round1(((trend - avg30) / avg30) * 100);
    } else {
      change = row[col];
      if (change === null || change === undefined) continue;
      if (tab === 'up' ? change <= 0 : change >= 0) continue;
    }
    out.push({ card, trend, change });
  }
  out.sort((a, b) => (tab === 'up' ? b.change - a.change : a.change - b.change));
  return out.slice(0, limit);
}

/** Valeur actuelle de la collection. `unpriced` = lignes sans prix (ou carte inconnue). */
export function collectionValue(holdings, snapshot) {
  let totalCents = 0;
  let unpriced = 0;
  let count = 0;
  for (const h of holdings) {
    count += h.qty;
    const trend = snapshot.cards[h.id_product]?.[COL.trend];
    if (trend === null || trend === undefined) unpriced += 1;
    else totalCents += trend * h.qty;
  }
  return { totalCents, unpriced, count };
}

/**
 * Valeur de la collection actuelle appliquée aux prix passés.
 * Une carte sans prix à une date reprend son dernier prix connu ; elle ne compte pas avant son premier prix.
 */
export function collectionSeries(holdings, histories) {
  if (!holdings.length) return { dates: [], values: [] };
  const all = Object.values(histories);
  const dates = [...new Set(all.flatMap((h) => h.dates))].sort();
  const values = dates.map(() => null);
  for (const holding of holdings) {
    const history = all.find((h) => h.cards[holding.id_product]);
    if (!history) continue;
    const series = history.cards[holding.id_product].t;
    const indexOf = new Map(history.dates.map((d, i) => [d, i]));
    let lastKnown = null;
    dates.forEach((date, i) => {
      const at = indexOf.get(date);
      const price = at === undefined ? null : series[at];
      if (price !== null && price !== undefined) lastKnown = price;
      if (lastKnown !== null) values[i] = (values[i] ?? 0) + lastKnown * holding.qty;
    });
  }
  return { dates, values };
}

const MIN_POINTS_LOW30 = 14;

/** Statut d'une envie par rapport à son prix cible et à l'historique récent. */
export function wishStatus(wish, row, history) {
  const trend = row?.[COL.trend] ?? null;
  const target = wish.target_cents ?? null;
  const gapCents = trend !== null && target !== null ? trend - target : null;
  let low30 = false;
  const series = history?.cards?.[wish.id_product]?.t;
  if (trend !== null && series) {
    const recent = series.slice(-30).filter((v) => v !== null && v !== undefined);
    low30 = recent.length >= MIN_POINTS_LOW30 && trend <= Math.min(...recent);
  }
  return {
    underTarget: gapCents !== null && gapCents <= 0,
    gapCents,
    low30,
    rising: (row?.[COL.d7] ?? 0) > 3,
  };
}

/** Sous la cible d'abord (la plus forte décote en tête), puis écart croissant, sans cible à la fin. */
export function sortWishes(items) {
  const rank = (s) => (s.underTarget ? 0 : s.gapCents !== null ? 1 : 2);
  return [...items].sort((a, b) =>
    rank(a.status) - rank(b.status) || (a.status.gapCents ?? 0) - (b.status.gapCents ?? 0));
}

/** Nom affiché : nom français, sinon nom Cardmarket sans la liste d'attaques, sinon nom japonais. */
export function displayName(card) {
  if (card.fr) return card.fr;
  const en = card.en ? card.en.replace(/\s*\[.*\]\s*$/, '').trim() : '';
  return en || card.ja;
}

/** Index du premier point à afficher pour une période "7" | "30" | "90" | "all". */
export function sliceRange(dates, range) {
  if (!dates.length || range === 'all') return 0;
  const from = new Date(Date.parse(`${dates.at(-1)}T00:00:00Z`) - Number(range) * 86400000).toISOString().slice(0, 10);
  const i = dates.findIndex((d) => d >= from);
  return i < 0 ? 0 : i;
}

/** Variation entre le premier et le dernier point non nuls d'une série. */
export function rangeChange(values) {
  const known = values.filter((v) => v !== null && v !== undefined);
  if (known.length < 2 || !known[0]) return null;
  const deltaCents = known.at(-1) - known[0];
  return { deltaCents, pct: round1((deltaCents / known[0]) * 100) };
}

/** Lignes (collection ou envies) dont l'identifiant Cardmarket a été remplacé dans le catalogue. */
export function staleIds(rows, aliases) {
  if (!aliases) return [];
  return rows.filter((r) => aliases[r.id_product] !== undefined).map((r) => ({ from: r.id_product, to: aliases[r.id_product] }));
}
