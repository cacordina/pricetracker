/** Convertit un prix en euros (nombre ou null) en centimes entiers. */
export function toCents(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  // toPrecision gomme la dérive binaire (1.005 * 100 = 100.49999…)
  return Math.round(Number((value * 100).toPrecision(12)));
}
