#!/usr/bin/env node
// Reconstruit la table des cartes japonaises : node scripts/build-catalog.mjs --out data [--only SV8a,M2]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from './lib/tcgdex.mjs';
import { buildCatalog } from './lib/catalog.mjs';
import { applyRarity } from './lib/rarity.mjs';
import { fetchGroups, enrichCatalog, addEnglishSetNames } from './lib/tcgcsv.mjs';
import { fillCatalog } from './lib/fill.mjs';
import { applyFrenchNames } from './lib/names.mjs';
import { remapExpansions } from './lib/remap.mjs';

export const PRODUCTS_URL = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json';

const { values } = parseArgs({ options: { out: { type: 'string', default: 'data' }, only: { type: 'string' }, products: { type: 'string' }, 'enrich-only': { type: 'boolean', default: false } } });
const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } };

const productsDoc = values.products
  ? JSON.parse(await readFile(values.products, 'utf8'))
  : await (await fetch(PRODUCTS_URL)).json();
if (!Array.isArray(productsDoc.products)) throw new Error('Export catalogue Cardmarket illisible');

const previous = await readJson(join(values.out, 'catalog.json'), null);
const overrides = await readJson(new URL('../overrides/rarity.json', import.meta.url), {});
const client = createClient({ cacheDir: '.cache/tcgdex' });

// --enrich-only : ne réinterroge pas TCGdex, complète seulement le catalogue existant (images, raretés, noms).
let catalog, coverage = {}, errors = [], jaNames = {};
if (values['enrich-only']) {
  if (!previous) throw new Error('--enrich-only demande un catalogue existant');
  catalog = structuredClone(previous);
  const enById = new Map(productsDoc.products.map((p) => [p.idProduct, p.name]));
  for (const card of catalog.cards) card.en = enById.get(card.id) ?? card.en ?? null;
} else {
  ({ catalog, coverage, errors, jaNames } = await buildCatalog({
    client, products: productsDoc.products, previous,
    only: values.only ? values.only.split(',') : null,
    log: (line) => console.log(line),
  }));
}
if (previous?.aliases) catalog.aliases = { ...previous.aliases, ...catalog.aliases };
const expansions = await readJson(new URL('../overrides/expansions.json', import.meta.url), {});
for (const [setId, r] of Object.entries(remapExpansions(catalog, productsDoc.products, expansions))) {
  console.log(`Extension ${setId} → Cardmarket ${expansions[setId]} : ${r.moved} déplacées, ${r.kept} déjà bonnes, ${r.dropped} retirées${r.error ? ` (${r.error})` : ''}`);
}
const species = await readJson(new URL('./data/species-fr.json', import.meta.url), {});
// Extensions connues seulement par la source de secours : on les reprend du catalogue précédent,
// pour ne pas les perdre si cette source est indisponible aujourd'hui.
if (previous && !values.only) {
  for (const [id, info] of Object.entries(previous.sets)) {
    if (catalog.sets[id]) continue;
    catalog.sets[id] = info;
    catalog.cards.push(...previous.cards.filter((c) => c.s === id));
  }
}
const groups = await fetchGroups(Object.keys(catalog.sets), { log: (line) => console.log(line) });
const filled = fillCatalog(catalog, { groups, products: productsDoc.products, overrides: expansions, jaNames });
const done = Object.entries(filled).filter(([, r]) => r.added || r.fixed);
console.log(`Catalogue complété par recoupement des noms : ${done.reduce((n, [, r]) => n + r.added, 0)} cartes ajoutées, ${done.reduce((n, [, r]) => n + r.fixed, 0)} corrigées, dans ${done.length} extensions`);
for (const [id, r] of done) console.log(`  ${id} → Cardmarket ${r.expansion} : +${r.added}${r.fixed ? `, ${r.fixed} corrigées` : ''}`);
const ambiguous = Object.entries(filled).filter(([, r]) => r.ambiguous);
if (ambiguous.length) console.log(`Extensions à plusieurs versions Cardmarket, non complétées (à trancher dans overrides/expansions.json) :\n${ambiguous.map(([id, r]) => `  ${id} : ${r.ambiguous.join(', ')}`).join('\n')}`);
console.log(`Extensions sans équivalent Cardmarket trouvé : ${Object.values(filled).filter((r) => r.none).length}`);
enrichCatalog(catalog, Object.fromEntries(Object.entries(groups).map(([id, g]) => [id, g.index])));
addEnglishSetNames(catalog, groups);
applyFrenchNames(catalog, species);
applyRarity(catalog, overrides);

if (previous && catalog.cards.length < previous.cards.length * 0.8) {
  throw new Error(`Catalogue suspect : ${catalog.cards.length} cartes contre ${previous.cards.length} avant. Rien n'est écrit.`);
}

await mkdir(values.out, { recursive: true });
await writeFile(join(values.out, 'catalog.json'), JSON.stringify(catalog));
const prevCoverage = await readJson(join(values.out, 'coverage.json'), {});
await writeFile(join(values.out, 'coverage.json'), JSON.stringify({ ...prevCoverage, ...coverage }, null, 1));

const total = Object.values(coverage).reduce((n, c) => n + c.total, 0);
const linked = Object.values(coverage).reduce((n, c) => n + c.linked, 0);
const byRarity = Object.groupBy(catalog.cards, (c) => c.r);
console.log(`\nCouverture de cette exécution : ${linked}/${total} cartes liées à Cardmarket (${total ? Math.round((linked / total) * 100) : 0} %)`);
console.log(`Catalogue : ${catalog.cards.length} cartes, ${Object.keys(catalog.sets).length} extensions (${Object.values(catalog.sets).filter((s) => s.en).length} avec un nom anglais)`);
console.log('Raretés : ' + Object.entries(byRarity).map(([r, l]) => `${r} ${l.length}`).join(', '));
const withImage = catalog.cards.filter((c) => catalog.sets[c.s]?.img || c.g).length;
console.log(`Images : ${withImage}/${catalog.cards.length} cartes (dont ${catalog.cards.filter((c) => !catalog.sets[c.s]?.img && c.g).length} par la source de secours) ; noms français : ${catalog.cards.filter((c) => c.fr).length}`);
if (errors.length) console.log(`Extensions en erreur (données précédentes conservées) : ${errors.join(', ')}`);
