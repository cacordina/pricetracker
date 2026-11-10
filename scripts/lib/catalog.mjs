/**
 * Assemble le catalogue des cartes japonaises à partir de TCGdex.
 * Une carte n'entre au catalogue que si TCGdex donne son idProduct Cardmarket.
 *
 * Carte : { id, t, s, n, ja, en, q, r } — id = idProduct Cardmarket, t = id TCGdex,
 * s = extension, n = numéro, q = rareté source (ou null), r = rareté classée.
 */
export async function buildCatalog({ client, products, previous, only = null, log = () => {} }) {
  const enById = new Map(products.map((p) => [p.idProduct, p.name]));
  const prevByT = new Map((previous?.cards ?? []).map((c) => [c.t, c]));
  const prevBySet = Map.groupBy(previous?.cards ?? [], (c) => c.s);

  const sets = {};
  const cards = [];
  const coverage = {};
  const errors = [];

  const briefs = (await client.listSets()).filter((s) => !only || only.includes(s.id));
  // Extensions hors périmètre de cette exécution : reprises telles quelles.
  if (only && previous) {
    for (const [id, info] of Object.entries(previous.sets)) {
      if (only.includes(id)) continue;
      sets[id] = info;
      cards.push(...(prevBySet.get(id) ?? []));
    }
  }

  for (const brief of briefs) {
    try {
      const set = await client.getSet(brief.id);
      const list = set?.cards ?? [];
      const setCards = [];
      let img = null;
      for (const item of list) {
        if (!img && item.image) img = item.image.slice(0, item.image.lastIndexOf('/'));
        const known = prevByT.get(item.id);
        if (known && known.q) {
          setCards.push({ ...known, en: enById.get(known.id) ?? known.en ?? null });
          continue;
        }
        const card = await client.getCard(item.id);
        const idProduct = card?.pricing?.cardmarket?.idProduct;
        if (!Number.isInteger(idProduct)) continue;
        const q = card.rarity && card.rarity !== 'None' ? card.rarity : null;
        setCards.push({
          id: idProduct, t: item.id, s: brief.id, n: String(item.localId), ja: item.name,
          en: enById.get(idProduct) ?? null, q, r: 'unknown',
        });
      }
      sets[brief.id] = {
        name: set?.name ?? brief.name,
        official: set?.cardCount?.official ?? brief.cardCount?.official ?? null,
        total: list.length,
        img,
        date: set?.releaseDate ?? null,
      };
      coverage[brief.id] = { total: list.length, linked: setCards.length };
      cards.push(...setCards);
      log(`${brief.id}: ${setCards.length}/${list.length}`);
    } catch (err) {
      // Une extension en panne ne doit pas faire perdre ce qu'on savait déjà.
      errors.push(brief.id);
      if (previous?.sets?.[brief.id]) {
        sets[brief.id] = previous.sets[brief.id];
        cards.push(...(prevBySet.get(brief.id) ?? []));
      }
      log(`${brief.id}: ERREUR ${err.message}`);
    }
  }

  // Un même produit Cardmarket ne doit apparaître qu'une fois.
  const seen = new Set();
  const unique = cards.filter((c) => !seen.has(c.id) && seen.add(c.id));
  return { catalog: { builtAt: new Date().toISOString(), sets, cards: unique }, coverage, errors };
}
