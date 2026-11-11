import test from 'node:test';
import assert from 'node:assert/strict';
import { appendDay } from '../scripts/lib/history.mjs';

const rows1 = new Map([[1, { p: 95, t: 100, l: 50, a: 90 }]]);
const day1 = () => appendDay(null, '2026-11-09', rows1, [1]);

test('premier jour', () => {
  assert.deepEqual(day1(), { dates: ['2026-11-09'], cards: { 1: { p: [95], t: [100], l: [50], a: [90] } } });
});
test('même date rejouée : inchangé', () => {
  const h = day1();
  assert.deepEqual(appendDay(h, '2026-11-09', new Map([[1, { t: 999, l: 1, a: 1 }]]), [1]), day1());
});
test('date antérieure à la dernière : erreur', () => {
  assert.throws(() => appendDay(day1(), '2026-11-08', rows1, [1]), /antérieure/);
});
test('date mal formée : erreur', () => {
  assert.throws(() => appendDay(null, '09/11/2026', rows1, [1]), /date/i);
});
test('carte nouvelle : dates passées complétées par null', () => {
  const h2 = appendDay(day1(), '2026-11-10', new Map([[1, { p: 100, t: 110, l: 55, a: 95 }], [2, { p: 4, t: 5, l: 1, a: null }]]), [1, 2]);
  assert.deepEqual(h2.cards[2], { p: [null, 4], t: [null, 5], l: [null, 1], a: [null, null] });
  assert.deepEqual(h2.cards[1].t, [100, 110]);
});
test('carte du catalogue sans prix ce jour : null ajouté', () => {
  const h2 = appendDay(day1(), '2026-11-10', new Map(), [1]);
  assert.deepEqual(h2.cards[1], { p: [95, null], t: [100, null], l: [50, null], a: [90, null] });
});
test('carte sortie du catalogue : sa série continue en null', () => {
  const h2 = appendDay(day1(), '2026-11-10', new Map([[2, { t: 5, l: 1, a: 2 }]]), [2]);
  assert.deepEqual(h2.cards[1].t, [100, null]);
});
test('carte jamais cotée : pas de série créée', () => {
  const h = appendDay(null, '2026-11-09', new Map(), [7]);
  assert.deepEqual(h, { dates: ['2026-11-09'], cards: {} });
});
test('toutes les séries ont la longueur de dates, et l’entrée n’est pas modifiée', () => {
  const h = day1();
  const h2 = appendDay(h, '2026-11-10', new Map([[3, { t: 1, l: 1, a: 1 }]]), [1, 3]);
  for (const s of Object.values(h2.cards)) for (const k of ['p', 't', 'l', 'a']) assert.equal(s[k].length, h2.dates.length);
  assert.deepEqual(h, day1());
});
test('ancien historique sans série p : complétée par des vides, puis allongée', () => {
  const old = { dates: ['2026-11-09', '2026-11-10'], cards: { 1: { t: [100, 101], l: [50, 50], a: [90, 91] } } };
  const h2 = appendDay(old, '2026-11-11', new Map([[1, { p: 96, t: 102, l: 51, a: 92 }]]), [1]);
  assert.deepEqual(h2.cards[1], { p: [null, null, 96], t: [100, 101, 102], l: [50, 50, 51], a: [90, 91, 92] });
});
