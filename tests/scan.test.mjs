import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScan } from '../site/lib/scan.js';

const catalog = {
  sets: { SV8a: { official: 187, date: '2024-12-06' }, M2: { official: 80, date: '2026-01-01' }, SV2a: { official: 165, date: '2023-06-16' }, OLD: { official: 187, date: '2019-01-01' }, 'SV-P': { official: null } },
  cards: [
    { id: 1, s: 'SV8a', n: '212', r: 'SAR' }, { id: 2, s: 'SV8a', n: '021', r: 'regular' },
    { id: 3, s: 'M2', n: '101', r: 'AR' }, { id: 4, s: 'SV2a', n: '171', r: 'AR' },
    { id: 5, s: 'OLD', n: '212', r: 'secret' }, { id: 6, s: 'SV-P', n: '021', r: 'regular' },
  ],
};
const ids = (r) => r.candidates.map((c) => c.id);

test('lit numéro, total et code de série', () => {
  const r = parseScan('H SV8a 212/187 SAR', catalog);
  assert.deepEqual([r.number, r.official, r.sets], ['212', '187', ['SV8a']]);
  assert.deepEqual(ids(r), [1]);
});
test('sans code de série : le total officiel départage, série récente d’abord', () => {
  assert.deepEqual(ids(parseScan('  212 / 187  ', catalog)), [1, 5]);
  assert.deepEqual(ids(parseScan('171/165 AR', catalog)), [4]);
});
test('tolère les confusions de lecture O/0 et l/1 dans le numéro', () => {
  assert.deepEqual(ids(parseScan('sv8a 2l2/1B7', catalog)), [1]);     // total illisible mais série lue
  assert.deepEqual(ids(parseScan('M2 1O1/O80', catalog)), [3]);
  assert.deepEqual(parseScan('M2 1O1/O80', catalog).number, '101');
});
test('zéros de tête ignorés des deux côtés', () => {
  assert.deepEqual(ids(parseScan('SV8a 21/187', catalog)), [2]);
  assert.deepEqual(ids(parseScan('101/80', catalog)), [3]);
});
test('code de série lu avec une casse ou un chiffre confondu', () => {
  assert.deepEqual(parseScan('SVBA 212/187', catalog).sets, []);
  assert.deepEqual(parseScan('sv8A 212/187', catalog).sets, ['SV8a']);
  assert.deepEqual(parseScan('SV2a 171/165', catalog).sets, ['SV2a']);
});
test('carte promo : numéro / code de série', () => {
  const r = parseScan('021/SV-P', catalog);
  assert.deepEqual([r.number, r.sets, ids(r)], ['21', ['SV-P'], [6]]);
});
test('rien d’exploitable : aucune proposition', () => {
  assert.deepEqual(parseScan('lorem ipsum', catalog).candidates, []);
  assert.deepEqual(parseScan('', catalog).candidates, []);
  assert.deepEqual(parseScan('999/999', catalog).candidates, []);
  assert.deepEqual(parseScan('212/999', catalog).candidates, []); // numéro connu mais ni série ni total concordant
});

test('mergeScans : retient la lecture confirmée par le plus de passes', async () => {
  const { mergeScans } = await import('../site/lib/scan.js');
  const a = { number: '212', official: '187', sets: [], candidates: [{ id: 1 }] };
  const b = { number: '21', official: '187', sets: [], candidates: [{ id: 2 }] };
  const none = { number: null, official: null, sets: [], candidates: [] };
  assert.equal(mergeScans([none, b, a, a]).candidates[0].id, 1);
  assert.equal(mergeScans([b, none, a]).candidates[0].id, 2);          // égalité : la première passe l'emporte
  assert.deepEqual(mergeScans([none, none]).candidates, []);
  assert.deepEqual(mergeScans([]).candidates, []);
});
test('mergeScans : une passe qui a aussi lu la série complète la lecture', async () => {
  const { mergeScans } = await import('../site/lib/scan.js');
  const loose = { number: '212', official: '187', sets: [], candidates: [{ id: 1 }, { id: 5 }] };
  const exact = { number: '212', official: '187', sets: ['SV8a'], candidates: [{ id: 1 }] };
  const merged = mergeScans([loose, exact]);
  assert.deepEqual([merged.sets, merged.candidates.map((c) => c.id)], [['SV8a'], [1]]);
});
test('mergeScans : sans proposition, garde quand même le numéro lu pour l’afficher', async () => {
  const { mergeScans } = await import('../site/lib/scan.js');
  const read = { number: '212', official: '999', sets: [], candidates: [] };
  assert.equal(mergeScans([{ number: null, official: null, sets: [], candidates: [] }, read]).number, '212');
});

test('suivi automatique : une lecture complète (série + total) est acceptée tout de suite', async () => {
  const { createTracker } = await import('../site/lib/scan.js');
  const t = createTracker();
  const full = { number: '212', official: '187', sets: ['SV8a'], candidates: [{ id: 1 }] };
  assert.deepEqual(t.push(full), { candidates: [{ id: 1 }] });
  assert.equal(t.push(full), null); // même carte toujours devant la caméra : pas de doublon
});
test('suivi automatique : une lecture partielle doit être confirmée par la suivante', async () => {
  const { createTracker } = await import('../site/lib/scan.js');
  const t = createTracker();
  const partial = { number: '212', official: '187', sets: [], candidates: [{ id: 1 }, { id: 5 }] };
  const other = { number: '21', official: '187', sets: [], candidates: [{ id: 2 }] };
  assert.equal(t.push(partial), null);
  assert.equal(t.push(other), null);        // lecture différente : on repart de zéro
  assert.equal(t.push(partial), null);
  assert.deepEqual(t.push(partial), { candidates: [{ id: 1 }, { id: 5 }] });
});
test('suivi automatique : la même carte est de nouveau acceptée après avoir été retirée', async () => {
  const { createTracker } = await import('../site/lib/scan.js');
  const t = createTracker();
  const full = { number: '212', official: '187', sets: ['SV8a'], candidates: [{ id: 1 }] };
  const none = { number: null, official: null, sets: [], candidates: [] };
  t.push(full);
  t.push(none); t.push(none);
  assert.equal(t.push(full), null);          // deux lectures vides ne suffisent pas
  t.push(none); t.push(none); t.push(none);
  assert.deepEqual(t.push(full), { candidates: [{ id: 1 }] });
});
test('suivi automatique : une autre carte est acceptée sans attendre', async () => {
  const { createTracker } = await import('../site/lib/scan.js');
  const t = createTracker();
  t.push({ number: '212', official: '187', sets: ['SV8a'], candidates: [{ id: 1 }] });
  assert.deepEqual(t.push({ number: '101', official: '80', sets: ['M2'], candidates: [{ id: 3 }] }), { candidates: [{ id: 3 }] });
});

test('cumul sur plusieurs images : numéro lu sur l’une, série ou total sur une autre', async () => {
  const { createEvidence } = await import('../site/lib/scan.js');
  const ev = createEvidence(catalog);
  assert.deepEqual(ids(ev.add(parseScan('212/1B7', catalog))), []);           // numéro seul : rien encore
  assert.deepEqual(ids(ev.add(parseScan('sv8a 2l2', catalog))), [1]);          // série lue ensuite, sans fraction
  const ev2 = createEvidence(catalog);
  ev2.add(parseScan('212/1B7', catalog));
  const r = ev2.add(parseScan('212/187', catalog));
  assert.deepEqual([ids(r), r.official], [[1, 5], '187']);
});
test('cumul : un autre numéro efface ce qui avait été lu pour la carte précédente', async () => {
  const { createEvidence } = await import('../site/lib/scan.js');
  const ev = createEvidence(catalog);
  ev.add(parseScan('SV8a 212/187', catalog));
  assert.deepEqual(ids(ev.add(parseScan('101/0B0', catalog))), []);            // la série SV8a ne doit pas servir à la carte 101
  assert.deepEqual(ids(ev.add(parseScan('M2 101/080', catalog))), [3]);
});
test('cumul : deux lectures vides de suite effacent tout', async () => {
  const { createEvidence } = await import('../site/lib/scan.js');
  const ev = createEvidence(catalog);
  ev.add(parseScan('sv8a', catalog));
  ev.add(parseScan('', catalog));
  ev.add(parseScan('', catalog));
  assert.deepEqual(ids(ev.add(parseScan('212/1B7', catalog))), []);
});
