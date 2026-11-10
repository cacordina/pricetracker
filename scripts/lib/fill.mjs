/**
 * Complète le catalogue quand TCGdex ne relie pas (ou mal) une extension à Cardmarket.
 * Le catalogue TCGplayer Japon (tcgcsv) donne, par extension, le numéro et le nom anglais de chaque carte ;
 * l'export Cardmarket donne les noms anglais par extension (sans numéro). On retrouve l'extension Cardmarket
 * par concordance des noms, puis chaque carte par son nom (et son rang parmi les homonymes).
 */
import { numberKey } from './tcgcsv.mjs';

/** Nom comparable entre sources : sans attaques, numéro, variante, casse ni ponctuation. */
export const normName = (name) => String(name ?? '')
  .replace(/\s*\[.*\]\s*$/, '').replace(/\s*-\s*\d+\/.*$/, '').replace(/\s*\(.*?\)\s*/g, ' ')
  .normalize('NFKD').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const normCache = new WeakMap();
const normList = (list) => {
  if (!normCache.has(list)) normCache.set(list, list.map((p) => normName(p.name)));
  return normCache.get(list);
};

/**
 * Extension Cardmarket d'un groupe de cartes. `byExp` : Map idExpansion → produits.
 * Candidate = au moins 75 % des noms en commun et une taille voisine (0,8× à 1,35×).
 * Plusieurs candidates (versions par langue) : `hint` tranche s'il en fait partie, sinon { ambiguous }.
 */
export function chooseExpansion({ names, byExp, hint, override }) {
  if (override !== undefined) return byExp.has(override) ? { expansion: override } : { none: true };
  const wanted = names.map(normName);
  const n = wanted.length;
  if (n < 3) return { none: true };
  const bag = new Map();
  for (const name of wanted) bag.set(name, (bag.get(name) ?? 0) + 1);

  const candidates = [];
  for (const [id, list] of byExp) {
    if (list.length < n * 0.8 || list.length > n * 1.35) continue;
    const left = new Map(bag);
    let common = 0;
    for (const name of normList(list)) {
      const k = left.get(name);
      if (k > 0) { left.set(name, k - 1); common += 1; }
    }
    if (common >= n * 0.75) candidates.push({ id, common });
  }
  if (!candidates.length) return { none: true };
  candidates.sort((a, b) => b.common - a.common || a.id - b.id);
  if (candidates.some((c) => c.id === hint)) return { expansion: hint };
  if (candidates.length === 1 || candidates[0].common - candidates[1].common >= n * 0.1) return { expansion: candidates[0].id };
  return { ambiguous: candidates.map((c) => c.id).sort((a, b) => a - b) };
}

/**
 * Associe chaque carte (numéro + nom anglais TCGplayer) à un produit Cardmarket de l'extension.
 * 1. Par nom, quand les deux sources ont le même nombre d'homonymes : k-ième numéro ↔ k-ième idProduct.
 * 2. Sinon (nom traduit différemment) : par position, si la carte est encadrée par deux voisines sûres
 *    dont l'écart d'idProduct égale l'écart de numéros.
 * Renvoie Map numéro → idProduct, dans l'ordre des numéros.
 */
export function alignCards(tcgCards, cmProducts) {
  const numeric = (c) => (/^\d+$/.test(numberKey(c.number)) ? Number(numberKey(c.number)) : null);
  const cards = [...tcgCards].sort((a, b) => (numeric(a) ?? Infinity) - (numeric(b) ?? Infinity) || String(a.number).localeCompare(String(b.number)));
  const cmByName = Map.groupBy([...cmProducts].sort((a, b) => a.idProduct - b.idProduct), (p) => normName(p.name));
  const tcgByName = Map.groupBy(cards, (c) => normName(c.name));
  const ids = new Set(cmProducts.map((p) => p.idProduct));

  const found = new Map();
  const used = new Set();
  for (const [name, list] of tcgByName) {
    const twins = cmByName.get(name);
    if (!twins || twins.length !== list.length) continue;
    list.forEach((card, i) => { found.set(card, twins[i].idProduct); used.add(twins[i].idProduct); });
  }
  cards.forEach((card, i) => {
    if (found.has(card) || numeric(card) === null) return;
    const before = cards.slice(0, i).findLast((c) => found.has(c) && numeric(c) !== null);
    const after = cards.slice(i + 1).find((c) => found.has(c) && numeric(c) !== null);
    if (!before || !after) return;
    const a = found.get(before);
    const b = found.get(after);
    if (b - a !== numeric(after) - numeric(before)) return;
    const id = a + (numeric(card) - numeric(before));
    if (!ids.has(id) || used.has(id)) return;
    found.set(card, id);
    used.add(id);
  });
  return new Map(cards.filter((c) => found.has(c)).map((c) => [c.number, found.get(c)]));
}

/**
 * Ajoute les cartes manquantes et corrige celles rattachées à une autre extension Cardmarket.
 * `groups` : { [setId]: { name, date, official, cards: [{ number, name, rarity, productId }] } }.
 * `overrides` : { [setId]: idExpansion } (overrides/expansions.json). `jaNames` : { [setId]: { [numéro]: nom } }.
 * Renvoie { [setId]: { expansion, added, fixed } | { ambiguous: [...] } | { none: true } }.
 */
export function fillCatalog(catalog, { groups, products, overrides = {}, jaNames = {} }) {
  const byExp = Map.groupBy(products, (p) => p.idExpansion);
  const productById = new Map(products.map((p) => [p.idProduct, p]));
  const owner = new Map(catalog.cards.map((c) => [c.id, c]));
  const report = {};

  for (const [setId, group] of Object.entries(groups)) {
    const existing = catalog.cards.filter((c) => c.s === setId);
    // Indice : l'extension Cardmarket de la majorité des cartes déjà reliées par TCGdex.
    const counts = new Map();
    for (const c of existing) {
      const e = productById.get(c.id)?.idExpansion;
      if (e !== undefined) counts.set(e, (counts.get(e) ?? 0) + 1);
    }
    const [top] = [...counts].sort((a, b) => b[1] - a[1]);
    const hint = top && top[1] > existing.length * 0.6 ? top[0] : undefined;

    const choice = chooseExpansion({ names: group.cards.map((c) => c.name), byExp, hint, override: overrides[setId] });
    if (choice.expansion === undefined) { report[setId] = choice; continue; }

    const matches = alignCards(group.cards, byExp.get(choice.expansion));
    const byNumber = new Map(existing.map((c) => [numberKey(c.n), c]));
    const stats = { expansion: choice.expansion, added: 0, fixed: 0 };
    for (const card of group.cards) {
      const id = matches.get(card.number);
      if (id === undefined) continue;
      const taken = owner.get(id);
      const current = byNumber.get(numberKey(card.number));
      if (current) {
        if (!current.ja && jaNames[setId]?.[card.number]) current.ja = jaNames[setId][card.number];
        if (current.id === id || taken) continue;
        owner.delete(current.id);
        current.id = id;
        current.en = productById.get(id).name;
        owner.set(id, current);
        stats.fixed += 1;
      } else {
        if (taken) continue;
        const added = {
          id, t: `${setId}-${card.number}`, s: setId, n: String(card.number),
          ja: jaNames[setId]?.[card.number] ?? '', en: productById.get(id).name, q: null, r: 'unknown',
          ...(card.rarity ? { q2: card.rarity } : {}), g: card.productId,
        };
        catalog.cards.push(added);
        owner.set(id, added);
        stats.added += 1;
      }
    }
    if (!catalog.sets[setId] && stats.added) {
      catalog.sets[setId] = { name: group.name, official: group.official ?? null, total: group.cards.length, img: null, date: group.date ?? null };
    }
    report[setId] = stats;
  }
  return report;
}
