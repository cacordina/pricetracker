// Adresses : images des cartes et des extensions, fiches Cardmarket, recherches eBay et Vinted.
import { englishName } from './model.js';

/** Adresses d'image possibles, par ordre de préférence : TCGdex, puis l'image de secours TCGplayer. */
export function imageUrls(card, sets, quality = 'low') {
  const urls = [];
  const base = sets?.[card.s]?.img;
  if (base) urls.push(`${base}/${card.n}/${quality}.webp`);
  if (card.g) urls.push(`https://tcgplayer-cdn.tcgplayer.com/product/${card.g}_${quality === 'high' ? 'in_1000x1000' : '200w'}.jpg`);
  return urls;
}

export const imageUrl = (card, sets, quality = 'low') => imageUrls(card, sets, quality)[0] ?? null;

/** Image d'une extension : photo TCGplayer de son produit scellé (display, booster…), ou null. */
export function setImageUrl(set, quality = 'low') {
  return set?.box ? `https://tcgplayer-cdn.tcgplayer.com/product/${set.box}_${quality === 'high' ? 'in_1000x1000' : '200w'}.jpg` : null;
}

/** Fiche Cardmarket d'une carte ; `filters` ajoute des filtres d'offres (ex. { language: 7, sellerCountry: 12 }). */
export function cardmarketUrl(idProduct, filters = {}) {
  const params = new URLSearchParams({ idProduct, ...filters });
  return `https://www.cardmarket.com/fr/Pokemon/Products?${params}`;
}

/**
 * Recherche eBay limitée aux ventes conclues (annonces terminées et vendues), triée des plus récentes.
 * eBay n'offre pas d'API publique pour ces ventes : on ouvre sa page de résultats.
 */
export function ebaySoldUrl(card, sets = {}) {
  const name = englishName(card);
  const official = sets[card.s]?.official;
  const number = official && /^\d+$/.test(card.n) ? `${card.n}/${official}` : card.n;
  const query = ['pokemon', name, number, 'japanese'].filter(Boolean).join(' ');
  const params = new URLSearchParams({ _nkw: query, LH_Sold: 1, LH_Complete: 1, _sop: 13 });
  return `https://www.ebay.fr/sch/i.html?${params}`;
}

/**
 * Recherche Vinted (annonces en cours, les plus récentes d'abord) : nom français s'il existe, sinon anglais, et numéro.
 * Vinted n'expose ni API publique ni historique des ventes : on ouvre sa page de résultats.
 */
export function vintedUrl(card, sets = {}) {
  const name = card.fr ?? englishName(card);
  const official = sets[card.s]?.official;
  const number = official && /^\d+$/.test(card.n) ? `${card.n}/${official}` : card.n;
  const params = new URLSearchParams({ search_text: ['pokemon', name, number].filter(Boolean).join(' '), order: 'newest_first' });
  return `https://www.vinted.fr/catalog?${params}`;
}
