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

  return { number, official, sets, candidates: matchCards(catalog, { number, official, sets }) };
}

/** Cartes dont le numéro correspond ET dont la série ou le total officiel concorde (12 au plus). */
export function matchCards(catalog, { number, official, sets }) {
  if (number === null) return [];
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
  return kept.slice(0, 12).map((s) => s.card);
}

/**
 * Cumul des lectures d'images successives d'une même carte : le numéro peut être lu sur une image,
 * la série ou le total sur une autre. Tout est oublié quand le numéro change ou après deux lectures vides.
 */
export function createEvidence(catalog) {
  let number = null;
  let official = null;
  let sets = [];
  let empty = 0;
  const clear = () => { number = null; official = null; sets = []; };
  return {
    add(result) {
      const nothing = result.number === null && !result.sets.length;
      if (nothing) {
        empty += 1;
        if (empty >= 2) clear();
        return result;
      }
      empty = 0;
      if (result.number !== null && number !== null && result.number !== number) clear();
      if (result.number !== null) number = result.number;
      if (result.official !== null) official = result.official;
      for (const id of result.sets) if (!sets.includes(id)) sets.push(id);
      // une série lue avant que le numéro ne soit connu peut venir d'un texte parasite : on ne garde que les concordantes
      const merged = { number, official, sets: [...sets] };
      const candidates = matchCards(catalog, merged);
      return candidates.length ? { ...merged, candidates } : result;
    },
    clear,
  };
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

/**
 * Suivi des lectures successives en scan automatique. `push(lecture)` renvoie { candidates } quand une
 * carte vient d'être reconnue, sinon null.
 * - Lecture complète (série + total lus) : acceptée tout de suite.
 * - Lecture partielle : acceptée si la lecture suivante donne les mêmes cartes.
 * - Une carte déjà signalée ne l'est plus tant qu'elle reste devant la caméra ; elle le redevient
 *   après `missesToReset` lectures vides (carte retirée) ou dès qu'une autre carte est reconnue.
 */
export function createTracker({ missesToReset = 3 } = {}) {
  let reported = null;
  let pending = null;
  let misses = 0;
  return {
    push(result) {
      if (!result.candidates.length) {
        pending = null;
        misses += 1;
        if (misses >= missesToReset) reported = null;
        return null;
      }
      misses = 0;
      const key = result.candidates.map((c) => c.id).join(',');
      if (key === reported) { pending = null; return null; }
      const confident = result.sets.length > 0 && result.official !== null;
      if (!confident && pending !== key) { pending = key; return null; }
      pending = null;
      reported = key;
      return { candidates: result.candidates };
    },
    reset() { reported = null; pending = null; misses = 0; },
  };
}
