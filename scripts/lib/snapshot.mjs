/** Instantané du jour et variations. Prix en centimes, variations en % à une décimale. */
const TOLERANCE_DAYS = 3;

const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
const round1 = (x) => Math.round(x * 10) / 10;
const pct = (now, ref) => (now === null || now === undefined || !ref ? null : round1(((now - ref) / ref) * 100));

/** Index de la date de référence pour une variation sur `days` jours, ou -1. */
function refIndex(dates, date, days) {
  const target = shift(date, days);
  const oldest = shift(target, TOLERANCE_DAYS);
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] <= target) return dates[i] >= oldest ? i : -1;
  }
  return -1;
}

/** Variation du trend entre `date` et `days` jours plus tôt (dernière date connue ≤ J−N, à 3 jours près). */
export function pctChange(history, id, date, days) {
  const series = history?.cards?.[id];
  if (!series) return null;
  const now = history.dates.indexOf(date);
  const ref = refIndex(history.dates, date, days);
  if (now < 0 || ref < 0) return null;
  return pct(series.t[now], series.t[ref]);
}

/**
 * snapshot = { date, approx: { d7, d30 }, cards: { [id]: [trend, low, avg1, avg7, avg30, d7, d30] } }
 * Tant que l'historique ne remonte pas assez loin, la variation est estimée par rapport
 * à la moyenne Cardmarket (avg7 / avg30) et `approx` le signale.
 */
export function buildSnapshot({ date, prices, histories, catalog }) {
  const all = Object.values(histories);
  const approx = {
    d7: !all.some((h) => refIndex(h.dates, date, 7) >= 0),
    d30: !all.some((h) => refIndex(h.dates, date, 30) >= 0),
  };
  const cards = {};
  for (const card of catalog.cards) {
    const p = prices.get(card.id);
    if (!p || [p.t, p.l, p.a, p.a7, p.a30].every((v) => v === null || v === undefined)) continue;
    const h = histories[card.s];
    const d7 = approx.d7 ? pct(p.t, p.a7) : pctChange(h, card.id, date, 7);
    const d30 = approx.d30 ? pct(p.t, p.a30) : pctChange(h, card.id, date, 30);
    cards[card.id] = [p.t ?? null, p.l ?? null, p.a ?? null, p.a7 ?? null, p.a30 ?? null, d7, d30];
  }
  return { date, approx, cards };
}
