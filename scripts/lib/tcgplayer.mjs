/**
 * Prix de marché TCGplayer (États-Unis) des cartes japonaises, via tcgcsv.com, et taux de change BCE.
 * Le « market price » TCGplayer est calculé sur les ventes récentes de cartes non gradées.
 *
 * Fichiers (dans data/us/) :
 *   snapshot.json        { date, rate, rateDate, cards: { [idCardmarket]: centimes de dollar } }
 *   history/<ext>.json   { dates: [], rates: [], cards: { [idCardmarket]: [centimes de dollar | null, …] } }
 * rate = euros pour un dollar (taux de référence BCE), null s'il est inconnu.
 */
import { toCents } from './money.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Quand un produit a plusieurs variantes de prix, on préfère la finition habituelle des cartes japonaises.
const SUBTYPE_ORDER = ['Holofoil', 'Normal'];

/** Lignes de prix tcgcsv → Map productId → prix de marché en centimes de dollar (sans les produits non cotés). */
export function marketPrices(rows) {
  const best = new Map();
  for (const row of rows) {
    const cents = toCents(row.marketPrice);
    if (cents === null || cents <= 0) continue;
    const rank = (r) => { const i = SUBTYPE_ORDER.indexOf(r.subTypeName); return i < 0 ? SUBTYPE_ORDER.length : i; };
    const current = best.get(row.productId);
    if (!current || rank(row) < rank(current.row)) best.set(row.productId, { row, cents });
  }
  return new Map([...best].map(([id, { cents }]) => [id, cents]));
}

/** Taux de référence BCE (eurofxref-daily.xml) → { date, rate } avec rate = euros pour un dollar. */
export function parseEcbRate(xml) {
  const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  const usdPerEur = Number(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/.exec(xml)?.[1]);
  if (!date || !(usdPerEur > 0)) throw new Error('Taux BCE illisible');
  return { date, rate: Math.round((1 / usdPerEur) * 1e6) / 1e6 };
}

/** Prix du jour par carte du catalogue (clé : identifiant Cardmarket), via l'identifiant TCGplayer `g`. */
export function pricesByCard(catalog, byProduct) {
  const out = new Map();
  for (const card of catalog.cards) {
    const cents = card.g ? byProduct.get(card.g) : undefined;
    if (cents !== undefined) out.set(card.id, cents);
  }
  return out;
}

/**
 * Ajoute (ou remplace, si c'est le même jour) une colonne à l'historique d'une extension. Fonction pure.
 * Une carte jamais cotée n'a pas de série ; une série existante reçoit null les jours sans prix.
 */
export function putDay(history, date, rate, values, ids) {
  if (!DATE.test(date)) throw new Error(`Date invalide : ${date}`);
  const dates = history?.dates ?? [];
  const last = dates.at(-1);
  if (last && date < last) throw new Error(`Date ${date} antérieure à la dernière date connue ${last}`);
  const replace = last === date;
  const keep = replace ? dates.length - 1 : dates.length;
  const cards = {};
  for (const [id, series] of Object.entries(history?.cards ?? {})) {
    cards[id] = [...series.slice(0, keep), values.get(Number(id)) ?? null];
  }
  for (const id of ids) {
    if (cards[id] || !values.has(id)) continue;
    cards[id] = [...Array(keep).fill(null), values.get(id)];
  }
  return {
    dates: [...dates.slice(0, keep), date],
    rates: [...(history?.rates ?? Array(dates.length).fill(null)).slice(0, keep), rate],
    cards,
  };
}

export const MIN_PRICED_RATIO = 0.8;

/** Refuse un relevé nettement plus maigre que le précédent (tcgcsv incomplet) ; null si tout va bien. */
export function checkUsDay({ date, lastDate, count, lastCount }) {
  if (!DATE.test(date ?? '')) return 'Date des prix TCGplayer illisible';
  if (lastDate && date < lastDate) return `Prix TCGplayer du ${date}, antérieurs au dernier relevé ${lastDate}`;
  if (!count) return 'Aucun prix TCGplayer pour les cartes du catalogue';
  if (lastCount && count < lastCount * MIN_PRICED_RATIO) {
    return `Seulement ${count} cartes cotées sur TCGplayer contre ${lastCount} au relevé précédent (seuil ${MIN_PRICED_RATIO * 100} %)`;
  }
  return null;
}
