import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingest, historyFile } from '../scripts/ingest.mjs';
import { readJson } from './helpers.mjs';

const priceGuide = await readJson('prices.sample.json');
const catalog = {
  sets: { SV8a: { official: 187 } },
  cards: [
    { id: 803325, t: 'SV8a-212', s: 'SV8a', n: '212' },
    { id: 803303, t: 'SV8a-190', s: 'SV8a', n: '190' },
    { id: 922296, t: 'SV8a-999', s: 'SV8a', n: '999' }, // au catalogue mais sans prix
  ],
};
const fresh = () => mkdtemp(join(tmpdir(), 'ingest-'));
const tree = async (dir) => {
  const out = {};
  for (const f of (await readdir(dir, { recursive: true })).sort()) {
    try { out[f] = await readFile(join(dir, f), 'utf8'); } catch { /* dossier */ }
  }
  return out;
};
const nextDay = (guide, date, mutate = (x) => x) => ({ ...guide, createdAt: `${date}T02:50:00+0100`, priceGuides: mutate(guide.priceGuides) });

test('écrit historique + instantané, uniquement pour le catalogue japonais', async () => {
  const dataDir = await fresh();
  const r = await ingest({ dataDir, priceGuide, catalog });
  assert.deepEqual(r, { status: 'written', date: '2026-11-09' });
  const h = JSON.parse(await readFile(join(dataDir, 'history/SV8a.json'), 'utf8'));
  assert.deepEqual(h.dates, ['2026-11-09']);
  assert.deepEqual(h.cards[803325], { p: [11576], t: [10324], l: [6200], a: [10500] }); // p = moyenne 7 j
  assert.ok(!('271439' in h.cards));
  assert.ok(!('922296' in h.cards));
  const s = JSON.parse(await readFile(join(dataDir, 'snapshot.json'), 'utf8'));
  assert.equal(s.date, '2026-11-09');
  assert.equal(s.cards[803325][0], 10324);
  assert.deepEqual(Object.keys(s.cards).sort(), ['803303', '803325']);
});

test('rejoué le même jour : skipped, fichiers identiques', async () => {
  const dataDir = await fresh();
  await ingest({ dataDir, priceGuide, catalog });
  const before = await tree(dataDir);
  assert.deepEqual(await ingest({ dataDir, priceGuide, catalog }), { status: 'skipped', date: '2026-11-09' });
  assert.deepEqual(await tree(dataDir), before);
});

test('jour suivant : séries allongées', async () => {
  const dataDir = await fresh();
  await ingest({ dataDir, priceGuide, catalog });
  await ingest({ dataDir, priceGuide: nextDay(priceGuide, '2026-11-10'), catalog });
  const h = JSON.parse(await readFile(join(dataDir, 'history/SV8a.json'), 'utf8'));
  assert.deepEqual(h.dates, ['2026-11-09', '2026-11-10']);
  assert.deepEqual(h.cards[803325].t, [10324, 10324]);
});

test('garde-fou en échec : erreur, aucun fichier modifié', async () => {
  const dataDir = await fresh();
  await ingest({ dataDir, priceGuide, catalog });
  const before = await tree(dataDir);
  const broken = nextDay(priceGuide, '2026-11-10', (rows) => rows.filter((r) => r.idProduct !== 803325 && r.idProduct !== 803303));
  await assert.rejects(ingest({ dataDir, priceGuide: broken, catalog }), /cotée/);
  const older = nextDay(priceGuide, '2026-11-01');
  await assert.rejects(ingest({ dataDir, priceGuide: older, catalog }), /antérieur/);
  assert.deepEqual(await tree(dataDir), before);
});

test('fichier de prix invalide : erreur explicite', async () => {
  const dataDir = await fresh();
  await assert.rejects(ingest({ dataDir, priceGuide: { priceGuides: [] }, catalog }), /createdAt/);
  await assert.rejects(ingest({ dataDir, priceGuide: { createdAt: '2026-11-09T00:00:00+0100' }, catalog }), /priceGuides/);
  await assert.rejects(ingest({ dataDir, priceGuide, catalog: { sets: {}, cards: [] } }), /[Cc]atalogue/);
});

test('reprise après écriture partielle : historique déjà à jour, instantané en retard', async () => {
  const dataDir = await fresh();
  await ingest({ dataDir, priceGuide, catalog });
  const day2 = nextDay(priceGuide, '2026-11-10');
  const done = await fresh();
  await ingest({ dataDir: done, priceGuide, catalog });
  await ingest({ dataDir: done, priceGuide: day2, catalog });
  // simule un arrêt entre l'écriture de l'historique et celle de l'instantané
  await mkdir(join(dataDir, 'history'), { recursive: true });
  await writeFile(join(dataDir, 'history/SV8a.json'), await readFile(join(done, 'history/SV8a.json')));
  assert.equal((await ingest({ dataDir, priceGuide: day2, catalog })).status, 'written');
  assert.deepEqual(await tree(dataDir), await tree(done));
});

test('nom de fichier d’historique sûr', () => {
  assert.equal(historyFile('SV8a'), 'SV8a.json');
  assert.equal(historyFile('sm3+'), 'sm3_2b.json');
  assert.equal(historyFile('a/b'), 'a_2fb.json');
});
