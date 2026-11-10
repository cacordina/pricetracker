import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRarity } from '../scripts/lib/rarity.mjs';

const set = { official: 187 };
const cls = (card, sourceRarity = null, overrides = {}, s = set) => classifyRarity({ card, set: s, sourceRarity, overrides });

test('correction manuelle prioritaire', () => assert.equal(cls({ id: 1, n: '005' }, 'Common', { 1: 'SAR' }), 'SAR'));
test('correction manuelle invalide ignorée', () => assert.equal(cls({ id: 1, n: '005' }, null, { 1: 'XXL' }), 'regular'));
test('rareté source reconnue', () => {
  assert.equal(cls({ id: 2, n: '190' }, 'Art Rare'), 'AR');
  assert.equal(cls({ id: 2, n: '190' }, 'Illustration rare'), 'AR');
  assert.equal(cls({ id: 3, n: '212' }, 'Special Art Rare'), 'SAR');
  assert.equal(cls({ id: 3, n: '212' }, 'Special illustration rare'), 'SAR');
  assert.equal(cls({ id: 3, n: '212' }, 'SAR'), 'SAR');
});
test('sans source : au-delà du compte officiel = secret, jamais AR/SAR', () => assert.equal(cls({ id: 4, n: '212' }), 'secret'));
test('source autre qu’AR/SAR au-delà du compte officiel = secret', () => assert.equal(cls({ id: 4, n: '230' }, 'Ultra Rare'), 'secret'));
test('sans source : dans le compte officiel = regular', () => assert.equal(cls({ id: 5, n: '010' }), 'regular'));
test('numéro non numérique ou compte officiel absent = unknown', () => {
  assert.equal(cls({ id: 6, n: 'SV-P' }), 'unknown');
  assert.equal(cls({ id: 6, n: '010' }, null, {}, {}), 'unknown');
});
test('source connue mais numéro illisible = regular', () => assert.equal(cls({ id: 7, n: 'A1' }, 'Promo'), 'regular'));
