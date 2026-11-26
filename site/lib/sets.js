// Extensions et grandes séries : vue d'ensemble, cartes d'une extension, album des AR / SAR.
import { priceOf } from './model.js';

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

/** Grandes séries japonaises, de la plus récente à la plus ancienne ; `from` = première sortie (secours par date). */
export const SERIES = [
  { id: 'mega', name: 'Méga-Évolution', short: 'Méga', from: '2025-07-01' },
  { id: 'sv', name: 'Écarlate et Violet', short: 'EV', from: '2022-11-01' },
  { id: 'ss', name: 'Épée et Bouclier', short: 'EB', from: '2019-11-01' },
  { id: 'sm', name: 'Soleil et Lune', short: 'SL', from: '2016-11-01' },
  { id: 'xy', name: 'XY', short: 'XY', from: '2013-12-01' },
  { id: 'bw', name: 'Noir & Blanc', short: 'N&B', from: '2010-12-01' },
  { id: 'hgss', name: 'HeartGold SoulSilver', short: 'HGSS', from: '2009-09-01' },
  { id: 'old', name: 'Séries plus anciennes', short: 'Anciennes', from: '' },
];

// Le code de l'extension dit presque toujours sa série ; l'ordre compte (« SV » avant « S », « SM » avant « S »).
const SERIES_BY_CODE = [
  [/^(SV|sv|WCS)/, 'sv'],
  [/^(SM|sm)/, 'sm'],
  [/^(S\d|S-P|SI$|s)/, 'ss'],
  [/^(M\d|M-P|MC$|MP\d|MB[DG]$|MF$|m[A-Z])/, 'mega'],
  // « XY » et « BW » tout courts sont des rééditions sorties pendant Soleil et Lune : rangées par leur date.
  [/^(XY.|X30|Y30|CP\d)/, 'xy'],
  [/^(BW.|EBB)/, 'bw'],
  [/^(L\d|LL|L-P)/, 'hgss'],
];

/** Grande série d'une extension, d'après son code, sinon d'après sa date de sortie. */
export function seriesOf(setId, date) {
  const byCode = SERIES_BY_CODE.find(([re]) => re.test(setId))?.[1];
  if (byCode) return SERIES.find((x) => x.id === byCode);
  return SERIES.find((x) => (date ?? '') >= x.from) ?? SERIES.at(-1);
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
