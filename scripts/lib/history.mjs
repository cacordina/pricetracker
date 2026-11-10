/**
 * Historique d'une extension, en colonnes :
 *   { dates: ["2026-11-09", …], cards: { [idProduct]: { t: [], l: [], a: [] } } }
 * t = trend, l = low, a = avg1, en centimes ou null. Toutes les séries ont la longueur de `dates`.
 */
const KEYS = ['t', 'l', 'a'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Ajoute un jour. Fonction pure : renvoie un nouvel historique, ou le même si la date est déjà là. */
export function appendDay(history, date, rows, ids) {
  if (!DATE.test(date)) throw new Error(`Date invalide : ${date}`);
  const dates = history?.dates ?? [];
  const last = dates.at(-1);
  if (last === date) return history;
  if (last && date < last) throw new Error(`Date ${date} antérieure à la dernière date connue ${last}`);

  const before = dates.length;
  const cards = {};
  for (const [id, series] of Object.entries(history?.cards ?? {})) {
    const row = rows.get(Number(id));
    cards[id] = Object.fromEntries(KEYS.map((k) => [k, [...series[k], row?.[k] ?? null]]));
  }
  for (const id of ids) {
    if (cards[id]) continue;
    const row = rows.get(id);
    if (!row || KEYS.every((k) => row[k] === null || row[k] === undefined)) continue; // jamais cotée : pas de série
    cards[id] = Object.fromEntries(KEYS.map((k) => [k, [...Array(before).fill(null), row[k] ?? null]]));
  }
  return { dates: [...dates, date], cards };
}
