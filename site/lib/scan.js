// Interprétation du texte lu au bas d'une carte : « SV8a 212/187 SAR » → cartes candidates du catalogue.
// Fonctions pures (testées avec node --test) ; la lecture de l'image elle-même est dans ocr.js.

const fixDigits = (text) => text.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');
const key = (n) => (/^\d+$/.test(n) ? String(Number(n)) : String(n).toLowerCase());

/**
 * @returns {{ number: string|null, official: string|null, sets: string[], candidates: object[] }}
 * Une carte est proposée si son numéro correspond ET que la série ou le total officiel concorde.
 * Si une série a été lue, seules ses cartes sont gardées.
 */
export function parseScan(text, catalog) {
  const empty = { number: null, official: null, sets: [], candidates: [] };
  if (!text) return empty;

  const setIds = new Map([...new Set(catalog.cards.map((c) => c.s))].map((id) => [id.toLowerCase(), id]));
  const sets = [];
  for (const token of text.split(/[^A-Za-z0-9-]+/)) {
    const id = setIds.get(token.toLowerCase());
    if (id && !sets.includes(id)) sets.push(id);
  }

  // « numéro / total » ; le total peut être mal lu, ou être un code de série pour les promos.
  let number = null;
  let official = null;
  for (const m of text.matchAll(/([0-9OoIl|]{1,3})\s*\/\s*([0-9A-Za-z|-]{2,5})/g)) {
    const num = fixDigits(m[1]);
    if (!/^\d+$/.test(num)) continue;
    number = String(Number(num));
    const den = fixDigits(m[2]);
    official = /^\d+$/.test(den) ? String(Number(den)) : null;
    break;
  }
  if (number === null) return { ...empty, sets };

  const scored = [];
  for (const card of catalog.cards) {
    if (key(card.n) !== number) continue;
    const inSet = sets.includes(card.s);
    const sameTotal = official !== null && String(catalog.sets[card.s]?.official ?? '') === official;
    if (!inSet && !sameTotal) continue;
    scored.push({ card, inSet, score: (inSet ? 4 : 0) + (sameTotal ? 3 : 0) });
  }
  const kept = scored.some((s) => s.inSet) ? scored.filter((s) => s.inSet) : scored;
  kept.sort((a, b) => b.score - a.score
    || (catalog.sets[b.card.s]?.date ?? '').localeCompare(catalog.sets[a.card.s]?.date ?? ''));
  return { number, official, sets, candidates: kept.slice(0, 12).map((s) => s.card) };
}

/**
 * Plusieurs passes de lecture d'une même photo (cadrages et contrastes différents) : on retient le
 * couple numéro/total confirmé par le plus de passes, et parmi elles la lecture la plus précise
 * (celle qui a aussi lu la série, donc le moins de propositions).
 */
export function mergeScans(results) {
  const withCards = results.filter((r) => r.candidates.length);
  if (!withCards.length) {
    return results.find((r) => r.number !== null) ?? { number: null, official: null, sets: [], candidates: [] };
  }
  const votes = new Map();
  for (const r of withCards) {
    const k = `${r.number}/${r.official}`;
    votes.set(k, (votes.get(k) ?? 0) + 1);
  }
  let best = null;
  for (const r of withCards) {
    const k = `${r.number}/${r.official}`;
    if (best === null || votes.get(k) > votes.get(best)) best = k;
  }
  const same = withCards.filter((r) => `${r.number}/${r.official}` === best);
  return same.reduce((a, b) => (b.sets.length > a.sets.length || (b.sets.length === a.sets.length && b.candidates.length < a.candidates.length) ? b : a));
}
