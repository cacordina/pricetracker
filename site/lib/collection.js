// Collection et envies : valeur, courbe, plus-value, statut des envies, complétion.
import { COL, priceOf, round1 } from './model.js';

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

/** Les `n` cartes possédées au prix unitaire le plus élevé (pour la vitrine de l'accueil). */
export function topOwned(holdings, catalog, snapshot, n = 3) {
  return holdings
    .map((h) => ({ card: catalog.byId.get(h.id_product), trend: priceOf(snapshot.cards[h.id_product]) }))
    .filter((x) => x.card && x.trend !== null)
    .sort((a, b) => b.trend - a.trend)
    .slice(0, n)
    .map((x) => x.card);
}

/**
 * Mouvements de la collection sur 7 jours (variation du prix retenu, d7) : les plus fortes hausses et baisses
 * parmi les cartes possédées, et l'évolution de la valeur des cartes dont la variation est connue.
 * `deltaCents` : gain ou perte sur 7 jours pour la quantité possédée. `known` = false tant qu'aucune variation n'existe.
 */
export function collectionMovers(holdings, catalog, snapshot, { n = 3 } = {}) {
  const items = [];
  let nowCents = 0;
  let thenCents = 0;
  for (const h of holdings) {
    const card = catalog.byId.get(h.id_product);
    const row = snapshot.cards[h.id_product];
    const price = priceOf(row);
    const change = row?.[COL.d7] ?? null;
    if (!card || price === null || change === null || change <= -100) continue;
    const before = Math.round(price / (1 + change / 100));
    nowCents += price * h.qty;
    thenCents += before * h.qty;
    items.push({ card, price, change, qty: h.qty, deltaCents: (price - before) * h.qty });
  }
  const deltaCents = nowCents - thenCents;
  return {
    known: items.length > 0,
    ups: items.filter((i) => i.change > 0).sort((a, b) => b.change - a.change).slice(0, n),
    downs: items.filter((i) => i.change < 0).sort((a, b) => a.change - b.change).slice(0, n),
    deltaCents,
    pct: thenCents ? round1((deltaCents / thenCents) * 100) : null,
  };
}
