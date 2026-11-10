import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../site/lib/metrics.js';
import { historyFile } from '../scripts/ingest.mjs';

const catalog = {
  sets: { SV8a: { name: 'テラスタルフェスex', img: 'https://assets.tcgdex.net/ja/SV/SV8a' }, M2: { name: 'インフェルノX', img: null } },
  cards: [
    { id: 803325, t: 'SV8a-212', s: 'SV8a', n: '212', ja: 'ニンフィアex', en: 'Sylveon ex [Magical Charm | Angelite]', r: 'SAR' },
    { id: 803303, t: 'SV8a-190', s: 'SV8a', n: '190', ja: 'コルサ', en: 'Brassius', r: 'AR' },
    { id: 3, t: 'SV8a-230', s: 'SV8a', n: '230', ja: 'ピカチュウex', en: 'Pikachu ex', r: 'secret' },
    { id: 4, t: 'M2-010', s: 'M2', n: '010', ja: 'ヒトカゲ', en: 'Charmander', r: 'regular' },
    { id: 5, t: 'M2-100', s: 'M2', n: '100', ja: 'リザードン', en: 'Mega Charizard', r: 'SAR' },
  ],
};
//                     trend   low  avg1  avg7  avg30   d7    d30
const snapshot = { date: '2026-11-10', approx: { d7: false, d30: false }, cards: {
  803325: [10324, 6200, 10500, 11576, 11976, 18.0, -13.8],
  803303: [170, 75, 149, 163, 179, 11.0, -5.0],
  3: [999, 500, 900, 1000, 2002, -6.0, -50.1],
  4: [2000, 100, null, null, 1000, null, 100.0],
  5: [5000, 4000, 5000, 5200, 6000, -3.0, -16.7],
} };

test('formatEuro', () => {
  assert.equal(m.formatEuro(10324), '103,24 €');
  assert.equal(m.formatEuro(481200), '4 812,00 €');
  assert.equal(m.formatEuro(5), '0,05 €');
  assert.equal(m.formatEuro(null), '—');
  assert.equal(m.formatEuro(undefined), '—');
});
test('formatPct', () => {
  assert.equal(m.formatPct(18), '+18,0 %');
  assert.equal(m.formatPct(-6.25), '−6,3 %');
  assert.equal(m.formatPct(0), '0,0 %');
  assert.equal(m.formatPct(null), '—');
});
test('searchCards : japonais, anglais, extension + numéro', () => {
  assert.equal(m.searchCards(catalog, 'ニンフィア')[0].id, 803325);
  assert.equal(m.searchCards(catalog, 'sv8a 212')[0].id, 803325);
  assert.equal(m.searchCards(catalog, 'sylveon')[0].id, 803325);
  assert.equal(m.searchCards(catalog, 'CHARIZARD m2')[0].id, 5);
  assert.deepEqual(m.searchCards(catalog, '   '), []);
  assert.deepEqual(m.searchCards(catalog, 'zzzz'), []);
  assert.equal(m.searchCards(catalog, 'ex', 1).length, 1);
});
test('imageUrl et cardmarketUrl', () => {
  assert.equal(m.imageUrl(catalog.cards[0], catalog.sets), 'https://assets.tcgdex.net/ja/SV/SV8a/212/low.webp');
  assert.equal(m.imageUrl(catalog.cards[0], catalog.sets, 'high'), 'https://assets.tcgdex.net/ja/SV/SV8a/212/high.webp');
  assert.equal(m.imageUrl(catalog.cards[3], catalog.sets), null);
  assert.equal(m.cardmarketUrl(803325), 'https://www.cardmarket.com/fr/Pokemon/Products?idProduct=803325');
  assert.equal(m.cardmarketUrl(803325, { language: 7, sellerCountry: 12 }), 'https://www.cardmarket.com/fr/Pokemon/Products?idProduct=803325&language=7&sellerCountry=12');
});
test('historyFile identique côté site et côté ingestion', () => {
  for (const id of ['SV8a', 'sm3+', 'a/b', 'S-P']) assert.equal(m.historyFile(id), historyFile(id));
});

const ids = (list) => list.map((x) => x.card.id);
const base = { rarities: null, tab: 'down', window: 30, minCents: 0 };
test('marché : filtre de rareté', () => {
  assert.deepEqual(ids(m.marketList(catalog, snapshot, { ...base, rarities: ['AR', 'SAR'] })), [5, 803325, 803303]);
  assert.deepEqual(ids(m.marketList(catalog, snapshot, { ...base, rarities: ['secret'] })), [3]);
  assert.equal(m.marketList(catalog, snapshot, base).length, 4);
});
test('marché : hausses (> 0) décroissantes, baisses (< 0) croissantes, sans les null', () => {
  assert.deepEqual(ids(m.marketList(catalog, snapshot, { ...base, tab: 'up', window: 7 })), [803325, 803303]);
  assert.deepEqual(ids(m.marketList(catalog, snapshot, { ...base, tab: 'down', window: 7 })), [3, 5]);
  assert.deepEqual(ids(m.marketList(catalog, snapshot, { ...base, tab: 'up', window: 30 })), [4]);
  assert.equal(m.marketList(catalog, snapshot, { ...base, tab: 'up', window: 7 })[0].change, 18.0);
});
test('marché : bonnes affaires = trend ≤ avg30 × 0,85, triées par écart', () => {
  const deals = m.marketList(catalog, snapshot, { ...base, tab: 'deals' });
  assert.deepEqual(ids(deals), [3, 5]);
  assert.equal(deals[0].change, -50.1);
  assert.deepEqual(ids(m.marketList(catalog, snapshot, { ...base, tab: 'deals', dealRatio: 0.9 })), [3, 5, 803325]);
});
test('marché : prix minimum et limite', () => {
  assert.deepEqual(ids(m.marketList(catalog, snapshot, { ...base, minCents: 1000 })), [5, 803325]);
  assert.equal(m.marketList(catalog, snapshot, { ...base, limit: 2 }).length, 2);
});

test('collection : valeur totale, cartes sans prix ou inconnues comptées à part', () => {
  const holdings = [{ id_product: 803325, qty: 2 }, { id_product: 803303, qty: 1 }, { id_product: 999999, qty: 3 }];
  assert.deepEqual(m.collectionValue(holdings, snapshot), { totalCents: 2 * 10324 + 170, unpriced: 1, count: 6 });
  const noTrend = { ...snapshot, cards: { ...snapshot.cards, 803303: [null, 75, null, null, null, null, null] } };
  assert.deepEqual(m.collectionValue(holdings, noTrend), { totalCents: 20648, unpriced: 2, count: 6 });
  assert.deepEqual(m.collectionValue([], snapshot), { totalCents: 0, unpriced: 0, count: 0 });
});
test('collection : courbe de valeur sur plusieurs extensions, dernier prix connu repris', () => {
  const histories = {
    SV8a: { dates: ['2026-11-08', '2026-11-09', '2026-11-10'], cards: { 803325: { t: [100, null, 120] }, 803303: { t: [null, 10, 12] } } },
    M2: { dates: ['2026-11-09', '2026-11-10'], cards: { 5: { t: [50, 55] } } },
  };
  const holdings = [{ id_product: 803325, qty: 2 }, { id_product: 803303, qty: 1 }, { id_product: 5, qty: 1 }, { id_product: 999999, qty: 1 }];
  assert.deepEqual(m.collectionSeries(holdings, histories), {
    dates: ['2026-11-08', '2026-11-09', '2026-11-10'],
    values: [200, 200 + 10 + 50, 240 + 12 + 55],
  });
  assert.deepEqual(m.collectionSeries([], histories), { dates: [], values: [] });
  assert.deepEqual(m.collectionSeries([{ id_product: 999999, qty: 1 }], histories).values, [null, null, null]);
});

test('envies : statut', () => {
  const row = snapshot.cards[803325];
  assert.deepEqual(m.wishStatus({ id_product: 803325, target_cents: 11000 }, row, null), { underTarget: true, gapCents: -676, low30: false, rising: true });
  assert.deepEqual(m.wishStatus({ id_product: 803325, target_cents: 9000 }, row, null), { underTarget: false, gapCents: 1324, low30: false, rising: true });
  assert.deepEqual(m.wishStatus({ id_product: 803325, target_cents: null }, row, null), { underTarget: false, gapCents: null, low30: false, rising: true });
  assert.deepEqual(m.wishStatus({ id_product: 1, target_cents: 500 }, undefined, null), { underTarget: false, gapCents: null, low30: false, rising: false });
});
test('envies : « au plus bas sur 30 j » demande au moins 14 jours d’historique', () => {
  const row = [100, null, null, null, null, 0, 0];
  const mk = (vals) => ({ dates: vals.map((_, i) => `d${i}`), cards: { 1: { t: vals } } });
  const wish = { id_product: 1, target_cents: null };
  assert.equal(m.wishStatus(wish, row, mk([...Array(13).fill(150), 100])).low30, true);
  assert.equal(m.wishStatus(wish, row, mk([...Array(12).fill(150), 100])).low30, false);
  assert.equal(m.wishStatus(wish, row, mk([90, ...Array(12).fill(150), 100])).low30, false);
  assert.equal(m.wishStatus(wish, row, mk([90, ...Array(30).fill(150), 100])).low30, true); // 90 est sorti de la fenêtre
});
test('envies : ordre — sous la cible d’abord, puis écart croissant, sans cible à la fin', () => {
  const items = [
    { id: 'a', status: { underTarget: false, gapCents: 900 } },
    { id: 'b', status: { underTarget: false, gapCents: null } },
    { id: 'c', status: { underTarget: true, gapCents: -50 } },
    { id: 'd', status: { underTarget: false, gapCents: 300 } },
    { id: 'e', status: { underTarget: true, gapCents: -500 } },
  ];
  assert.deepEqual(m.sortWishes(items).map((x) => x.id), ['e', 'c', 'd', 'a', 'b']);
});

test('displayName : nom Cardmarket sans la liste d’attaques, sinon nom japonais', () => {
  assert.equal(m.displayName({ en: 'Sylveon ex [Magical Charm | Angelite]', ja: 'ニンフィアex' }), 'Sylveon ex');
  assert.equal(m.displayName({ en: 'Brassius', ja: 'コルサ' }), 'Brassius');
  assert.equal(m.displayName({ en: null, ja: 'コルサ' }), 'コルサ');
});
test('sliceRange : garde les N derniers jours calendaires', () => {
  const dates = ['2026-10-01', '2026-11-03', '2026-11-04', '2026-11-10'];
  assert.equal(m.sliceRange(dates, '7'), 1);
  assert.equal(m.sliceRange(dates, '30'), 1);
  assert.equal(m.sliceRange(dates, '90'), 0);
  assert.equal(m.sliceRange(dates, 'all'), 0);
  assert.equal(m.sliceRange([], '7'), 0);
});
test('rangeChange : variation entre le premier et le dernier point non nuls', () => {
  assert.deepEqual(m.rangeChange([null, 200, 210, null, 230]), { deltaCents: 30, pct: 15.0 });
  assert.equal(m.rangeChange([null, 200]), null);
  assert.equal(m.rangeChange([]), null);
});

test('image : TCGdex d’abord, sinon image de secours TCGplayer', () => {
  const sets = { A: { img: 'https://assets.tcgdex.net/ja/SV/A' }, B: { img: null } };
  assert.deepEqual(m.imageUrls({ s: 'A', n: '001', g: 55 }, sets), ['https://assets.tcgdex.net/ja/SV/A/001/low.webp', 'https://tcgplayer-cdn.tcgplayer.com/product/55_200w.jpg']);
  assert.deepEqual(m.imageUrls({ s: 'B', n: '001', g: 55 }, sets, 'high'), ['https://tcgplayer-cdn.tcgplayer.com/product/55_in_1000x1000.jpg']);
  assert.deepEqual(m.imageUrls({ s: 'B', n: '001' }, sets), []);
  assert.equal(m.imageUrl({ s: 'B', n: '001', g: 55 }, sets), 'https://tcgplayer-cdn.tcgplayer.com/product/55_200w.jpg');
});
test('displayName : nom français en priorité ; recherche par nom français', () => {
  assert.equal(m.displayName({ fr: 'Nymphali ex', en: 'Sylveon ex [x]', ja: 'ニンフィアex' }), 'Nymphali ex');
  const cat = { sets: { A: {} }, cards: [{ id: 1, s: 'A', n: '1', ja: 'ニンフィアex', en: 'Sylveon ex', fr: 'Nymphali ex' }] };
  assert.equal(m.searchCards(cat, 'nymphali')[0].id, 1);
  assert.equal(m.searchCards(cat, 'sylveon')[0].id, 1);
});
