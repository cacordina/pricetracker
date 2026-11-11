import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { marketPrices, parseEcbRate, pricesByCard, putDay, checkUsDay } from '../scripts/lib/tcgplayer.mjs';
import { ingestUs } from '../scripts/ingest-us.mjs';

test('tcgplayer : prix de marché par produit, finition holo préférée, produits non cotés ignorés', () => {
  const m = marketPrices([
    { productId: 1, subTypeName: 'Normal', marketPrice: 3.1 },
    { productId: 1, subTypeName: 'Holofoil', marketPrice: 12.345 },
    { productId: 2, subTypeName: 'Normal', marketPrice: 0.5, lowPrice: 0.2 },
    { productId: 3, subTypeName: 'Holofoil', marketPrice: null, lowPrice: 9 }, // pas de ventes : pas de prix
    { productId: 4, subTypeName: 'Reverse Holofoil', marketPrice: 2 },
  ]);
  assert.deepEqual([...m], [[1, 1235], [2, 50], [4, 200]]);
});

test('tcgplayer : taux BCE', () => {
  const xml = `<gesmes:Envelope><Cube><Cube time='2026-11-10'><Cube currency='USD' rate='1.0800'/><Cube currency='JPY' rate='165.2'/></Cube></Cube></gesmes:Envelope>`;
  assert.deepEqual(parseEcbRate(xml), { date: '2026-11-10', rate: 0.925926 });
  assert.throws(() => parseEcbRate('<html>maintenance</html>'), /illisible/);
});

test('tcgplayer : prix rattachés aux cartes du catalogue par l’identifiant TCGplayer', () => {
  const catalog = { cards: [{ id: 10, g: 1 }, { id: 11, g: 9 }, { id: 12 }] };
  assert.deepEqual([...pricesByCard(catalog, new Map([[1, 500], [2, 7]]))], [[10, 500]]);
});

test('tcgplayer : historique, ajout puis remplacement du même jour', () => {
  let h = putDay(null, '2026-11-10', 0.92, new Map([[10, 500]]), [10, 11]);
  assert.deepEqual(h, { dates: ['2026-11-10'], rates: [0.92], cards: { 10: [500] } });
  h = putDay(h, '2026-11-11', 0.93, new Map([[11, 80]]), [10, 11]);
  assert.deepEqual(h, { dates: ['2026-11-10', '2026-11-11'], rates: [0.92, 0.93], cards: { 10: [500, null], 11: [null, 80] } });
  h = putDay(h, '2026-11-11', 0.94, new Map([[10, 510], [11, 85]]), [10, 11]); // relance le même jour
  assert.deepEqual(h, { dates: ['2026-11-10', '2026-11-11'], rates: [0.92, 0.94], cards: { 10: [500, 510], 11: [null, 85] } });
  assert.throws(() => putDay(h, '2026-11-09', 1, new Map(), []), /antérieure/);
});

test('tcgplayer : garde-fous', () => {
  assert.equal(checkUsDay({ date: '2026-11-11', lastDate: '2026-11-10', count: 900, lastCount: 1000 }), null);
  assert.match(checkUsDay({ date: '2026-11-11', lastDate: null, count: 0, lastCount: null }), /Aucun prix/);
  assert.match(checkUsDay({ date: '2026-11-11', lastDate: '2026-11-10', count: 700, lastCount: 1000 }), /Seulement 700/);
  assert.match(checkUsDay({ date: '2026-11-09', lastDate: '2026-11-10', count: 900, lastCount: 1000 }), /antérieurs/);
});

/** tcgcsv et BCE simulés ; `down` liste les adresses en panne. */
function fakeFetch({ down = [] } = {}) {
  const routes = {
    'https://tcgcsv.com/last-updated.txt': '2026-11-10T20:07:31+0000',
    'https://tcgcsv.com/tcgplayer/85/groups': { results: [{ groupId: 501, abbreviation: 'SV8a' }, { groupId: 502, abbreviation: 'M2' }, { groupId: 503, abbreviation: 'XX' }] },
    'https://tcgcsv.com/tcgplayer/85/501/prices': { results: [{ productId: 9001, subTypeName: 'Holofoil', marketPrice: 110.5 }, { productId: 9002, subTypeName: 'Normal', marketPrice: 1.99 }] },
    'https://tcgcsv.com/tcgplayer/85/502/prices': { results: [{ productId: 9005, subTypeName: 'Holofoil', marketPrice: 60 }] },
    'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml': "<Cube time='2026-11-10'><Cube currency='USD' rate='1.0800'/></Cube>",
  };
  return async (url) => {
    if (down.includes(url) || !(url in routes)) return { ok: false, status: 503 };
    const body = routes[url];
    return { ok: true, status: 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
}

const catalog = { cards: [
  { id: 803325, s: 'SV8a', n: '212', g: 9001 }, { id: 803303, s: 'SV8a', n: '190', g: 9002 },
  { id: 5, s: 'M2', n: '100', g: 9005 }, { id: 6, s: 'M2', n: '101' },
] };
const read = async (dir, ...p) => JSON.parse(await readFile(join(dir, 'us', ...p), 'utf8'));

test('ingestUs : relevé complet, fichiers à part, rejouable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'us-'));
  const r = await ingestUs({ dataDir: dir, catalog, fetchImpl: fakeFetch(), delayMs: 0 });
  assert.deepEqual(r, { date: '2026-11-10', priced: 3, groups: 2, failed: 0, rate: 0.925926 });
  assert.deepEqual(await read(dir, 'snapshot.json'), { date: '2026-11-10', rate: 0.925926, rateDate: '2026-11-10', cards: { 803325: 11050, 803303: 199, 5: 6000 } });
  assert.deepEqual(await read(dir, 'history', 'SV8a.json'), { dates: ['2026-11-10'], rates: [0.925926], cards: { 803325: [11050], 803303: [199] } });
  await ingestUs({ dataDir: dir, catalog, fetchImpl: fakeFetch(), delayMs: 0 }); // passage de rattrapage
  assert.deepEqual((await read(dir, 'history', 'M2.json')).dates, ['2026-11-10']);
});

test('ingestUs : sans BCE, le taux précédent est gardé ; tcgcsv en panne, rien n’est écrit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'us-'));
  await ingestUs({ dataDir: dir, catalog, fetchImpl: fakeFetch(), delayMs: 0 });
  const noEcb = fakeFetch({ down: ['https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'] });
  const r = await ingestUs({ dataDir: dir, catalog, fetchImpl: noEcb, delayMs: 0 });
  assert.equal(r.rate, 0.925926);
  const before = await read(dir, 'snapshot.json');
  const noPrices = fakeFetch({ down: ['https://tcgcsv.com/tcgplayer/85/501/prices', 'https://tcgcsv.com/tcgplayer/85/502/prices'] });
  await assert.rejects(ingestUs({ dataDir: dir, catalog, fetchImpl: noPrices, delayMs: 0 }), /Aucun prix TCGplayer/);
  assert.deepEqual(await read(dir, 'snapshot.json'), before);
  const half = fakeFetch({ down: ['https://tcgcsv.com/tcgplayer/85/501/prices'] }); // 1 carte sur 3 : refusé
  await assert.rejects(ingestUs({ dataDir: dir, catalog, fetchImpl: half, delayMs: 0 }), /Seulement 1/);
});
