#!/usr/bin/env node
// Reconstruit la table des cartes japonaises : node scripts/build-catalog.mjs --out data [--only SV8a,M2]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from './lib/tcgdex.mjs';
import { buildCatalog } from './lib/catalog.mjs';
import { applyRarity } from './lib/rarity.mjs';

export const PRODUCTS_URL = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json';

const { values } = parseArgs({ options: { out: { type: 'string', default: 'data' }, only: { type: 'string' }, products: { type: 'string' } } });
const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } };

const productsDoc = values.products
  ? JSON.parse(await readFile(values.products, 'utf8'))
  : await (await fetch(PRODUCTS_URL)).json();
if (!Array.isArray(productsDoc.products)) throw new Error('Export catalogue Cardmarket illisible');

const previous = await readJson(join(values.out, 'catalog.json'), null);
const overrides = await readJson(new URL('../overrides/rarity.json', import.meta.url), {});
const client = createClient({ cacheDir: '.cache/tcgdex' });

const { catalog, coverage, errors } = await buildCatalog({
  client, products: productsDoc.products, previous,
  only: values.only ? values.only.split(',') : null,
  log: (line) => console.log(line),
});
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
console.log(`Catalogue : ${catalog.cards.length} cartes, ${Object.keys(catalog.sets).length} extensions`);
console.log('Raretés : ' + Object.entries(byRarity).map(([r, l]) => `${r} ${l.length}`).join(', '));
if (errors.length) console.log(`Extensions en erreur (données précédentes conservées) : ${errors.join(', ')}`);
