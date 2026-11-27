/**
 * Alertes sur les envies (sur le prix retenu, la moyenne des ventes 7 j). Une envie déclenche une alerte le jour où
 * la situation apparaît, pas tous les jours où elle dure ; le jour précédent est lu dans l'historique : rien à
 * mémoriser. Trois cas, une seule alerte par carte et par jour, dans cet ordre de priorité :
 *   target : le prix passe sous la cible (ou l'atteint) ;
 *   low    : la carte devient la moins chère depuis 30 ou 90 jours (lowestSince), même sans cible ;
 *   drop   : elle perd au moins 15 % en 7 jours, même sans cible.
 */
import { displayName } from '../../site/lib/model.js';
import { formatEuro, formatPct } from '../../site/lib/format.js';
import { lowestSince } from '../../site/lib/series.js';
import { pctChange } from './snapshot.mjs';

export const DROP_PCT = -15;

const known = (v) => v !== null && v !== undefined;

/**
 * @param wishes    [{ user_id, id_product, target_cents }]
 * @param byId      Map idProduct → carte du catalogue
 * @param histories { [setId]: { dates, cards: { [id]: { p, t } } } }
 * @param date      jour qui vient d'être enregistré
 * @returns [{ userId, card, kind, trend, target?, days?, gapPct?, change? }]
 */
export function wishEvents({ wishes, byId, histories, date }) {
  const out = [];
  for (const wish of wishes) {
    const card = byId.get(wish.id_product);
    const history = card ? histories[card.s] : null;
    const at = history?.dates.lastIndexOf(date) ?? -1;
    const card$ = history?.cards?.[wish.id_product];
    const series = card$?.p;
    if (!card || at < 0 || !series || !known(series[at])) continue;
    const trend = series[at];
    const event = { userId: wish.user_id, card, trend };

    const target = wish.target_cents;
    if (known(target) && trend <= target) {
      const before = series.slice(0, at).findLast(known);
      // Déjà sous la cible au relevé précédent : pas de nouvelle alerte. Série p toute neuve (passage de la tendance
      // à la moyenne 7 j) alors que la carte était déjà cotée : ce n'est pas un passage sous la cible.
      const already = before !== undefined ? before <= target : card$.t?.slice(0, at).some(known);
      if (!already) { out.push({ ...event, kind: 'target', target }); continue; }
    }

    const low = lowestSince(history.dates, series, at);
    const lowBefore = at > 0 ? lowestSince(history.dates, series, at - 1) : null;
    if (low && !(lowBefore && lowBefore.days >= low.days)) { out.push({ ...event, kind: 'low', days: low.days, gapPct: low.gapPct }); continue; }

    const change = pctChange(history, wish.id_product, date, 7);
    const changeBefore = at > 0 ? pctChange(history, wish.id_product, history.dates[at - 1], 7) : null;
    if (change !== null && change <= DROP_PCT && !(changeBefore !== null && changeBefore <= DROP_PCT)) {
      out.push({ ...event, kind: 'drop', change });
    }
  }
  return out;
}

const RANK = { target: 0, low: 1, drop: 2 };
const strength = (e) => (e.kind === 'target' ? e.target - e.trend : e.kind === 'low' ? -e.gapPct : -e.change);

/** Ce qu'une alerte dit d'une carte, en quelques mots. */
function short(e) {
  const name = displayName(e.card);
  if (e.kind === 'low') return `${name} au plus bas ${e.days} j`;
  if (e.kind === 'drop') return `${name} ${formatPct(e.change)}`;
  return `${name} ${formatEuro(e.trend)}`;
}

/** Un message par utilisateur : la carte elle-même s'il n'y en a qu'une, sinon un résumé vers les envies. */
export function messages(list) {
  const byUser = Map.groupBy(list, (e) => e.userId);
  const out = new Map();
  for (const [userId, items] of byUser) {
    items.sort((a, b) => RANK[a.kind ?? 'target'] - RANK[b.kind ?? 'target'] || strength(b) - strength(a));
    if (items.length === 1) {
      const [e] = items;
      const where = `${displayName(e.card)} (${e.card.s} ${e.card.n})`;
      const msg = e.kind === 'low'
        ? { title: `Au plus bas depuis ${e.days} jours`, body: `${where} : ${formatEuro(e.trend)}, ${formatPct(e.gapPct)} sous sa médiane sur ${e.days} jours` }
        : e.kind === 'drop'
        ? { title: `${formatPct(e.change)} en 7 jours`, body: `${where} : ${formatEuro(e.trend)}` }
        : { title: 'Prix cible atteint', body: `${where} : ${formatEuro(e.trend)}, cible ${formatEuro(e.target)}` };
      out.set(userId, { ...msg, url: `#/carte/${e.card.id}`, tag: `envie-${e.card.id}` });
    } else {
      const allTarget = items.every((e) => (e.kind ?? 'target') === 'target');
      out.set(userId, {
        title: allTarget ? `${items.length} cartes sous votre prix cible` : `${items.length} cartes de vos envies à surveiller`,
        body: items.slice(0, 3).map(short).join(' · ') + (items.length > 3 ? ' …' : ''),
        url: '#/envies',
        tag: 'envies',
      });
    }
  }
  return out;
}
