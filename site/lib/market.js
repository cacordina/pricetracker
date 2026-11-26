// Marché et recherche : cartes qui montent, baissent, bonnes affaires, écart avec TCGplayer (États-Unis).
import { COL, priceOf, normalizeText, round1 } from './model.js';

const haystacks = new WeakMap();

/**
 * Recherche par nom japonais ou anglais, extension, numéro ; tous les mots doivent être présents.
 * `rarities` : raretés classées acceptées (null = toutes).
 */
export function searchCards(catalog, query, limit = 60, { rarities = null } = {}) {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const card of catalog.cards) {
    if (rarities && !rarities.includes(card.r)) continue;
    let hay = haystacks.get(card);
    if (!hay) {
      hay = normalizeText(`${card.ja} ${card.fr ?? ''} ${card.en ?? ''} ${card.s} ${card.n} ${catalog.sets[card.s]?.name ?? ''}`);
      haystacks.set(card, hay);
    }
    if (words.every((w) => hay.includes(w))) {
      out.push(card);
      if (out.length >= limit) break;
    }
  }
  return out;
}

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
