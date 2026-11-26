/**
 * Résumé hebdomadaire de la collection, envoyé en notification le premier jour de relevé d'une nouvelle semaine
 * (lundi, ou le jour suivant si Cardmarket n'a rien publié le lundi). Sans état à mémoriser : on compare la semaine
 * du relevé du jour à celle du relevé précédent.
 */
import { priceOf, displayName } from '../../site/lib/model.js';
import { formatEuro, formatPct } from '../../site/lib/format.js';
import { collectionMovers } from '../../site/lib/collection.js';

/** Lundi de la semaine d'une date « AAAA-MM-JJ ». */
export function weekStart(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Vrai si `date` est le premier relevé d'une nouvelle semaine (ou s'il n'y a pas de relevé précédent connu). */
export const isNewWeek = (date, previousDate) => !previousDate || weekStart(date) !== weekStart(previousDate);

/**
 * Un message par compte qui possède au moins une carte cotée.
 * @param holdings [{ user_id, id_product, qty }]
 */
export function weeklySummaries({ holdings, catalog, snapshot }) {
  const out = new Map();
  for (const [userId, rows] of Map.groupBy(holdings, (h) => h.user_id)) {
    let valueCents = 0;
    let count = 0;
    for (const h of rows) {
      const price = priceOf(snapshot.cards[h.id_product]);
      if (price === null || !catalog.byId.has(h.id_product)) continue;
      valueCents += price * h.qty;
      count += h.qty;
    }
    if (!count) continue;
    const moves = collectionMovers(rows, catalog, snapshot, { n: 1 });
    const parts = [`${formatEuro(valueCents)} pour ${count} carte${count > 1 ? 's' : ''}`];
    if (moves.known && moves.pct !== null) parts.push(`${moves.deltaCents >= 0 ? '+' : '−'}${formatEuro(Math.abs(moves.deltaCents))} (${formatPct(moves.pct)}) en 7 jours`);
    const best = moves.ups[0];
    if (best) parts.push(`plus forte hausse : ${displayName(best.card)} ${formatPct(best.change)}`);
    out.set(userId, { title: 'Votre collection cette semaine', body: parts.join(' · '), url: '#/collection', tag: 'resume-hebdo' });
  }
  return out;
}
