/**
 * Alertes de prix cible : une envie déclenche une alerte le jour où son prix passe sous la cible
 * (ou l'atteint), pas tous les jours où il y reste. Le jour précédent est lu dans l'historique : rien à mémoriser.
 */
import { displayName, formatEuro } from '../../site/lib/metrics.js';

/**
 * @param wishes    [{ user_id, id_product, target_cents }]
 * @param byId      Map idProduct → carte du catalogue
 * @param histories { [setId]: { dates, cards: { [id]: { t } } } }
 * @param date      jour qui vient d'être enregistré
 */
export function crossings({ wishes, byId, histories, date }) {
  const out = [];
  for (const wish of wishes) {
    const target = wish.target_cents;
    const card = byId.get(wish.id_product);
    if (target === null || target === undefined || !card) continue;
    const history = histories[card.s];
    const at = history?.dates.lastIndexOf(date) ?? -1;
    const series = history?.cards?.[wish.id_product]?.t;
    if (at < 0 || !series) continue;
    const trend = series[at];
    if (trend === null || trend === undefined || trend > target) continue;
    const before = series.slice(0, at).findLast((v) => v !== null && v !== undefined);
    if (before !== undefined && before <= target) continue; // déjà sous la cible au relevé précédent
    out.push({ userId: wish.user_id, card, trend, target });
  }
  return out;
}

/** Un message par utilisateur : la carte elle-même s'il n'y en a qu'une, sinon un résumé vers les envies. */
export function messages(list) {
  const byUser = Map.groupBy(list, (c) => c.userId);
  const out = new Map();
  for (const [userId, items] of byUser) {
    items.sort((a, b) => b.target - b.trend - (a.target - a.trend));
    if (items.length === 1) {
      const [{ card, trend, target }] = items;
      out.set(userId, {
        title: 'Prix cible atteint',
        body: `${displayName(card)} (${card.s} ${card.n}) : ${formatEuro(trend)}, cible ${formatEuro(target)}`,
        url: `#/carte/${card.id}`,
        tag: `prix-cible-${card.id}`,
      });
    } else {
      const names = items.slice(0, 3).map(({ card, trend }) => `${displayName(card)} ${formatEuro(trend)}`);
      out.set(userId, {
        title: `${items.length} cartes sous votre prix cible`,
        body: names.join(' · ') + (items.length > 3 ? ' …' : ''),
        url: '#/envies',
        tag: 'prix-cible',
      });
    }
  }
  return out;
}
