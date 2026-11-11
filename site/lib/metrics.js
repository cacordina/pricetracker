// Fonctions pures du site (testées avec node --test). Prix en centimes.

export const RARITY_LABEL = { AR: 'AR', SAR: 'SAR', promo: 'Promo', secret: 'Secrète', regular: '', unknown: '' };
// Colonnes d'une ligne de l'instantané.
export const COL = { trend: 0, low: 1, avg1: 2, avg7: 3, avg30: 4, d7: 5, d30: 6 };

/**
 * Prix retenu partout sur le site : la moyenne des ventes sur 7 jours (plus fiable que la tendance Cardmarket
 * sur les cartes peu échangées), à défaut la moyenne 30 jours, puis la tendance. Même règle que mainPrice
 * côté ingestion (scripts/lib/money.mjs), qui l'enregistre dans l'historique (série p).
 */
export function priceOf(row) {
  if (!row) return null;
  return row[COL.avg7] ?? row[COL.avg30] ?? row[COL.trend] ?? null;
}

/** D'où vient le prix retenu : "avg7" | "avg30" | "trend" | null. */
export function priceSource(row) {
  if (!row) return null;
  if (row[COL.avg7] !== null && row[COL.avg7] !== undefined) return 'avg7';
  if (row[COL.avg30] !== null && row[COL.avg30] !== undefined) return 'avg30';
  return row[COL.trend] !== null && row[COL.trend] !== undefined ? 'trend' : null;
}

const NBSP = ' ';
const THIN = ' ';

export function formatEuro(cents) {
  if (cents === null || cents === undefined) return '—';
  const [int, dec] = (Math.abs(cents) / 100).toFixed(2).split('.');
  return `${cents < 0 ? '−' : ''}${int.replace(/\B(?=(\d{3})+$)/g, THIN)},${dec}${NBSP}€`;
}

/** Centimes de dollar → « 85,20 $ ». */
export const formatUsd = (cents) => formatEuro(cents).replace('€', '$');

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

/**
 * Recherche eBay limitée aux ventes conclues (annonces terminées et vendues), triée des plus récentes.
 * eBay n'offre pas d'API publique pour ces ventes : on ouvre sa page de résultats.
 */
export function ebaySoldUrl(card, sets = {}) {
  const name = card.en ? card.en.replace(/\s*\[.*\]\s*$/, '').trim() : '';
  const official = sets[card.s]?.official;
  const number = official && /^\d+$/.test(card.n) ? `${card.n}/${official}` : card.n;
  const query = ['pokemon', name, number, 'japanese'].filter(Boolean).join(' ');
  const params = new URLSearchParams({ _nkw: query, LH_Sold: 1, LH_Complete: 1, _sop: 13 });
  return `https://www.ebay.fr/sch/i.html?${params}`;
}

const normalize = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const haystacks = new WeakMap();

/**
 * Recherche par nom japonais ou anglais, extension, numéro ; tous les mots doivent être présents.
 * `rarities` : raretés classées acceptées (null = toutes).
 */
export function searchCards(catalog, query, limit = 60, { rarities = null } = {}) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const card of catalog.cards) {
    if (rarities && !rarities.includes(card.r)) continue;
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
    const trend = priceOf(row);
    if (trend === null || trend < minCents) continue;
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

/** Prix TCGplayer en centimes de dollar → centimes d'euro au taux donné (euros pour un dollar), ou null. */
export function usdToEur(usdCents, rate) {
  if (usdCents === null || usdCents === undefined || !(rate > 0)) return null;
  return Math.round(usdCents * rate);
}

/** Écart du prix américain (converti en euros) par rapport à Cardmarket, en %, ou null. */
export function usGap(cardmarketCents, usEurCents) {
  if (!cardmarketCents || usEurCents === null || usEurCents === undefined) return null;
  return round1(((usEurCents - cardmarketCents) / cardmarketCents) * 100);
}

/**
 * Cartes nettement moins chères sur Cardmarket qu'aux États-Unis : écart TCGplayer ≥ `minGap` %.
 * Triées par écart décroissant.
 */
export function cheaperInEurope(catalog, snapshot, us, { rarities = null, minCents = 0, minGap = 20, limit = 100 }) {
  if (!us?.rate) return [];
  const out = [];
  for (const card of catalog.cards) {
    if (rarities && !rarities.includes(card.r)) continue;
    const trend = priceOf(snapshot.cards[card.id]);
    if (trend === null || trend < minCents) continue;
    const usEur = usdToEur(us.cards[card.id], us.rate);
    const change = usGap(trend, usEur);
    if (change === null || change < minGap) continue;
    out.push({ card, trend, change, usEur });
  }
  return out.sort((a, b) => b.change - a.change).slice(0, limit);
}

/**
 * Recale une série sur d'autres dates : pour chaque date, la dernière valeur connue à cette date ou avant,
 * si elle n'a pas plus de `maxDays` jours (les relevés américains et Cardmarket n'ont pas la même date).
 */
export function alignTo(dates, otherDates, otherValues, maxDays = 3) {
  const day = (d) => Date.parse(`${d}T00:00:00Z`) / 86400000;
  let j = -1;
  return dates.map((date) => {
    while (j + 1 < otherDates.length && otherDates[j + 1] <= date) j += 1;
    for (let k = j; k >= 0 && day(date) - day(otherDates[k]) <= maxDays; k -= 1) {
      const v = otherValues[k];
      if (v !== null && v !== undefined) return v;
    }
    return null;
  });
}

/** Valeur actuelle de la collection. `unpriced` = lignes sans prix (ou carte inconnue). */
export function collectionValue(holdings, snapshot) {
  let totalCents = 0;
  let unpriced = 0;
  let count = 0;
  for (const h of holdings) {
    count += h.qty;
    const trend = priceOf(snapshot.cards[h.id_product]);
    if (trend === null) unpriced += 1;
    else totalCents += trend * h.qty;
  }
  return { totalCents, unpriced, count };
}

/**
 * Valeur de la collection jour par jour.
 * Une carte sans prix à une date reprend son dernier prix connu ; elle ne compte pas avant son premier prix.
 * Avec `fromPurchase`, une carte dont la date d'achat est connue ne compte qu'à partir de cette date ;
 * sans, c'est la collection actuelle appliquée aux prix passés (l'évolution des seuls prix).
 */
export function collectionSeries(holdings, histories, { fromPurchase = false } = {}) {
  if (!holdings.length) return { dates: [], values: [] };
  const all = Object.values(histories);
  const dates = [...new Set(all.flatMap((h) => h.dates))].sort();
  const values = dates.map(() => null);
  for (const holding of holdings) {
    const history = all.find((h) => h.cards[holding.id_product]);
    if (!history) continue;
    const series = history.cards[holding.id_product].p ?? [];
    const indexOf = new Map(history.dates.map((d, i) => [d, i]));
    let lastKnown = null;
    dates.forEach((date, i) => {
      const at = indexOf.get(date);
      const price = at === undefined ? null : series[at];
      if (price !== null && price !== undefined) lastKnown = price;
      if (fromPurchase && holding.bought_on && date < holding.bought_on) return;
      if (lastKnown !== null) values[i] = (values[i] ?? 0) + lastKnown * holding.qty;
    });
  }
  return { dates, values };
}

/**
 * Somme payée jour par jour pour les cartes dont le prix d'achat est connu, à partir de leur date d'achat
 * (ou du début de la courbe si elle n'est pas renseignée). null tant que rien n'est payé, ou si aucun prix n'est saisi.
 */
export function paidSeries(dates, holdings) {
  const paid = holdings.filter((h) => h.paid_cents !== null && h.paid_cents !== undefined);
  if (!paid.length) return null;
  return dates.map((date) => {
    let total = null;
    for (const h of paid) if (!h.bought_on || date >= h.bought_on) total = (total ?? 0) + h.paid_cents * h.qty;
    return total;
  });
}

/**
 * Plus-value des cartes dont on connaît à la fois le prix d'achat (par exemplaire) et le prix du jour.
 * `missing` : exemplaires sans prix d'achat ; `unpriced` : exemplaires payés mais sans prix du jour.
 */
export function collectionGain(holdings, snapshot) {
  let paidCents = 0;
  let valueCents = 0;
  let count = 0;
  let missing = 0;
  let unpriced = 0;
  for (const h of holdings) {
    if (h.paid_cents === null || h.paid_cents === undefined) { missing += h.qty; continue; }
    const trend = priceOf(snapshot.cards[h.id_product]);
    if (trend === null) { unpriced += h.qty; continue; }
    paidCents += h.paid_cents * h.qty;
    valueCents += trend * h.qty;
    count += h.qty;
  }
  const gainCents = valueCents - paidCents;
  return { paidCents, valueCents, gainCents, pct: count && paidCents ? round1((gainCents / paidCents) * 100) : null, count, missing, unpriced };
}

const MIN_POINTS_LOW30 = 14;

/** Statut d'une envie par rapport à son prix cible et à l'historique récent. */
export function wishStatus(wish, row, history) {
  const trend = priceOf(row);
  const target = wish.target_cents ?? null;
  const gapCents = trend !== null && target !== null ? trend - target : null;
  let low30 = false;
  const series = history?.cards?.[wish.id_product]?.p;
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

/**
 * Taux de complétion pour un ensemble de raretés : cartes distinctes possédées / cartes existantes,
 * au total et par extension (les plus récentes d'abord). Les doublons ne comptent qu'une fois.
 */
export function completion(holdings, catalog, rarities) {
  const ownedIds = new Set(holdings.map((h) => h.id_product));
  const bySet = new Map();
  for (const card of catalog.cards) {
    if (!rarities.includes(card.r)) continue;
    const entry = bySet.get(card.s) ?? { set: card.s, name: catalog.sets[card.s]?.name ?? card.s, owned: 0, total: 0 };
    entry.total += 1;
    if (ownedIds.has(card.id)) entry.owned += 1;
    bySet.set(card.s, entry);
  }
  const pct = (owned, total) => (total ? Math.round((owned / total) * 100) : 0);
  const sets = [...bySet.values()]
    .map((e) => ({ ...e, pct: pct(e.owned, e.total) }))
    .sort((a, b) => (catalog.sets[b.set]?.date ?? '').localeCompare(catalog.sets[a.set]?.date ?? '') || a.set.localeCompare(b.set));
  const owned = sets.reduce((n, e) => n + e.owned, 0);
  const total = sets.reduce((n, e) => n + e.total, 0);
  return { owned, total, pct: pct(owned, total), sets };
}

/**
 * Album d'une ou plusieurs raretés : toutes les cartes, groupées par extension (récentes d'abord),
 * triées par numéro, avec la quantité possédée. `show` = "all" | "missing" | "owned" filtre les cartes
 * affichées ; `owned` et `total` portent toujours sur l'extension entière. Les groupes vides sont omis.
 */
export function album(catalog, holdings, { rarities, show = 'all' }) {
  const qty = new Map(holdings.map((h) => [h.id_product, h.qty]));
  const groups = new Map();
  for (const card of catalog.cards) {
    if (!rarities.includes(card.r)) continue;
    if (!groups.has(card.s)) groups.set(card.s, { set: card.s, name: catalog.sets[card.s]?.name ?? card.s, owned: 0, total: 0, cards: [] });
    const group = groups.get(card.s);
    const have = qty.get(card.id) ?? 0;
    group.total += 1;
    if (have) group.owned += 1;
    if (show === 'all' || (show === 'owned') === have > 0) group.cards.push({ card, qty: have });
  }
  return [...groups.values()]
    .filter((g) => g.cards.length)
    .map((g) => ({ ...g, cards: g.cards.sort((a, b) => a.card.n.localeCompare(b.card.n, 'fr', { numeric: true })) }))
    .sort((a, b) => (catalog.sets[b.set]?.date ?? '').localeCompare(catalog.sets[a.set]?.date ?? '') || a.set.localeCompare(b.set));
}

/**
 * Album à plat, toutes extensions confondues, trié par prix du jour (`dir` : "desc" ou "asc").
 * Les cartes sans prix viennent toujours à la fin.
 */
export function albumByPrice(catalog, holdings, snapshot, { rarities, show = 'all', dir = 'desc' }) {
  const cards = album(catalog, holdings, { rarities, show })
    .flatMap((g) => g.cards)
    .map((item) => ({ ...item, trend: priceOf(snapshot.cards[item.card.id]) }));
  const sign = dir === 'asc' ? 1 : -1;
  return cards.sort((a, b) => {
    if (a.trend === null || b.trend === null) return (a.trend === null) - (b.trend === null);
    return sign * (a.trend - b.trend);
  });
}

/**
 * Vue d'ensemble des extensions, les plus récentes d'abord : nombre de cartes du catalogue, cartes possédées
 * (distinctes), valeur de l'extension complète (un exemplaire de chaque carte cotée) et carte la plus chère.
 */
export function setsOverview(catalog, snapshot, holdings = []) {
  const owned = new Set(holdings.map((h) => h.id_product));
  const bySet = new Map();
  for (const card of catalog.cards) {
    const entry = bySet.get(card.s) ?? { set: card.s, name: catalog.sets[card.s]?.name ?? card.s, date: catalog.sets[card.s]?.date ?? null, total: 0, owned: 0, valueCents: 0, top: null, topCents: -1 };
    const price = priceOf(snapshot.cards[card.id]);
    entry.total += 1;
    if (owned.has(card.id)) entry.owned += 1;
    if (price !== null) {
      entry.valueCents += price;
      if (price > entry.topCents) { entry.top = card; entry.topCents = price; }
    }
    bySet.set(card.s, entry);
  }
  return [...bySet.values()]
    .map(({ topCents, ...e }) => e)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.set.localeCompare(b.set));
}

/**
 * Cartes d'une extension avec quantité possédée et prix retenu.
 * rarities : null = toutes ; show : "all" | "missing" | "owned" ; sort : "num" | "desc" | "asc" (sans prix à la fin).
 */
export function setCards(catalog, snapshot, holdings, setId, { rarities = null, show = 'all', sort = 'num' } = {}) {
  const qty = new Map(holdings.map((h) => [h.id_product, h.qty]));
  const items = catalog.cards
    .filter((c) => c.s === setId && (!rarities || rarities.includes(c.r)))
    .map((card) => ({ card, qty: qty.get(card.id) ?? 0, price: priceOf(snapshot.cards[card.id]) }))
    .filter((i) => show === 'all' || (show === 'owned') === i.qty > 0);
  const byNumber = (a, b) => a.card.n.localeCompare(b.card.n, 'fr', { numeric: true });
  if (sort === 'num') return items.sort(byNumber);
  const sign = sort === 'asc' ? 1 : -1;
  return items.sort((a, b) => {
    if (a.price === null || b.price === null) return (a.price === null) - (b.price === null) || byNumber(a, b);
    return sign * (a.price - b.price) || byNumber(a, b);
  });
}

/** Les `n` cartes possédées au prix unitaire le plus élevé (pour la vitrine de l'accueil). */
export function topOwned(holdings, catalog, snapshot, n = 3) {
  return holdings
    .map((h) => ({ card: catalog.byId.get(h.id_product), trend: priceOf(snapshot.cards[h.id_product]) }))
    .filter((x) => x.card && x.trend !== null)
    .sort((a, b) => b.trend - a.trend)
    .slice(0, n)
    .map((x) => x.card);
}
