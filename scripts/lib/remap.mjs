/**
 * Certaines extensions existent chez Cardmarket en plusieurs versions (une par langue), et TCGdex
 * pointe parfois sur la mauvaise. `overrides/expansions.json` ({ "M6a": 6602 }) force l'extension
 * Cardmarket d'une extension japonaise : chaque carte est déplacée vers le produit de même nom et
 * de même rang (parmi les homonymes, par idProduct croissant) dans l'extension voulue.
 * Une carte sans équivalent est retirée du catalogue plutôt que d'afficher le prix d'une autre langue.
 */
export function remapExpansions(catalog, products, overrides = {}) {
  const byId = new Map(products.map((p) => [p.idProduct, p]));
  const report = {};
  for (const [setId, target] of Object.entries(overrides)) {
    const stats = { moved: 0, dropped: 0, kept: 0 };
    report[setId] = stats;
    const targetProducts = products.filter((p) => p.idExpansion === target).sort((a, b) => a.idProduct - b.idProduct);
    if (!targetProducts.length) { stats.error = `extension Cardmarket ${target} introuvable`; continue; }
    const targetByName = Map.groupBy(targetProducts, (p) => p.name);

    const drop = new Set();
    for (const card of catalog.cards) {
      if (card.s !== setId) continue;
      const product = byId.get(card.id);
      if (product?.idExpansion === target) { stats.kept += 1; continue; }
      let match = null;
      if (product) {
        const twins = products.filter((p) => p.idExpansion === product.idExpansion && p.name === product.name).sort((a, b) => a.idProduct - b.idProduct);
        match = targetByName.get(product.name)?.[twins.findIndex((p) => p.idProduct === product.idProduct)] ?? null;
      }
      if (!match) { drop.add(card); stats.dropped += 1; continue; }
      (catalog.aliases ??= {})[card.id] = match.idProduct; // pour basculer collections et envies déjà enregistrées
      card.id = match.idProduct;
      card.en = match.name;
      stats.moved += 1;
    }
    if (drop.size) catalog.cards = catalog.cards.filter((c) => !drop.has(c));
  }
  return report;
}
