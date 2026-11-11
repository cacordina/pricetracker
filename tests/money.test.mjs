import test from 'node:test';
import assert from 'node:assert/strict';
import { toCents } from '../scripts/lib/money.mjs';

test('toCents', () => {
  assert.equal(toCents(103.24), 10324);
  assert.equal(toCents(0.1), 10);
  assert.equal(toCents(1.005), 101); // arrondi au centime, pas de dérive flottante
  assert.equal(toCents(0), 0);
  assert.equal(toCents(null), null);
  assert.equal(toCents(undefined), null);
});

test('prix retenu : moyenne 7 j, sinon 30 j, sinon tendance', async () => {
  const { mainPrice } = await import('../scripts/lib/money.mjs');
  assert.equal(mainPrice({ a7: 225, a30: 293, t: 75 }), 225);
  assert.equal(mainPrice({ a7: null, a30: 293, t: 75 }), 293);
  assert.equal(mainPrice({ a7: null, a30: null, t: 75 }), 75);
  assert.equal(mainPrice({}), null);
});
