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
