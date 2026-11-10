/**
 * Classement de rareté.
 *
 * Source (vérifiée le 2026-11-10) : le champ `rarity` des fiches TCGdex japonaises.
 * Il vaut "Illustration rare" (AR) ou "Special illustration rare" (SAR) pour la plupart
 * des extensions récentes, mais "None" pour ~2 260 cartes (dont toute SV8a).
 * Sans source, on ne devine jamais AR/SAR : la carte est « secret » si son numéro
 * dépasse le compte officiel de l'extension. `overrides/rarity.json` a toujours priorité.
 */
export const RARITIES = ['AR', 'SAR', 'secret', 'regular', 'unknown'];

const SOURCE = new Map([
  ['ar', 'AR'], ['art rare', 'AR'], ['illustration rare', 'AR'],
  ['sar', 'SAR'], ['special art rare', 'SAR'], ['special illustration rare', 'SAR'],
]);

export function classifyRarity({ card, set, sourceRarity, overrides }) {
  const forced = overrides?.[card.id];
  if (RARITIES.includes(forced)) return forced;

  const mapped = sourceRarity ? SOURCE.get(String(sourceRarity).trim().toLowerCase()) : null;
  if (mapped) return mapped;

  const number = /^\d+$/.test(card.n) ? Number(card.n) : null;
  const official = Number.isInteger(set?.official) ? set.official : null;
  if (number !== null && official !== null) return number > official ? 'secret' : 'regular';
  return sourceRarity ? 'regular' : 'unknown';
}

/** Applique le classement à tout un catalogue (modifie et renvoie le catalogue). */
export function applyRarity(catalog, overrides = {}) {
  for (const card of catalog.cards) {
    card.r = classifyRarity({ card, set: catalog.sets[card.s], sourceRarity: card.q, overrides });
  }
  return catalog;
}
