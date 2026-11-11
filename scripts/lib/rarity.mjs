/**
 * Classement de rareté.
 *
 * Source (vérifiée le 2026-11-10) : le champ `rarity` des fiches TCGdex japonaises.
 * Il vaut "Illustration rare" (AR) ou "Special illustration rare" (SAR) pour la plupart
 * des extensions récentes, mais "None" pour ~2 260 cartes (dont toute SV8a).
 * En secours, la rareté du catalogue TCGplayer Japon (« Art Rare », « Special Art Rare »), champ `q2`.
 * Sans source, on ne devine jamais AR/SAR : la carte est « secret » si son numéro
 * dépasse le compte officiel de l'extension. Les promos (rareté source « Promo », ou extension de promos
 * comme « M-P » ou « SV-P ») sont à part : elles n'ont pas de numérotation officielle.
 * `overrides/rarity.json` a toujours priorité.
 */
export const RARITIES = ['AR', 'SAR', 'promo', 'secret', 'regular', 'unknown'];

const SOURCE = new Map([
  ['ar', 'AR'], ['art rare', 'AR'], ['illustration rare', 'AR'],
  ['sar', 'SAR'], ['special art rare', 'SAR'], ['special illustration rare', 'SAR'],
  ['promo', 'promo'],
]);

/** Extension de cartes promotionnelles : identifiant TCGdex en « -P » (M-P, SV-P, S-P…). */
const isPromoSet = (setId) => /-P$/i.test(String(setId ?? ''));

export function classifyRarity({ card, set, sourceRarity, overrides }) {
  const forced = overrides?.[card.id];
  if (RARITIES.includes(forced)) return forced;

  const mapped = sourceRarity ? SOURCE.get(String(sourceRarity).trim().toLowerCase()) : null;
  if (mapped) return mapped;
  if (isPromoSet(card.s)) return 'promo';

  const number = /^\d+$/.test(card.n) ? Number(card.n) : null;
  const official = Number.isInteger(set?.official) ? set.official : null;
  if (number !== null && official !== null) return number > official ? 'secret' : 'regular';
  return sourceRarity ? 'regular' : 'unknown';
}

/** Applique le classement à tout un catalogue (modifie et renvoie le catalogue). */
export function applyRarity(catalog, overrides = {}) {
  for (const card of catalog.cards) {
    const set = catalog.sets[card.s];
    let rarity = classifyRarity({ card, set, sourceRarity: card.q, overrides });
    // Rareté de secours (TCGplayer) : elle ne sert qu'à reconnaître une AR/SAR ou une promo que TCGdex n'a pas renseignée.
    if (rarity !== 'AR' && rarity !== 'SAR' && rarity !== 'promo' && card.q2 && !RARITIES.includes(overrides?.[card.id])) {
      const second = classifyRarity({ card, set, sourceRarity: card.q2, overrides });
      if (second === 'AR' || second === 'SAR' || second === 'promo') rarity = second;
    }
    card.r = rarity;
  }
  return catalog;
}
