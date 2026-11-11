/** Convertit un prix en euros (nombre ou null) en centimes entiers. */
export function toCents(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  // toPrecision gomme la dérive binaire (1.005 * 100 = 100.49999…)
  return Math.round(Number((value * 100).toPrecision(12)));
}

/**
 * Prix retenu par le site pour une carte : la moyenne des ventes sur 7 jours, plus fiable que la tendance
 * Cardmarket sur les cartes peu échangées ; à défaut la moyenne 30 jours, puis la tendance.
 * Même règle que priceOf côté site (site/lib/metrics.js).
 */
export function mainPrice({ a7 = null, a30 = null, t = null }) {
  return a7 ?? a30 ?? t ?? null;
}
