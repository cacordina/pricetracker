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
// Prix retenu par le site (priceOf) = avg7, sinon avg30, sinon trend.
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
  assert.deepEqual(m.searchCards(catalog, 'sv8a', 60, { rarities: ['AR'] }).map((c) => c.id), [803303]);
  assert.deepEqual(m.searchCards(catalog, 'ex', 60, { rarities: ['SAR', 'secret'] }).map((c) => c.id), [803325, 3]);
  assert.deepEqual(m.searchCards(catalog, 'charmander', 60, { rarities: ['SAR'] }), []);
});
test('imageUrl et cardmarketUrl', () => {
  assert.equal(m.imageUrl(catalog.cards[0], catalog.sets), 'https://assets.tcgdex.net/ja/SV/SV8a/212/low.webp');
  assert.equal(m.imageUrl(catalog.cards[0], catalog.sets, 'high'), 'https://assets.tcgdex.net/ja/SV/SV8a/212/high.webp');
  assert.equal(m.imageUrl(catalog.cards[3], catalog.sets), null);
  assert.equal(m.cardmarketUrl(803325), 'https://www.cardmarket.com/fr/Pokemon/Products?idProduct=803325');
  assert.equal(m.cardmarketUrl(803325, { language: 7, sellerCountry: 12 }), 'https://www.cardmarket.com/fr/Pokemon/Products?idProduct=803325&language=7&sellerCountry=12');
});
test('ebaySoldUrl : ventes conclues, numéro sur le total officiel', () => {
  const url = new URL(m.ebaySoldUrl(catalog.cards[0], { SV8a: { official: 187 } }));
  assert.equal(url.origin + url.pathname, 'https://www.ebay.fr/sch/i.html');
  assert.equal(url.searchParams.get('LH_Sold'), '1');
  assert.equal(url.searchParams.get('LH_Complete'), '1');
  assert.match(url.searchParams.get('_nkw'), /^pokemon Sylveon ex 212\/187 japanese$/);
  const bare = new URL(m.ebaySoldUrl({ s: 'X', n: 'SV-P 001', en: null }, {}));
  assert.equal(bare.searchParams.get('_nkw'), 'pokemon SV-P 001 japanese');
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
test('marché : bonnes affaires = moyenne 7 j ≤ moyenne 30 j × 0,85, triées par écart', () => {
  const deals = m.marketList(catalog, snapshot, { ...base, tab: 'deals' });
  assert.deepEqual(ids(deals), [3]); // 1000 contre 2002 ; Dracaufeu 5200 contre 6000 = −13,3 %, pas assez
  assert.equal(deals[0].change, -50);
  assert.deepEqual(ids(m.marketList(catalog, snapshot, { ...base, tab: 'deals', dealRatio: 0.9 })), [3, 5]);
});
test('marché : prix minimum (sur le prix retenu) et limite', () => {
  assert.deepEqual(ids(m.marketList(catalog, snapshot, { ...base, minCents: 1000 })), [3, 5, 803325]);
  assert.equal(m.marketList(catalog, snapshot, { ...base, limit: 2 }).length, 2);
});

test('collection : valeur totale, cartes sans prix ou inconnues comptées à part', () => {
  const holdings = [{ id_product: 803325, qty: 2 }, { id_product: 803303, qty: 1 }, { id_product: 999999, qty: 3 }];
  assert.deepEqual(m.collectionValue(holdings, snapshot), { totalCents: 2 * 11576 + 163, unpriced: 1, count: 6 });
  const noPrice = { ...snapshot, cards: { ...snapshot.cards, 803303: [null, 75, null, null, null, null, null] } };
  assert.deepEqual(m.collectionValue(holdings, noPrice), { totalCents: 23152, unpriced: 2, count: 6 });
  assert.deepEqual(m.collectionValue([], snapshot), { totalCents: 0, unpriced: 0, count: 0 });
});
test('collection : courbe de valeur sur plusieurs extensions, dernier prix connu repris', () => {
  const histories = {
    SV8a: { dates: ['2026-11-08', '2026-11-09', '2026-11-10'], cards: { 803325: { p: [100, null, 120] }, 803303: { p: [null, 10, 12] } } },
    M2: { dates: ['2026-11-09', '2026-11-10'], cards: { 5: { p: [50, 55] } } },
  };
  const holdings = [{ id_product: 803325, qty: 2 }, { id_product: 803303, qty: 1 }, { id_product: 5, qty: 1 }, { id_product: 999999, qty: 1 }];
  assert.deepEqual(m.collectionSeries(holdings, histories), {
    dates: ['2026-11-08', '2026-11-09', '2026-11-10'],
    values: [200, 200 + 10 + 50, 240 + 12 + 55],
  });
  assert.deepEqual(m.collectionSeries([], histories), { dates: [], values: [] });
  assert.deepEqual(m.collectionSeries([{ id_product: 999999, qty: 1 }], histories).values, [null, null, null]);
});

test('collection : avec les dates d’achat, une carte compte à partir de son achat', () => {
  const histories = { SV8a: { dates: ['2026-11-08', '2026-11-09', '2026-11-10'], cards: { 803325: { p: [100, 110, 120] }, 803303: { p: [10, 10, 12] } } } };
  const holdings = [{ id_product: 803325, qty: 2, bought_on: '2026-11-09' }, { id_product: 803303, qty: 1, bought_on: null }];
  assert.deepEqual(m.collectionSeries(holdings, histories, { fromPurchase: true }).values, [10, 230, 252]);
  assert.deepEqual(m.collectionSeries(holdings, histories).values, [210, 230, 252]); // sans l'option : prix seuls
});
test('collection : somme payée jour par jour', () => {
  const dates = ['2026-11-08', '2026-11-09', '2026-11-10'];
  const holdings = [
    { id_product: 1, qty: 2, paid_cents: 500, bought_on: '2026-11-09' },
    { id_product: 2, qty: 1, paid_cents: 300, bought_on: null },
    { id_product: 3, qty: 1, paid_cents: null, bought_on: '2026-11-08' },
  ];
  assert.deepEqual(m.paidSeries(dates, holdings), [300, 1300, 1300]);
  assert.deepEqual(m.paidSeries(dates, [{ id_product: 1, qty: 1, paid_cents: 100, bought_on: '2026-11-10' }]), [null, null, 100]);
  assert.equal(m.paidSeries(dates, [{ id_product: 1, qty: 1, paid_cents: null }]), null);
});
test('collection : plus-value sur les cartes dont le prix d’achat et le prix du jour sont connus', () => {
  const holdings = [
    { id_product: 803325, qty: 2, paid_cents: 8000 }, // prix du jour 11576 (moyenne 7 j)
    { id_product: 803303, qty: 1, paid_cents: null },
    { id_product: 999999, qty: 1, paid_cents: 500 },  // pas de prix du jour
  ];
  assert.deepEqual(m.collectionGain(holdings, snapshot), {
    paidCents: 16000, valueCents: 23152, gainCents: 7152, pct: 44.7, count: 2, missing: 1, unpriced: 1,
  });
  assert.deepEqual(m.collectionGain([{ id_product: 803325, qty: 1, paid_cents: 0 }], snapshot).pct, null); // carte reçue gratuitement
  assert.deepEqual(m.collectionGain([], snapshot), { paidCents: 0, valueCents: 0, gainCents: 0, pct: null, count: 0, missing: 0, unpriced: 0 });
});

test('envies : statut', () => {
  const row = snapshot.cards[803325];
  assert.deepEqual(m.wishStatus({ id_product: 803325, target_cents: 12000 }, row, null), { underTarget: true, gapCents: -424, low30: false, rising: true });
  assert.deepEqual(m.wishStatus({ id_product: 803325, target_cents: 11000 }, row, null), { underTarget: false, gapCents: 576, low30: false, rising: true });
  assert.deepEqual(m.wishStatus({ id_product: 803325, target_cents: null }, row, null), { underTarget: false, gapCents: null, low30: false, rising: true });
  assert.deepEqual(m.wishStatus({ id_product: 1, target_cents: 500 }, undefined, null), { underTarget: false, gapCents: null, low30: false, rising: false });
});
test('envies : « au plus bas sur 30 j » demande au moins 14 jours d’historique', () => {
  const row = [100, null, null, null, null, 0, 0];
  const mk = (vals) => ({ dates: vals.map((_, i) => `d${i}`), cards: { 1: { p: vals } } });
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

test('staleIds : lignes dont l’identifiant a été remplacé dans le catalogue', () => {
  const aliases = { 10: 20, 11: 21 };
  assert.deepEqual(m.staleIds([{ id_product: 10, qty: 2 }, { id_product: 20, qty: 1 }, { id_product: 5, qty: 1 }], aliases), [{ from: 10, to: 20 }]);
  assert.deepEqual(m.staleIds([{ id_product: 5 }], aliases), []);
  assert.deepEqual(m.staleIds([{ id_product: 10 }], undefined), []);
});

test('complétion : part des cartes d’une rareté possédées, au total et par extension', () => {
  const cat = { sets: { A: { name: 'Alpha', date: '2026-01-01' }, B: { name: 'Beta', date: '2026-06-01' }, C: { name: 'Gamma' } }, cards: [
    { id: 1, s: 'A', r: 'AR' }, { id: 2, s: 'A', r: 'AR' }, { id: 3, s: 'A', r: 'SAR' }, { id: 4, s: 'A', r: 'regular' },
    { id: 5, s: 'B', r: 'AR' }, { id: 6, s: 'B', r: 'AR' }, { id: 7, s: 'B', r: 'AR' },
    { id: 8, s: 'C', r: 'AR' },
  ] };
  const holdings = [{ id_product: 1, qty: 3 }, { id_product: 3, qty: 1 }, { id_product: 5, qty: 1 }, { id_product: 6, qty: 1 }, { id_product: 999, qty: 1 }];
  assert.deepEqual(m.completion(holdings, cat, ['AR']), {
    owned: 3, total: 6, pct: 50,
    sets: [
      { set: 'B', name: 'Beta', owned: 2, total: 3, pct: 67 },
      { set: 'A', name: 'Alpha', owned: 1, total: 2, pct: 50 },
      { set: 'C', name: 'Gamma', owned: 0, total: 1, pct: 0 },
    ],
  });
  const both = m.completion(holdings, cat, ['AR', 'SAR']);
  assert.deepEqual([both.owned, both.total, both.sets.find((s) => s.set === 'A').owned], [4, 7, 2]);
  assert.deepEqual(m.completion([], { sets: {}, cards: [] }, ['AR']), { owned: 0, total: 0, pct: 0, sets: [] });
});

test('album : toutes les cartes d’une rareté, par extension, avec l’état possédé', () => {
  const cat = { sets: { A: { name: 'Alpha', date: '2026-01-01' }, B: { name: 'Beta', date: '2026-06-01' } }, cards: [
    { id: 2, s: 'A', n: '10', r: 'AR' }, { id: 1, s: 'A', n: '9', r: 'AR' }, { id: 3, s: 'A', n: '11', r: 'SAR' },
    { id: 5, s: 'B', n: '1', r: 'AR' }, { id: 6, s: 'B', n: '2', r: 'regular' },
  ] };
  const holdings = [{ id_product: 1, qty: 2 }];
  const all = m.album(cat, holdings, { rarities: ['AR'], show: 'all' });
  assert.deepEqual(all.map((g) => [g.set, g.owned, g.total, g.cards.map((c) => [c.card.id, c.qty])]), [
    ['B', 0, 1, [[5, 0]]],
    ['A', 1, 2, [[1, 2], [2, 0]]],
  ]);
  const missing = m.album(cat, holdings, { rarities: ['AR'], show: 'missing' });
  assert.deepEqual(missing.map((g) => [g.set, g.total, g.cards.map((c) => c.card.id)]), [['B', 1, [5]], ['A', 2, [2]]]);
  const owned = m.album(cat, holdings, { rarities: ['AR', 'SAR'], show: 'owned' });
  assert.deepEqual(owned.map((g) => [g.set, g.total, g.cards.map((c) => c.card.id)]), [['A', 3, [1]]]);
});

test('album par prix : à plat, toutes extensions, sans prix à la fin', () => {
  const cat = { sets: { A: { date: '2026-01-01' }, B: { date: '2026-06-01' } }, cards: [
    { id: 1, s: 'A', n: '9', r: 'AR' }, { id: 2, s: 'A', n: '10', r: 'AR' }, { id: 3, s: 'A', n: '11', r: 'SAR' },
    { id: 5, s: 'B', n: '1', r: 'AR' }, { id: 7, s: 'B', n: '3', r: 'AR' },
  ] };
  const snap = { cards: { 1: [500], 2: [2000], 3: [9000], 5: [800], 7: [null] } };
  const holdings = [{ id_product: 2, qty: 1 }];
  const ids = (list) => list.map((x) => x.card.id);
  assert.deepEqual(ids(m.albumByPrice(cat, holdings, snap, { rarities: ['AR'] })), [2, 5, 1, 7]);
  assert.deepEqual(ids(m.albumByPrice(cat, holdings, snap, { rarities: ['AR'], dir: 'asc' })), [1, 5, 2, 7]);
  assert.deepEqual(ids(m.albumByPrice(cat, holdings, snap, { rarities: ['AR', 'SAR'], show: 'missing' })), [3, 5, 1, 7]);
  assert.deepEqual(m.albumByPrice(cat, holdings, snap, { rarities: ['AR'] })[0], { card: cat.cards[1], qty: 1, trend: 2000 });
});

test('topOwned : cartes possédées les plus chères, sans les cartes inconnues ou sans prix', () => {
  const holdings = [{ id_product: 803303, qty: 5 }, { id_product: 803325, qty: 1 }, { id_product: 5, qty: 1 }, { id_product: 999, qty: 1 }, { id_product: 4, qty: 1 }];
  assert.deepEqual(m.topOwned(holdings, { ...catalog, byId: new Map(catalog.cards.map((c) => [c.id, c])) }, snapshot, 3).map((c) => c.id), [803325, 5, 4]);
  assert.deepEqual(m.topOwned([], { ...catalog, byId: new Map() }, snapshot, 3), []);
});

test('TCGplayer : conversion, écart et cartes moins chères en Europe', () => {
  assert.equal(m.usdToEur(11050, 0.925926), 10231);
  assert.equal(m.usdToEur(null, 0.9), null);
  assert.equal(m.usdToEur(100, null), null);
  assert.equal(m.usGap(10000, 12500), 25);
  assert.equal(m.usGap(10000, null), null);
  const us = { rate: 1, cards: { 803325: 14500, 803303: 180 } }; // Nymphali 11576 → +25,3 % ; Brassius 163 → +10,4 %
  const list = m.cheaperInEurope(catalog, snapshot, us, { minGap: 20 });
  assert.deepEqual(list.map((x) => [x.card.id, x.change, x.usEur]), [[803325, 25.3, 14500]]);
  assert.equal(m.cheaperInEurope(catalog, snapshot, us, { minGap: 5 }).length, 2);
  assert.deepEqual(m.cheaperInEurope(catalog, snapshot, { rate: null, cards: {} }, {}), []);
});

test('TCGplayer : courbe recalée sur les dates Cardmarket', () => {
  const dates = ['2026-11-08', '2026-11-09', '2026-11-11', '2026-11-20'];
  assert.deepEqual(m.alignTo(dates, ['2026-11-07', '2026-11-10'], [100, 120]), [100, 100, 120, null]);
  assert.deepEqual(m.alignTo(dates, ['2026-11-10', '2026-11-11'], [120, null]), [null, null, 120, null]);
  assert.deepEqual(m.alignTo(dates, [], []), [null, null, null, null]);
});

test('prix retenu : moyenne 7 j, sinon 30 j, sinon tendance — même règle que l’ingestion', async () => {
  const { mainPrice } = await import('../scripts/lib/money.mjs');
  const rows = [[75, 179, 189, 225, 293, null, null], [75, 179, 189, null, 293, null, null], [75, 179, 189, null, null, null, null], [null, 179, null, null, null, null, null]];
  assert.deepEqual(rows.map(m.priceOf), [225, 293, 75, null]);
  assert.deepEqual(rows.map(m.priceSource), ['avg7', 'avg30', 'trend', null]);
  for (const r of rows) assert.equal(m.priceOf(r), mainPrice({ t: r[0], a7: r[3], a30: r[4] }));
  assert.equal(m.priceOf(undefined), null);
});

test('extensions : vue d’ensemble, les plus récentes d’abord', () => {
  const holdings = [{ id_product: 803325, qty: 2 }, { id_product: 4, qty: 1 }];
  const cat = { ...catalog, sets: { ...catalog.sets, SV8a: { ...catalog.sets.SV8a, date: '2025-01-17' }, M2: { ...catalog.sets.M2, date: '2025-09-26' } } };
  const list = m.setsOverview(cat, snapshot, holdings);
  assert.deepEqual(list.map((e) => [e.set, e.date, e.total, e.owned, e.valueCents, e.top?.id]), [
    ['M2', '2025-09-26', 2, 1, 1000 + 5200, 5],              // carte 4 : moyenne 30 j (pas de moyenne 7 j)
    ['SV8a', '2025-01-17', 3, 1, 11576 + 163 + 1000, 803325],
  ]);
  assert.equal(m.setsOverview(cat, snapshot)[0].owned, 0);
});

test('extension : cartes, filtres et tris', () => {
  const holdings = [{ id_product: 803303, qty: 3 }];
  const ids = (list) => list.map((i) => i.card.id);
  assert.deepEqual(ids(m.setCards(catalog, snapshot, holdings, 'SV8a')), [803303, 803325, 3]); // 190, 212, 230
  assert.deepEqual(ids(m.setCards(catalog, snapshot, holdings, 'SV8a', { sort: 'desc' })), [803325, 3, 803303]);
  assert.deepEqual(ids(m.setCards(catalog, snapshot, holdings, 'SV8a', { sort: 'asc' })), [803303, 3, 803325]);
  assert.deepEqual(ids(m.setCards(catalog, snapshot, holdings, 'SV8a', { rarities: ['AR', 'SAR'] })), [803303, 803325]);
  assert.deepEqual(ids(m.setCards(catalog, snapshot, holdings, 'SV8a', { show: 'missing' })), [803325, 3]);
  assert.deepEqual(m.setCards(catalog, snapshot, holdings, 'SV8a', { show: 'owned' })[0], { card: catalog.cards[1], qty: 3, price: 163 });
  const unpriced = { ...snapshot, cards: { ...snapshot.cards, 803325: undefined } };
  assert.deepEqual(ids(m.setCards(catalog, unpriced, [], 'SV8a', { sort: 'asc' })), [803303, 3, 803325]); // sans prix à la fin
});

test('grandes séries : d’après le code, sinon d’après la date', () => {
  const id = (setId, date) => m.seriesOf(setId, date).id;
  assert.equal(id('M2a', '2025-11-15'), 'mega');
  assert.equal(id('M-P', '2025-07-01'), 'mega');
  assert.equal(id('mEE', '2026-07-31'), 'mega');
  assert.equal(id('MBG', '2025-09-26'), 'mega');
  assert.equal(id('SV8a', '2024-12-06'), 'sv');
  assert.equal(id('svAW', '2023-01-20'), 'sv');
  assert.equal(id('SVOM', '2025-02-21'), 'sv');
  assert.equal(id('WCS23', '2023-07-01'), 'sv');
  assert.equal(id('S12a', '2022-12-02'), 'ss'); // sortie après SV-P, mais bien Épée et Bouclier
  assert.equal(id('sp5', '2021-08-01'), 'ss');
  assert.equal(id('s8a-P', '2021-10-22'), 'ss');
  assert.equal(id('SM12a', '2019-10-04'), 'sm');
  assert.equal(id('smJ', '2018-12-01'), 'sm');
  assert.equal(id('CP5', '2016-07-01'), 'xy');
  assert.equal(id('MMB', '2015-08-01'), 'xy'); // code en M mais 2015 : par la date
  assert.equal(id('MDB', '2012-09-01'), 'bw');
  assert.equal(id('EBB', '2013-07-01'), 'bw');
  assert.equal(id('BW1', '2010-12-03'), 'bw');
  assert.equal(id('XY-Bx', '2013-12-06'), 'xy');
  assert.equal(id('XY', '2017-04-21'), 'sm'); // « SM: The Best of XY »
  assert.equal(id('BW', '2019-10-04'), 'sm'); // « BW: Extra Regulation Box »
  assert.equal(id('L1: HG', '2009-10-01'), 'hgss');
  assert.equal(id('E', '2009-11-01'), 'hgss');
  assert.equal(id('PMCG1', '1996-10-20'), 'old');
  assert.equal(id('ZZZ', null), 'old');
});

test('vintedUrl : nom français, numéro sur le total officiel, plus récentes d’abord', () => {
  const url = new URL(m.vintedUrl({ s: 'SV8a', n: '212', fr: 'Nymphali ex', en: 'Sylveon ex [x]' }, { SV8a: { official: 187 } }));
  assert.equal(url.origin + url.pathname, 'https://www.vinted.fr/catalog');
  assert.equal(url.searchParams.get('search_text'), 'pokemon Nymphali ex 212/187');
  assert.equal(url.searchParams.get('order'), 'newest_first');
  assert.equal(new URL(m.vintedUrl({ s: 'X', n: 'SV-P 001', en: 'Pikachu [y]' })).searchParams.get('search_text'), 'pokemon Pikachu SV-P 001');
});
