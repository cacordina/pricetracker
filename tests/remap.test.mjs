import test from 'node:test';
import assert from 'node:assert/strict';
import { remapExpansions } from '../scripts/lib/remap.mjs';

const products = [
  { idProduct: 10, name: 'A [x]', idExpansion: 1 }, { idProduct: 11, name: 'B', idExpansion: 1 },
  { idProduct: 12, name: 'A [x]', idExpansion: 1 }, { idProduct: 13, name: 'Z', idExpansion: 1 },
  { idProduct: 25, name: 'A [x]', idExpansion: 2 }, { idProduct: 20, name: 'A [x]', idExpansion: 2 },
  { idProduct: 21, name: 'B', idExpansion: 2 }, { idProduct: 26, name: 'C', idExpansion: 2 },
  { idProduct: 50, name: 'A [x]', idExpansion: 3 },
];
const make = () => ({ sets: { M: {}, N: {} }, cards: [
  { id: 10, s: 'M', n: '1', en: 'A [x]' }, { id: 11, s: 'M', n: '2', en: 'B' },
  { id: 12, s: 'M', n: '3', en: 'A [x]' }, { id: 13, s: 'M', n: '4', en: 'Z' },
  { id: 50, s: 'N', n: '1', en: 'A [x]' },
] });

test('déplace les cartes vers l’extension Cardmarket voulue, par nom et rang', () => {
  const catalog = make();
  const report = remapExpansions(catalog, products, { M: 2 });
  assert.deepEqual(catalog.cards.filter((c) => c.s === 'M').map((c) => [c.n, c.id]), [['1', 20], ['2', 21], ['3', 25]]);
  assert.deepEqual(report, { M: { moved: 3, dropped: 1, kept: 0 } });
});
test('une carte sans équivalent dans l’extension voulue est retirée, les autres extensions ne bougent pas', () => {
  const catalog = make();
  remapExpansions(catalog, products, { M: 2 });
  assert.equal(catalog.cards.some((c) => c.s === 'M' && c.n === '4'), false);
  assert.deepEqual(catalog.cards.find((c) => c.s === 'N'), { id: 50, s: 'N', n: '1', en: 'A [x]' });
});
test('rejouable : un second passage ne change rien', () => {
  const catalog = make();
  remapExpansions(catalog, products, { M: 2 });
  const once = structuredClone(catalog);
  assert.deepEqual(remapExpansions(catalog, products, { M: 2 }), { M: { moved: 0, dropped: 0, kept: 3 } });
  assert.deepEqual(catalog, once);
});
test('extension cible inconnue de Cardmarket : rien n’est touché', () => {
  const catalog = make();
  assert.deepEqual(remapExpansions(catalog, products, { M: 999 }), { M: { moved: 0, dropped: 0, kept: 0, error: 'extension Cardmarket 999 introuvable' } });
  assert.deepEqual(catalog, make());
});

test('garde la trace ancien → nouvel identifiant, cumulée d’une exécution à l’autre', () => {
  const catalog = make();
  catalog.aliases = { 1: 2 };
  remapExpansions(catalog, products, { M: 2 });
  assert.deepEqual(catalog.aliases, { 1: 2, 10: 20, 11: 21, 12: 25 });
  remapExpansions(catalog, products, { M: 2 });
  assert.deepEqual(catalog.aliases, { 1: 2, 10: 20, 11: 21, 12: 25 });
});
