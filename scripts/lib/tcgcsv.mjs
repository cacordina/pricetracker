/**
 * Source de secours : catalogue TCGplayer « Pokémon Japan » (catégorie 85) via tcgcsv.com.
 * TCGdex n'a ni image ni rareté pour beaucoup d'extensions japonaises récentes ; on y prend
 * l'identifiant d'image (`g`) et la rareté (`q2`), en associant par extension + numéro de carte.
 */
const BASE = 'https://tcgcsv.com/tcgplayer/85';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Clé de numéro commune aux deux sources : "091/063" et "091" → "91" ; "SV-P 12" reste tel quel. */
export const numberKey = (value) => {
  const head = String(value ?? '').split('/')[0].trim();
  return /^\d+$/.test(head) ? String(Number(head)) : head.toLowerCase();
};

/** Map numéro → { productId, name, rarity } ; à numéro égal, le produit sans variante « (…) » gagne. */
export function indexProducts(products) {
  const index = new Map();
  for (const p of products) {
    const ext = Object.fromEntries((p.extendedData ?? []).map((e) => [e.name, e.value]));
    if (!ext.Number) continue;
    const key = numberKey(ext.Number);
    const entry = { productId: p.productId, name: p.name, rarity: ext.Rarity ?? null, number: String(ext.Number).split('/')[0].trim(), total: String(ext.Number).split('/')[1]?.trim() ?? null };
    const current = index.get(key);
    if (!current || (/\(/.test(current.name) && !/\(/.test(p.name))) index.set(key, entry);
  }
  return index;
}

/** Map setId → groupId, par abréviation insensible à la casse. */
export function matchGroups(groups, setIds) {
  const byAbbr = new Map(groups.filter((g) => g.abbreviation).map((g) => [g.abbreviation.toLowerCase(), g.groupId]));
  const out = new Map();
  for (const id of setIds) {
    const groupId = byAbbr.get(id.toLowerCase());
    if (groupId !== undefined) out.set(id, groupId);
  }
  return out;
}

/** Ajoute `g` (image de secours) et `q2` (rareté de secours) aux cartes ; ne retire jamais une valeur existante. */
export function enrichCatalog(catalog, indexBySet) {
  for (const card of catalog.cards) {
    const hit = indexBySet[card.s]?.get(numberKey(card.n));
    if (!hit) continue;
    card.g = hit.productId;
    if (hit.rarity) card.q2 = hit.rarity;
  }
  return catalog;
}

/** Télécharge les produits des extensions demandées. Une extension en erreur est simplement ignorée. */
export async function fetchIndexes(setIds, { fetchImpl = fetch, delayMs = 150, log = () => {} } = {}) {
  const get = async (path) => {
    const res = await fetchImpl(`${BASE}${path}`, { headers: { 'user-agent': 'jp-card-price-tracker' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).results ?? [];
  };
  const out = {};
  let groups;
  try {
    groups = matchGroups(await get('/groups'), setIds);
  } catch (err) {
    log(`tcgcsv indisponible (${err.message}) : images et raretés de secours inchangées`);
    return out;
  }
  for (const [setId, groupId] of groups) {
    try {
      out[setId] = indexProducts(await get(`/${groupId}/products`));
    } catch (err) {
      log(`tcgcsv ${setId}: ${err.message}`);
    }
    await sleep(delayMs);
  }
  return out;
}

/**
 * Toutes les extensions du catalogue TCGplayer Japon, avec leurs cartes.
 * Renvoie { [setId]: { name, date, official, index, cards } } ; `setId` reprend l'identifiant TCGdex quand
 * l'abréviation concorde (sans tenir compte de la casse), sinon l'abréviation TCGplayer.
 */
export async function fetchGroups(knownSetIds, { fetchImpl = fetch, delayMs = 120, log = () => {} } = {}) {
  const get = async (path) => {
    const res = await fetchImpl(`${BASE}${path}`, { headers: { 'user-agent': 'jp-card-price-tracker' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).results ?? [];
  };
  const known = new Map(knownSetIds.map((id) => [id.toLowerCase(), id]));
  const out = {};
  let groups;
  try {
    groups = await get('/groups');
  } catch (err) {
    log(`tcgcsv indisponible (${err.message}) : catalogue non complété cette fois`);
    return out;
  }
  for (const group of groups) {
    const abbr = group.abbreviation?.trim();
    if (!abbr) continue;
    const setId = known.get(abbr.toLowerCase()) ?? abbr;
    if (out[setId]) continue;
    try {
      const products = await get(`/${group.groupId}/products`);
      const index = indexProducts(products);
      const cards = [...index.values()].map((e) => ({ number: e.number, name: e.name, rarity: e.rarity, productId: e.productId }));
      // total officiel = dénominateur le plus fréquent (« 091/063 » → 63)
      const totals = new Map();
      for (const e of index.values()) if (/^\d+$/.test(e.total ?? '')) totals.set(Number(e.total), (totals.get(Number(e.total)) ?? 0) + 1);
      const [official] = [...totals].sort((a, b) => b[1] - a[1])[0] ?? [null];
      out[setId] = { name: group.name, date: group.publishedOn?.slice(0, 10) ?? null, official, index, cards, box: sealedProduct(products) };
    } catch (err) {
      log(`tcgcsv ${setId}: ${err.message}`);
    }
    await sleep(delayMs);
  }
  return out;
}

/** Nom anglais TCGplayer d'une extension, sans le code en tête : « SV11B: Black Bolt » → « Black Bolt ». */
export const englishSetName = (groupName) => String(groupName ?? '').replace(/^[^:]{1,12}:\s*/, '').trim() || null;

// Produit scellé qui sert d'image à l'extension : la display (booster box) d'abord, puis le booster, puis un coffret.
const SEALED = [/booster box|display/i, /booster pack|booster\b/i, /box|collection|set\b/i, /deck/i];

/** Identifiant TCGplayer du produit scellé le plus représentatif d'une extension (sans numéro de carte), ou null. */
export function sealedProduct(products) {
  let best = null;
  for (const p of products) {
    if ((p.extendedData ?? []).some((e) => e.name === 'Number')) continue; // une carte, pas un produit scellé
    const rank = SEALED.findIndex((re) => re.test(p.name ?? ''));
    if (rank < 0) continue;
    if (!best || rank < best.rank || (rank === best.rank && p.productId < best.id)) best = { rank, id: p.productId };
  }
  return best?.id ?? null;
}

/**
 * Ajoute aux extensions du catalogue leur nom anglais TCGplayer (`en`) et leur produit scellé (`box`, pour l'image) ;
 * ne retire jamais une valeur existante.
 */
export function addSetInfo(catalog, groups) {
  for (const [setId, group] of Object.entries(groups)) {
    const set = catalog.sets[setId];
    if (!set) continue;
    const en = englishSetName(group.name);
    if (en && en !== set.name) set.en = en;
    if (group.box) set.box = group.box;
  }
  return catalog;
}
