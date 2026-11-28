#!/usr/bin/env node
// Précision de la reconnaissance par empreinte, avant de construire le scanner :
//   node scripts/measure-fingerprints.mjs --data data --cache .images --out out [--sample 1500]
// Prend des cartes au hasard (toujours les mêmes), abîme leur image comme le ferait une photo (flou, lumière,
// teinte, compression, cadrage, rotation), recalcule l'empreinte et cherche la carte dans tout l'index. Mesure aussi
// la seconde image des cartes qui en ont deux (autre source, autre numérisation : le cas le plus réaliste).
// Résultats avec et sans filtre par numéro (le numéro lu sur la carte réduit les candidats). Écrit out/measure.md.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { colorHash, nearest, RECORD, HASH_BYTES, RECOGNITION_THRESHOLD } from '../site/lib/fingerprint.js';
import { decode } from './build-fingerprints.mjs';

const { values } = parseArgs({ options: {
  data: { type: 'string', default: 'data' }, cache: { type: 'string', default: '.images' },
  out: { type: 'string', default: 'out' }, sample: { type: 'string', default: '1500' },
} });
const sharp = (await import('sharp')).default;
const catalog = JSON.parse(await readFile(join(values.data, 'catalog.json'), 'utf8'));
const index = new Uint8Array(await readFile(join(values.out, 'fingerprints.bin')));
const alt = new Uint8Array(await readFile(join(values.out, 'fingerprints-alt.bin')));

const records = (buf) => {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = [];
  for (let o = 0; o + RECORD <= buf.length; o += RECORD) out.push({ id: view.getUint32(o, true), hash: buf.slice(o + 4, o + 4 + HASH_BYTES) });
  return out;
};

// Candidats quand le numéro est lu : même numéro ; ou même numéro et même total imprimé (« 112/098 »).
const byId = new Map(catalog.cards.map((c) => [c.id, c]));
const printedTotal = (c) => catalog.sets[c.s]?.official ?? null;
const groups = (key) => {
  const m = new Map();
  for (const c of catalog.cards) { const k = key(c); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(c.id); }
  return (c) => m.get(key(c));
};
const FILTERS = [
  { name: 'sans filtre', only: () => null },
  { name: 'numéro', only: groups((c) => c.n) },
  { name: 'numéro/total', only: groups((c) => `${c.n}/${printedTotal(c)}`) },
];

// Abîmer une image comme une photo. Chaque transformation renvoie une image encodée (PNG ou JPEG) pour sharp.
const raw = async (pipeline) => pipeline.raw().toBuffer({ resolveWithObject: true });
const fromRaw = ({ data, info }) => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
async function rotate(buf, deg) {
  const { width, height } = await sharp(buf).metadata();
  const r = await raw(sharp(buf).rotate(deg, { background: '#303030' }));
  const left = Math.floor((r.info.width - width) / 2), top = Math.floor((r.info.height - height) / 2);
  return fromRaw(r).extract({ left, top, width, height });
}
async function margin(img, pct) {
  const buf = await img.png().toBuffer();
  const { width, height } = await sharp(buf).metadata();
  const dx = Math.round(width * pct), dy = Math.round(height * pct);
  return sharp(buf).extend({ left: dx, right: dx, top: dy, bottom: dy, background: '#202020' });
}
async function crop(buf, pct) {
  const { width, height } = await sharp(buf).metadata();
  const dx = Math.round(width * pct), dy = Math.round(height * pct);
  return sharp(buf).extract({ left: dx, top: dy, width: width - 2 * dx, height: height - 2 * dy });
}
const warm = (img) => img.linear([1.12, 1, 0.85], [0, 0, 0]);
const DEGRADATIONS = [
  { name: 'image d’origine', make: (b) => sharp(b) },
  { name: 'flou', make: (b) => sharp(b).blur(1.5) },
  { name: 'sombre (−35 %)', make: (b) => sharp(b).modulate({ brightness: 0.65 }) },
  { name: 'claire (+35 %)', make: (b) => sharp(b).modulate({ brightness: 1.35 }) },
  { name: 'teinte chaude', make: (b) => warm(sharp(b)) },
  { name: 'petite et compressée', make: async (b) => sharp(await sharp(b).resize({ width: 90 }).jpeg({ quality: 35 }).toBuffer()) },
  { name: 'rotation 3°', make: (b) => rotate(b, 3) },
  { name: 'marge 5 %', make: (b) => margin(sharp(b), 0.05) },
  { name: 'rognée 4 %', make: (b) => crop(b, 0.04) },
  { name: 'photo (tout à la fois)', make: async (b) => {
    const img = await margin(await rotate(b, 2), 0.03);
    const step = await warm(img.modulate({ brightness: 0.8 })).blur(1).resize({ width: 600 }).jpeg({ quality: 60 }).toBuffer();
    return sharp(step);
  } },
];

// Échantillon fixe (graine constante) parmi les cartes indexées dont l'image est en cache.
const cached = new Set((await readdir(values.cache)).filter((f) => /-0\.\w+$/.test(f)).map((f) => f));
const fileOf = (id) => [`${id}-0.webp`, `${id}-0.jpg`].find((f) => cached.has(f));
let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pool = records(index).filter((r) => fileOf(r.id));
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const sample = pool.slice(0, Number(values.sample));

const threshold = Math.floor((1 - RECOGNITION_THRESHOLD / 100) * 105); // distance maximale pour « reconnue »
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const p90 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length * 0.9)] : null; };

/** Résultats d'une série de requêtes { id, hash } pour chaque filtre. */
function score(queries) {
  return FILTERS.map((f) => {
    let top1 = 0, top3 = 0, accepted = 0, acceptedRight = 0, ties = 0;
    const right = [], wrong = [];
    for (const q of queries) {
      const card = byId.get(q.id);
      const found = nearest(index, q.hash, { limit: 50, only: f.only(card) });
      const rank = found.findIndex((r) => r.id === q.id);
      const best = found[0];
      if (rank === 0) top1++;
      if (rank >= 0 && rank < 3) top3++;
      if (rank > 0 && found[rank].distance === best.distance) ties++;
      if (best.distance <= threshold) { accepted++; if (best.id === q.id) acceptedRight++; }
      if (rank >= 0) right.push(found[rank].distance);
      const firstWrong = found.find((r) => r.id !== q.id);
      if (firstWrong) wrong.push(firstWrong.distance);
    }
    const n = queries.length || 1;
    return { filter: f.name, top1: top1 / n, top3: top3 / n, ties: ties / n, accepted: accepted / n, precision: accepted ? acceptedRight / accepted : null,
      right: [median(right), p90(right)], wrong: median(wrong) };
  });
}

const rows = [];
const t0 = Date.now();
for (const d of DEGRADATIONS) {
  const queries = [];
  for (const r of sample) {
    const buf = await readFile(join(values.cache, fileOf(r.id)));
    const img = await d.make(buf);
    const { rgba, width, height } = await decode(sharp, await img.png().toBuffer());
    queries.push({ id: r.id, hash: colorHash(rgba, width, height) });
  }
  rows.push({ name: d.name, count: queries.length, results: score(queries) });
  console.log(`${d.name} : ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
const altQueries = records(alt);
rows.push({ name: 'seconde image (autre source)', count: altQueries.length, results: score(altQueries) });

const pct = (x) => (x === null ? '—' : `${(x * 100).toFixed(1)} %`);
const lines = [
  `# Reconnaissance par empreinte couleur (105 bits)`,
  '',
  `Index : ${index.length / RECORD} cartes. Échantillon : ${sample.length} cartes. Seuil « reconnue » : ${RECOGNITION_THRESHOLD} % de ressemblance (distance ≤ ${threshold}).`,
  '',
  'top 1 / top 3 : la bonne carte est la 1re / parmi les 3 premières. ex aequo : une autre carte est à égalité devant (même illustration). ',
  'reconnues : 1re carte sous le seuil ; justes : part des reconnues qui sont la bonne carte. distances : bonne carte (médiane, 90e centile) / meilleure mauvaise (médiane).',
  '',
];
for (const f of FILTERS.map((x) => x.name)) {
  lines.push(`## ${f}`, '', '| image | cartes | top 1 | top 3 | ex aequo | reconnues | justes | distances |', '|---|---:|---:|---:|---:|---:|---:|---|');
  for (const row of rows) {
    const r = row.results.find((x) => x.filter === f);
    lines.push(`| ${row.name} | ${row.count} | ${pct(r.top1)} | ${pct(r.top3)} | ${pct(r.ties)} | ${pct(r.accepted)} | ${pct(r.precision)} | ${r.right[0]} / ${r.right[1]} — ${r.wrong} |`);
  }
  lines.push('');
}
await writeFile(join(values.out, 'measure.md'), lines.join('\n'));
console.log(lines.join('\n'));
