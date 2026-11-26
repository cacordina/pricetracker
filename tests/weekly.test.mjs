import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekStart, isNewWeek, weeklySummaries } from '../scripts/lib/weekly.mjs';
import { collectionMovers } from '../site/lib/collection.js';

const plain = (text) => text.replace(/[  ]/g, ' '); // formatEuro met des espaces insécables

const cards = [
  { id: 1, s: 'A', n: '1', ja: 'x', fr: 'Nymphali ex' },
  { id: 2, s: 'A', n: '2', ja: 'y', en: 'Brassius' },
  { id: 3, s: 'A', n: '3', ja: 'z', fr: 'Pikachu' },
];
const catalog = { cards, byId: new Map(cards.map((c) => [c.id, c])) };
//                       trend low avg1 avg7  avg30 d7    d30
const snapshot = { cards: {
  1: [0, 0, 0, 11000, 0, 10, null],   // 100 € → 110 €
  2: [0, 0, 0, 800, 0, -20, null],    // 10 € → 8 €
  3: [0, 0, 0, 500, 0, null, null],   // pas encore de variation
} };

test('semaines : premier relevé d’une nouvelle semaine', () => {
  assert.equal(weekStart('2026-11-30'), '2026-11-30'); // lundi
  assert.equal(weekStart('2026-11-29'), '2026-11-23'); // dimanche → lundi précédent
  assert.equal(isNewWeek('2026-11-30', '2026-11-29'), true);
  assert.equal(isNewWeek('2026-12-01', '2026-11-29'), true);  // pas de relevé le lundi : mardi
  assert.equal(isNewWeek('2026-12-01', '2026-11-30'), false);
  assert.equal(isNewWeek('2026-12-01', null), true);
});

test('mouvements de la collection sur 7 jours', () => {
  const holdings = [{ id_product: 1, qty: 2 }, { id_product: 2, qty: 1 }, { id_product: 3, qty: 1 }, { id_product: 99, qty: 1 }];
  const m = collectionMovers(holdings, catalog, snapshot);
  assert.deepEqual(m.ups.map((i) => [i.card.id, i.change, i.deltaCents]), [[1, 10, 2000]]);
  assert.deepEqual(m.downs.map((i) => [i.card.id, i.change, i.deltaCents]), [[2, -20, -200]]);
  assert.equal(m.deltaCents, 1800);           // +20 € − 2 €
  assert.equal(m.pct, 8.6);                   // 1800 / (20000 + 1000)
  assert.equal(collectionMovers([{ id_product: 3, qty: 1 }], catalog, snapshot).known, false);
});

test('résumé hebdomadaire : un message par compte qui possède des cartes cotées', () => {
  const out = weeklySummaries({ catalog, snapshot, holdings: [
    { user_id: 'a', id_product: 1, qty: 2 }, { user_id: 'a', id_product: 2, qty: 1 },
    { user_id: 'b', id_product: 3, qty: 1 },
    { user_id: 'c', id_product: 99, qty: 4 }, // carte inconnue : pas de message
  ] });
  assert.deepEqual([...out.keys()], ['a', 'b']);
  assert.equal(out.get('a').title, 'Votre collection cette semaine');
  assert.equal(plain(out.get('a').body), '228,00 € pour 3 cartes · +18,00 € (+8,6 %) en 7 jours · plus forte hausse : Nymphali ex +10,0 %');
  assert.equal(plain(out.get('b').body), '5,00 € pour 1 carte'); // pas encore de variation : juste la valeur
  assert.equal(out.get('a').url, '#/collection');
});
