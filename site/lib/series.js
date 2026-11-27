// Courbes : période affichée, variation sur la période, recalage d'une série sur d'autres dates.
import { round1 } from './model.js';

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

/**
 * « Au plus bas depuis N jours » : le prix du jour est le plus bas de la période (le jour compris) et nettement
 * sous sa médiane, pour ne pas signaler une carte dont le prix ne bouge pas. Fenêtres essayées de la plus longue
 * à la plus courte ; chacune demande un historique qui remonte assez loin (à 3 jours près) et assez de relevés.
 */
export const LOW_WINDOWS = [{ days: 90, minPoints: 40 }, { days: 30, minPoints: 14 }];
export const LOW_UNDER_MEDIAN = 0.95; // au moins 5 % sous la médiane de la période

const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;

/**
 * @param dates  dates de l'historique (croissantes) ; @param values prix retenus alignés sur `dates`
 * @param at     indice du jour examiné
 * @returns { days, gapPct } (fenêtre la plus longue satisfaite, écart à la médiane en %) ou null
 */
export function lowestSince(dates, values, at) {
  const price = values?.[at];
  if (price === null || price === undefined || at < 0) return null;
  for (const { days, minPoints } of LOW_WINDOWS) {
    const start = dayNumber(dates[at]) - days;
    if (dayNumber(dates[0]) > start + 3) continue; // l'historique ne remonte pas assez loin
    const window = [];
    for (let i = at - 1; i >= 0 && dayNumber(dates[i]) >= start; i -= 1) {
      if (values[i] !== null && values[i] !== undefined) window.push(values[i]);
    }
    if (window.length + 1 < minPoints) continue;
    if (price > Math.min(...window)) continue;
    const sorted = [...window, price].sort((a, b) => a - b);
    const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    if (price > median * LOW_UNDER_MEDIAN) continue;
    return { days, gapPct: round1(((price - median) / median) * 100) };
  }
  return null;
}
