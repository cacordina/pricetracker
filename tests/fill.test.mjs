import test from 'node:test';
import assert from 'node:assert/strict';
import { normName, chooseExpansion, alignCards, fillCatalog } from '../scripts/lib/fill.mjs';

test('normName : ignore attaques, numéro, variantes, casse et ponctuation', () => {
  assert.equal(normName('Sylveon ex [Magical Charm | Angelite]'), 'sylveonex');
  assert.equal(normName('Sylveon ex - 212/187'), 'sylveonex');
  assert.equal(normName('Budew (Master Ball Pattern)'), 'budew');
  assert.equal(normName("Lillie's Determination"), 'lilliesdetermination');
});

const exp = (id, names) => [id, names.map((n) => ({ idProduct: 0, name: n }))];
const names10 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

test('chooseExpansion : meilleure concordance de noms, de taille voisine', () => {
  const byExp = new Map([exp(1, names10), exp(2, [...names10, ...Array(30).fill('z')]), exp(3, ['a', 'b', 'x', 'y'])]);
  assert.deepEqual(chooseExpansion({ names: names10, byExp }), { expansion: 1 });
});
test('chooseExpansion : versions jumelles → ambigu, sauf indice ou choix forcé', () => {
  const byExp = new Map([exp(1, names10), exp(2, names10)]);
  assert.deepEqual(chooseExpansion({ names: names10, byExp }), { ambiguous: [1, 2] });
  assert.deepEqual(chooseExpansion({ names: names10, byExp, hint: 2 }), { expansion: 2 });
  assert.deepEqual(chooseExpansion({ names: names10, byExp, override: 1, hint: 2 }), { expansion: 1 });
});
test('chooseExpansion : un indice hors des candidates est ignoré ; rien de proche → none', () => {
  const byExp = new Map([exp(1, names10), exp(9, ['q', 'r'])]);
  assert.deepEqual(chooseExpansion({ names: names10, byExp, hint: 9 }), { expansion: 1 });
  assert.deepEqual(chooseExpansion({ names: ['m', 'n', 'o', 'p'], byExp }), { none: true });
});

test('alignCards : par nom, les homonymes dans l’ordre des numéros', () => {
  const tcg = [{ number: '1', name: 'Pikachu' }, { number: '2', name: 'Eevee' }, { number: '10', name: 'Pikachu - 010/009' }];
  const cm = [{ idProduct: 105, name: 'Pikachu [Zap]' }, { idProduct: 100, name: 'Pikachu [Zap]' }, { idProduct: 101, name: 'Eevee [Tackle]' }];
  assert.deepEqual([...alignCards(tcg, cm)], [['1', 100], ['2', 101], ['10', 105]]);
});
test('alignCards : un nom traduit différemment est placé par sa position entre deux voisins sûrs', () => {
  const tcg = [{ number: '1', name: 'Pikachu' }, { number: '2', name: 'Fight Gong' }, { number: '3', name: 'Eevee' }, { number: '4', name: 'Odd One' }];
  const cm = [{ idProduct: 100, name: 'Pikachu' }, { idProduct: 101, name: 'Fighting Gong' }, { idProduct: 102, name: 'Eevee' }, { idProduct: 150, name: 'Unrelated' }];
  assert.deepEqual([...alignCards(tcg, cm)], [['1', 100], ['2', 101], ['3', 102]]); // « Odd One » n'a pas de voisin après lui : laissée de côté
});
test('alignCards : pas d’interpolation si l’écart d’identifiants ne correspond pas à l’écart de numéros', () => {
  const tcg = [{ number: '1', name: 'A' }, { number: '2', name: 'Xx' }, { number: '3', name: 'B' }];
  const cm = [{ idProduct: 100, name: 'A' }, { idProduct: 101, name: 'Yy' }, { idProduct: 105, name: 'Zz' }, { idProduct: 109, name: 'B' }];
  assert.deepEqual([...alignCards(tcg, cm)], [['1', 100], ['3', 109]]);
});

const products = [
  { idProduct: 100, name: 'Pikachu [Zap]', idExpansion: 7 }, { idProduct: 101, name: 'Eevee [Tackle]', idExpansion: 7 },
  { idProduct: 102, name: 'Mew [Psy]', idExpansion: 7 }, { idProduct: 103, name: 'Snorlax', idExpansion: 7 },
  { idProduct: 900, name: 'Eevee [Tackle]', idExpansion: 8 },
];
const group = { name: 'SVX: Test', date: '2025-03-14', official: 3, cards: [
  { number: '001', name: 'Pikachu', rarity: 'Common', productId: 1 }, { number: '002', name: 'Eevee', rarity: 'Common', productId: 2 },
  { number: '003', name: 'Mew', rarity: 'Rare', productId: 3 }, { number: '004', name: 'Snorlax', rarity: 'Art Rare', productId: 4 },
] };

test('fillCatalog : ajoute les cartes manquantes et corrige celles rattachées ailleurs', () => {
  const catalog = { sets: { SVX: { name: 'テスト', official: 3, img: null, date: '2025-03-14' } }, cards: [
    { id: 100, t: 'SVX-001', s: 'SVX', n: '001', ja: 'ピカチュウ', en: 'Pikachu [Zap]', q: null, r: 'regular' },
    { id: 900, t: 'SVX-002', s: 'SVX', n: '002', ja: 'イーブイ', en: 'Eevee [Tackle]', q: null, r: 'regular' }, // mauvaise extension
  ] };
  const report = fillCatalog(catalog, { groups: { SVX: group }, products, overrides: {} });
  assert.deepEqual(catalog.cards.map((c) => [c.n, c.id]), [['001', 100], ['002', 101], ['003', 102], ['004', 103]]);
  assert.deepEqual(catalog.cards[2], { id: 102, t: 'SVX-003', s: 'SVX', n: '003', ja: '', en: 'Mew [Psy]', q: null, r: 'unknown', q2: 'Rare', g: 3 });
  assert.equal(catalog.cards[1].ja, 'イーブイ');
  assert.deepEqual(report.SVX, { expansion: 7, added: 2, fixed: 1 });
  assert.equal(catalog.aliases, undefined); // une correction ici ne doit pas faire migrer les collections
});
test('fillCatalog : crée une extension inconnue de TCGdex ; rejouable sans doublon', () => {
  const catalog = { sets: {}, cards: [] };
  fillCatalog(catalog, { groups: { SVX: group }, products, overrides: {} });
  assert.deepEqual(catalog.sets.SVX, { name: 'SVX: Test', official: 3, total: 4, img: null, date: '2025-03-14' });
  assert.equal(catalog.cards.length, 4);
  const again = fillCatalog(catalog, { groups: { SVX: group }, products, overrides: {} });
  assert.equal(catalog.cards.length, 4);
  assert.deepEqual(again.SVX, { expansion: 7, added: 0, fixed: 0 });
});
test('fillCatalog : extension ambiguë ou introuvable laissée telle quelle et signalée', () => {
  const twins = [...products, ...products.filter((p) => p.idExpansion === 7).map((p) => ({ ...p, idProduct: p.idProduct + 1000, idExpansion: 9 }))];
  const catalog = { sets: {}, cards: [] };
  const report = fillCatalog(catalog, { groups: { SVX: group }, products: twins, overrides: {} });
  assert.deepEqual(report.SVX, { ambiguous: [7, 9] });
  assert.equal(catalog.cards.length, 0);
  assert.deepEqual(fillCatalog({ sets: {}, cards: [] }, { groups: { SVX: group }, products: twins, overrides: { SVX: 9 } }).SVX, { expansion: 9, added: 4, fixed: 0 });
});
test('fillCatalog : un produit Cardmarket déjà pris par une autre extension n’est pas réattribué', () => {
  const catalog = { sets: { OTHER: {} }, cards: [{ id: 102, t: 'OTHER-1', s: 'OTHER', n: '1', ja: 'x', en: 'Mew [Psy]', q: 'Rare', r: 'regular' }] };
  fillCatalog(catalog, { groups: { SVX: group }, products, overrides: {} });
  assert.deepEqual(catalog.cards.filter((c) => c.id === 102).map((c) => c.s), ['OTHER']);
  assert.equal(catalog.cards.filter((c) => c.s === 'SVX').length, 3);
});
