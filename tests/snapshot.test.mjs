import test from 'node:test';
import assert from 'node:assert/strict';
import { pctChange, buildSnapshot } from '../scripts/lib/snapshot.mjs';

const d = (n) => `2026-11-${String(n).padStart(2, '0')}`;
// 11-01 … 11-10 sauf 11-03 ; carte 1 : 100 le 11-02, 120 le 11-10
const dates = [1, 2, 4, 5, 6, 7, 8, 9, 10].map(d);
const series = (vals) => ({ t: vals, l: vals.map(() => null), a: vals.map(() => null) });
const h = { dates, cards: { 1: series([90, 100, 101, 102, 103, 104, 105, 110, 120]) } };

test('variation 7 j : J-7 absent, prend la dernière date connue avant', () => {
  assert.equal(pctChange(h, 1, d(10), 7), 20.0);
});
test('pas assez d’historique : null', () => assert.equal(pctChange(h, 1, d(10), 30), null));
test('référence trop ancienne (plus de 3 jours avant J-N) : null', () => {
  const hTrou = { dates: ['2026-10-25', d(10)], cards: { 1: series([100, 120]) } };
  assert.equal(pctChange(hTrou, 1, d(10), 7), null);
});
test('référence null ou 0, ou carte inconnue : null', () => {
  assert.equal(pctChange({ dates, cards: { 1: series([90, null, 101, 102, 103, 104, 105, 110, 120]) } }, 1, d(10), 7), null);
  assert.equal(pctChange({ dates, cards: { 1: series([90, 0, 101, 102, 103, 104, 105, 110, 120]) } }, 1, d(10), 7), null);
  assert.equal(pctChange(h, 42, d(10), 7), null);
});
test('arrondi à une décimale', () => {
  const h3 = { dates: [d(3), d(10)], cards: { 1: series([300, 310]) } };
  assert.equal(pctChange(h3, 1, d(10), 7), 3.3);
});

const catalog = { sets: { A: {} }, cards: [{ id: 1, s: 'A' }, { id: 2, s: 'A' }, { id: 3, s: 'A' }] };
const prices = new Map([
  [1, { t: 120, l: 60, a: 115, a7: 100, a30: 150 }],
  [2, { t: null, l: null, a: null, a7: null, a30: null }],
  [3, { t: 50, l: null, a: null, a7: null, a30: 0 }],
]);

test('historique court : variations estimées depuis les moyennes Cardmarket', () => {
  const s = buildSnapshot({ date: d(10), prices, histories: { A: { dates: [d(9), d(10)], cards: { 1: series([110, 120]) } } }, catalog });
  assert.deepEqual(s.approx, { d7: true, d30: true });
  assert.deepEqual(s.cards[1], [120, 60, 115, 100, 150, 20.0, -20.0]);
  assert.equal(s.date, d(10));
});
test('carte sans aucun prix : absente ; moyenne nulle : variation null', () => {
  const s = buildSnapshot({ date: d(10), prices, histories: { A: { dates: [d(10)], cards: {} } }, catalog });
  assert.equal(2 in s.cards, false);
  assert.deepEqual(s.cards[3], [50, null, null, null, 0, null, null]);
});
test('historique d’au moins 7 jours : d7 vient de l’historique, d30 reste estimé', () => {
  const s = buildSnapshot({ date: d(10), prices, histories: { A: h }, catalog });
  assert.deepEqual(s.approx, { d7: false, d30: true });
  assert.equal(s.cards[1][5], 20.0);
  assert.equal(s.cards[1][6], -20.0);
});
