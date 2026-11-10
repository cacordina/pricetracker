/**
 * Assemble le catalogue des cartes japonaises à partir de TCGdex.
 * Une carte n'entre au catalogue que si TCGdex donne son idProduct Cardmarket.
 *
 * Carte : { id, t, s, n, ja, en, q, r } — id = idProduct Cardmarket, t = id TCGdex,
 * s = extension, n = numéro, q = rareté source (ou null), r = rareté classée.
 */
async function mapPool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export async function buildCatalog({ client, products, previous, only = null, concurrency = 3, log = () => {} }) {
  const enById = new Map(products.map((p) => [p.idProduct, p.name]));
  const prevByT = new Map((previous?.cards ?? []).map((c) => [c.t, c]));
  const prevBySet = Map.groupBy(previous?.cards ?? [], (c) => c.s);

  const sets = {};
  const cards = [];
  const coverage = {};
  const errors = [];
  const jaNames = {}; // noms japonais de toutes les cartes, même non reliées à Cardmarket (pour fill.mjs)

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
      jaNames[brief.id] = Object.fromEntries(list.map((item) => [String(item.localId), item.name]));
      let img = null;
      for (const item of list) {
        if (item.image) { img = item.image.slice(0, item.image.lastIndexOf('/')); break; }
      }
      const resolved = await mapPool(list, concurrency, async (item) => {
        const known = prevByT.get(item.id);
        if (known && known.q) return { ...known, en: enById.get(known.id) ?? known.en ?? null };
        const card = await client.getCard(item.id);
        const idProduct = card?.pricing?.cardmarket?.idProduct;
        if (!Number.isInteger(idProduct)) return null;
        const q = card.rarity && card.rarity !== 'None' ? card.rarity : null;
        return {
          id: idProduct, t: item.id, s: brief.id, n: String(item.localId), ja: item.name,
          en: enById.get(idProduct) ?? null, q, r: 'unknown',
        };
      });
      setCards.push(...resolved.filter(Boolean));
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
  return { catalog: { builtAt: new Date().toISOString(), sets, cards: unique }, coverage, errors, jaNames };
}
