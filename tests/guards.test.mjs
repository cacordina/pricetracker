import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDay } from '../scripts/lib/guards.mjs';

test('jour normal accepté', () => {
  assert.deepEqual(checkDay({ date: '2026-11-10', lastDate: '2026-11-09', pricedCount: 900, lastPricedCount: 1000 }), { ok: true });
});
test('même date : à sauter, pas une erreur', () => {
  const r = checkDay({ date: '2026-11-09', lastDate: '2026-11-09', pricedCount: 1000, lastPricedCount: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.skip, true);
});
test('date en arrière : refus', () => {
  const r = checkDay({ date: '2026-11-08', lastDate: '2026-11-09', pricedCount: 1000, lastPricedCount: 1000 });
  assert.deepEqual([r.ok, r.skip], [false, false]);
});
test('moins de 80 % de cartes cotées par rapport à la veille : refus', () => {
  const r = checkDay({ date: '2026-11-10', lastDate: '2026-11-09', pricedCount: 799, lastPricedCount: 1000 });
  assert.deepEqual([r.ok, r.skip], [false, false]);
  assert.equal(checkDay({ date: '2026-11-10', lastDate: '2026-11-09', pricedCount: 800, lastPricedCount: 1000 }).ok, true);
});
test('tout premier jour accepté', () => {
  assert.equal(checkDay({ date: '2026-11-10', lastDate: null, pricedCount: 5, lastPricedCount: null }).ok, true);
});
test('aucune carte cotée : refus même le premier jour', () => {
  assert.equal(checkDay({ date: '2026-11-10', lastDate: null, pricedCount: 0, lastPricedCount: null }).ok, false);
});
test('date illisible : refus', () => {
  assert.equal(checkDay({ date: undefined, lastDate: null, pricedCount: 5, lastPricedCount: null }).ok, false);
});
