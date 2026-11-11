import test from 'node:test';
import assert from 'node:assert/strict';
import { indexProducts, matchGroups, enrichCatalog } from '../scripts/lib/tcgcsv.mjs';
import { readJson } from './helpers.mjs';

const products = (await readJson('tcgcsv-products-SV8a.json')).results;

test('index par numéro : préfère le produit sans variante entre parenthèses', () => {
  const index = indexProducts(products);
  assert.equal(index.get('1').name, 'Budew');
  assert.equal(index.get('212').rarity, 'Special Art Rare');
  assert.equal(typeof index.get('212').productId, 'number');
});
test('associe les groupes aux extensions par abréviation, sans tenir compte de la casse', () => {
  const groups = [{ groupId: 1, abbreviation: 'm1L' }, { groupId: 2, abbreviation: 'SV8a' }, { groupId: 3, abbreviation: null }];
  assert.deepEqual(matchGroups(groups, ['M1L', 'SV8a', 'MC']), new Map([['M1L', 1], ['SV8a', 2]]));
});
test('enrichit le catalogue : image de secours et rareté de secours', () => {
  const catalog = { sets: { SV8a: {} }, cards: [
    { id: 803325, s: 'SV8a', n: '212', q: null },
    { id: 803303, s: 'SV8a', n: '190', q: 'Rare' },
    { id: 9, s: 'SV8a', n: '999', q: null, g: 123, q2: 'Vieux' },
    { id: 10, s: 'ZZ', n: '001', q: null },
  ] };
  enrichCatalog(catalog, { SV8a: indexProducts(products) });
  assert.equal(typeof catalog.cards[0].g, 'number');
  assert.equal(catalog.cards[0].q2, 'Special Art Rare');
  assert.equal(catalog.cards[1].q2, 'Super Rare');
  assert.deepEqual([catalog.cards[2].g, catalog.cards[2].q2], [123, 'Vieux']); // extension chargée mais carte absente : on garde l'existant
  assert.equal(catalog.cards[3].g, undefined);
});

test('noms anglais des extensions (TCGplayer), sans le code en tête', async () => {
  const { englishSetName } = await import('../scripts/lib/tcgcsv.mjs');
  assert.equal(englishSetName('SV11B: Black Bolt'), 'Black Bolt');
  assert.equal(englishSetName('SM: The Best of XY'), 'The Best of XY');
  assert.equal(englishSetName('Terastal Festival ex'), 'Terastal Festival ex');
  assert.equal(englishSetName(''), null);
});

test('image d’extension : display d’abord, puis booster, puis coffret ; jamais une carte', async () => {
  const { sealedProduct } = await import('../scripts/lib/tcgcsv.mjs');
  const card = (id, name) => ({ productId: id, name, extendedData: [{ name: 'Number', value: '001/100' }] });
  assert.equal(sealedProduct([
    card(1, 'Booster Box Pikachu'), { productId: 9, name: 'Black Bolt Special Box' },
    { productId: 7, name: 'Black Bolt Booster Pack' }, { productId: 8, name: 'Black Bolt Booster Box' },
  ]), 8);
  assert.equal(sealedProduct([{ productId: 7, name: 'Booster Pack' }, { productId: 9, name: 'Premium Collection' }]), 7);
  assert.equal(sealedProduct([card(1, 'Pikachu'), { productId: 3, name: 'Code Card' }]), null);
});

test('infos d’extension : nom anglais et produit scellé, sans rien retirer', async () => {
  const { addSetInfo } = await import('../scripts/lib/tcgcsv.mjs');
  const catalog = { sets: { SV11B: { name: 'ブラックボルト' }, X: { name: 'Same', box: 5 } } };
  addSetInfo(catalog, { SV11B: { name: 'SV11B: Black Bolt', box: 42 }, X: { name: 'Same', box: null }, Y: { name: 'Y: Nope', box: 1 } });
  assert.deepEqual(catalog.sets, { SV11B: { name: 'ブラックボルト', en: 'Black Bolt', box: 42 }, X: { name: 'Same', box: 5 } });
});
