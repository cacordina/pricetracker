import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../scripts/lib/catalog.mjs';
import { fakeClient, readJson } from './helpers.mjs';

const products = (await readJson('products.sample.json')).products;

test('une carte liée entre dans le catalogue', async () => {
  const { catalog } = await buildCatalog({ client: await fakeClient(), products, previous: null });
  const c = catalog.cards.find((c) => c.id === 803325);
  assert.deepEqual({ t: c.t, s: c.s, n: c.n, ja: c.ja }, { t: 'SV8a-212', s: 'SV8a', n: '212', ja: 'ニンフィアex' });
  assert.equal(typeof c.en, 'string');
  assert.equal(catalog.sets.SV8a.official, 187);
  assert.equal(catalog.sets.SV8a.img, 'https://assets.tcgdex.net/ja/SV/SV8a');
});

test('une carte sans idProduct est ignorée et comptée', async () => {
  const { catalog, coverage } = await buildCatalog({ client: await fakeClient(), products, previous: null });
  assert.equal(coverage.SV8a.total, 3);
  assert.equal(coverage.SV8a.linked, 2);
  assert.equal(catalog.cards.length, 2);
});

test('une carte déjà connue avec rareté source n’est pas redemandée', async () => {
  const client = await fakeClient();
  const first = await buildCatalog({ client, products, previous: null });
  for (const c of first.catalog.cards) c.q = 'Rare'; // rareté source connue
  client.calls.length = 0;
  const second = await buildCatalog({ client, products, previous: first.catalog });
  assert.deepEqual(client.calls.filter((c) => c.startsWith('card:')), ['card:SV8a-001']);
  assert.equal(second.catalog.cards.length, 2);
});

test('une carte connue sans rareté source est redemandée', async () => {
  const client = await fakeClient();
  const first = await buildCatalog({ client, products, previous: null });
  client.calls.length = 0;
  await buildCatalog({ client, products, previous: first.catalog });
  assert.equal(client.calls.filter((c) => c.startsWith('card:')).length, 3);
});

test('idProduct absent de l’export Cardmarket : en vaut null, carte gardée', async () => {
  const { catalog } = await buildCatalog({ client: await fakeClient(), products: [], previous: null });
  assert.equal(catalog.cards.length, 2);
  assert.equal(catalog.cards[0].en, null);
});

test('une extension en erreur garde ses cartes précédentes', async () => {
  const client = await fakeClient();
  const first = await buildCatalog({ client, products, previous: null });
  client.getSet = async () => { throw new Error('503'); };
  const second = await buildCatalog({ client, products, previous: first.catalog });
  assert.equal(second.catalog.cards.length, 2);
  assert.deepEqual(second.errors, ['SV8a']);
});
