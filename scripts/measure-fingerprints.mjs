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
import { scanHash, nearest, RECORD, SCAN_BYTES, SCAN_BITS, SCAN_MAX_DISTANCE, SCAN_MIN_GAP } from '../site/lib/fingerprint.js';
import { acceptMatch, lookFrame } from '../site/lib/scan.js';
import { decode } from './build-fingerprints.mjs';
import { degradations } from './lib/degrade.mjs';

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
  for (let o = 0; o + RECORD <= buf.length; o += RECORD) out.push({ id: view.getUint32(o, true), hash: buf.slice(o + 4, o + 4 + SCAN_BYTES) });
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

const DEGRADATIONS = degradations(sharp);

// Échantillon fixe (graine constante) parmi les cartes indexées dont l'image est en cache.
const cached = new Set((await readdir(values.cache)).filter((f) => /-0\.\w+$/.test(f)).map((f) => f));
const fileOf = (id) => [`${id}-0.webp`, `${id}-0.jpg`].find((f) => cached.has(f));
let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pool = records(index).filter((r) => fileOf(r.id));
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const sample = pool.slice(0, Number(values.sample));

const threshold = SCAN_MAX_DISTANCE; // distance maximale pour « reconnue »
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const p99 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length * 0.99)] : null; };
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
      right: [median(right), p90(right), p99(right)], wrong: median(wrong) };
  });
}

const rows = [];
const positives = []; // requêtes réalistes, pour régler la règle d'acceptation
const POSITIVE = ['photo', 'dark', 'light', 'rotate', 'small'];
const t0 = Date.now();
for (const d of DEGRADATIONS) {
  const queries = [];
  for (const r of sample) {
    const buf = await readFile(join(values.cache, fileOf(r.id)));
    const img = await d.make(buf);
    const { rgba, width, height } = await decode(sharp, await img.png().toBuffer());
    queries.push({ id: r.id, hash: scanHash(rgba, width, height) });
  }
  if (POSITIVE.includes(d.key)) positives.push(...queries.map((q) => ({ ...q, kind: d.name })));
  rows.push({ name: d.name, count: queries.length, results: score(queries) });
  console.log(`${d.name} : ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
const altQueries = records(alt);
rows.push({ name: 'seconde image (autre source)', count: altQueries.length, results: score(altQueries) });
positives.push(...altQueries.map((q) => ({ ...q, kind: 'seconde image' })));

// ---------- Images qui ne sont pas des cartes : le scanner ne doit rien reconnaître ----------
// Photos des produits scellés (boîtes, boosters : TCGplayer), surfaces (tables, feuille, main), gros plans sur une
// partie de carte (téléphone trop près : il ne faut pas annoncer une autre carte).
const negatives = [];
const boxes = [...new Set(Object.values(catalog.sets).map((x) => x.box).filter(Boolean))];
for (const box of boxes) {
  const file = join(values.cache, `box-${box}.jpg`);
  let buf = null;
  try { buf = await readFile(file); } catch {
    try {
      const res = await fetch(`https://tcgplayer-cdn.tcgplayer.com/product/${box}_200w.jpg`, { headers: { 'user-agent': 'jp-card-price-tracker' } });
      if (res.ok) { buf = Buffer.from(await res.arrayBuffer()); await writeFile(file, buf); }
    } catch { /* image indisponible */ }
  }
  if (!buf) continue;
  for (const d of DEGRADATIONS.filter((x) => ['origin', 'photo'].includes(x.key))) {
    try {
      const { rgba, width, height } = await decode(sharp, await (await d.make(buf)).png().toBuffer());
      negatives.push({ kind: 'produit scellé', hash: scanHash(rgba, width, height) });
    } catch { /* illisible */ }
  }
}
for (let k = 0; k < 120; k++) {
  // Surface : couleur de fond, dégradé, grain, éventuellement un objet sombre ou clair au milieu.
  const w = 240, h = 335, px = Buffer.alloc(w * h * 3);
  const base = [rnd() * 255, rnd() * 255, rnd() * 255], tilt = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5].map((v) => v * 120);
  const blob = rnd() < 0.5 ? { x: rnd() * w, y: rnd() * h, r: 30 + rnd() * 90, c: [rnd() * 255, rnd() * 255, rnd() * 255] } : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = y / h, n = (rnd() - 0.5) * 30;
    let c = base.map((b, i) => b + tilt[i] * t + n);
    if (blob && (x - blob.x) ** 2 + (y - blob.y) ** 2 < blob.r ** 2) c = blob.c.map((v) => v + n);
    px.set(c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), (y * w + x) * 3);
  }
  const { rgba, width, height } = await decode(sharp, await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer());
  negatives.push({ kind: 'surface', hash: scanHash(rgba, width, height) });
}
for (const r of sample.slice(0, 300)) {
  const buf = await readFile(join(values.cache, fileOf(r.id)));
  const { width, height } = await sharp(buf).metadata();
  // Un quart de la carte (illustration ou bas de carte), agrandi.
  const left = Math.round(width * (0.1 + rnd() * 0.4)), top = Math.round(height * (0.1 + rnd() * 0.45));
  const part = sharp(buf).extract({ left, top, width: Math.round(width * 0.45), height: Math.round(height * 0.45) }).resize({ width: 300 });
  const { rgba, width: pw, height: ph } = await decode(sharp, await part.png().toBuffer());
  negatives.push({ kind: 'gros plan', id: r.id, hash: scanHash(rgba, pw, ph) });
}
console.log(`${negatives.length} images qui ne sont pas des cartes : ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// Règle d'acceptation : part des vraies cartes reconnues, part où la bonne carte est alors parmi les 3 proposées,
// part des autres images faussement reconnues. Une image à la fois : le scanner exige en plus 3 images sur 4.
const posTop = positives.map((q) => ({ ...q, top: nearest(index, q.hash, { limit: 8 }) }));
const negTop = negatives.map((q) => ({ ...q, top: nearest(index, q.hash, { limit: 8 }) }));
const grid = [];
for (const maxDistance of [55, 60, 65, 70, 75, 80]) {
  for (const minGap of [0, 6, 10, 12, 14, 18]) {
    const rule = { maxDistance, minGap };
    const acc = posTop.filter((q) => acceptMatch(q.top, rule));
    const shownRight = acc.filter((q) => q.top.slice(0, 3).some((r) => r.id === q.id)).length;
    const falsePos = Object.fromEntries(['produit scellé', 'surface', 'gros plan'].map((kind) => {
      const list = negTop.filter((q) => q.kind === kind);
      return [kind, list.length ? list.filter((q) => acceptMatch(q.top, rule)).length / list.length : null];
    }));
    grid.push({ maxDistance, minGap, accepted: acc.length / posTop.length, right: acc.length ? shownRight / acc.length : null, falsePos });
  }
}

const pct = (x) => (x === null ? '—' : `${(x * 100).toFixed(1)} %`);
const lines = [
  `# Reconnaissance par empreinte de scan (${SCAN_BITS} bits)`,
  '',
  `Index : ${index.length / RECORD} cartes. Échantillon : ${sample.length} cartes. Seuil « reconnue » : distance ≤ ${threshold}.`,
  '',
  'top 1 / top 3 : la bonne carte est la 1re / parmi les 3 premières. ex aequo : une autre carte est à égalité devant (même illustration). ',
  'reconnues : 1re carte sous le seuil ; justes : part des reconnues qui sont la bonne carte. distances : bonne carte (médiane, 90e et 99e centiles) — meilleure mauvaise (médiane).',
  '',
];
for (const f of FILTERS.map((x) => x.name)) {
  lines.push(`## ${f}`, '', '| image | cartes | top 1 | top 3 | ex aequo | reconnues | justes | distances |', '|---|---:|---:|---:|---:|---:|---:|---|');
  for (const row of rows) {
    const r = row.results.find((x) => x.filter === f);
    lines.push(`| ${row.name} | ${row.count} | ${pct(r.top1)} | ${pct(r.top3)} | ${pct(r.ties)} | ${pct(r.accepted)} | ${pct(r.precision)} | ${r.right[0]} / ${r.right[1]} / ${r.right[2]} — ${r.wrong} |`);
  }
  lines.push('');
}
// ---------- Scènes caméra : le pipeline du téléphone ----------
// L'aperçu (aux proportions d'une carte) montre la carte posée dans le cadre de visée, sur un fond texturé (bois,
// tissu, dégradé), à une taille et un angle variables, avec lumière, teinte, flou et compression ; puis lookFrame
// (plusieurs découpages autour du cadre), comme sur le téléphone. Sans carte : fond seul, produit scellé dans le cadre.
const FW = 375, FH = Math.round(FW * 88 / 63);
function texture() {
  const px = Buffer.alloc(FW * FH * 3);
  const kind = Math.floor(rnd() * 3), base = [rnd() * 200 + 30, rnd() * 200 + 30, rnd() * 200 + 30], f = 4 + rnd() * 12, g = rnd() * 6;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const n = (rnd() - 0.5) * 30;
    const v = kind === 0 ? 30 * Math.sin(x / f + Math.sin(y / 40) * g) : kind === 1 ? 25 * Math.sign(Math.sin(x / f) * Math.sin(y / f)) : 60 * (y / FH - 0.5);
    px.set(base.map((b) => Math.max(0, Math.min(255, Math.round(b + v + n)))), (y * FW + x) * 3);
  }
  return sharp(px, { raw: { width: FW, height: FH, channels: 3 } });
}
async function scene(buf) {
  const scale = 0.7 + rnd() * 0.16, angle = (rnd() - 0.5) * 10;
  const cw = Math.round(FW * scale), chh = Math.round(cw * 88 / 63);
  const card = await sharp(buf).resize(cw, chh, { fit: 'fill' }).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const m = await sharp(card).metadata();
  const left = Math.round((FW - m.width) / 2 + (rnd() - 0.5) * FW * 0.04), top = Math.round((FH - m.height) / 2 + (rnd() - 0.5) * FH * 0.04);
  let img = (await texture()).composite([{ input: card, left: Math.max(0, left), top: Math.max(0, top) }]);
  img = sharp(await img.png().toBuffer()).modulate({ brightness: 0.75 + rnd() * 0.45 });
  if (rnd() < 0.5) img = img.linear([1 + rnd() * 0.15, 1, 1 - rnd() * 0.15], [0, 0, 0]);
  if (rnd() < 0.5) img = img.blur(0.5 + rnd());
  return sharp(await img.jpeg({ quality: 60 }).toBuffer());
}
async function look(img) {
  const { rgba, width, height } = await decode(sharp, await img.png().toBuffer());
  return lookFrame(index, rgba, width, height).top;
}
const camPos = [];
for (const r of sample.slice(0, 600)) camPos.push({ id: r.id, top: await look(await scene(await readFile(join(values.cache, fileOf(r.id))))) });
const camNeg = [];
for (let k = 0; k < 150; k++) camNeg.push({ kind: 'table seule', top: await look(await texture()) });
for (const box of boxes) {
  try { camNeg.push({ kind: 'produit scellé', top: await look(await scene(await readFile(join(values.cache, `box-${box}.jpg`)))) }); } catch { /* absente */ }
}
console.log(`scènes caméra : ${camPos.length} cartes, ${camNeg.length} sans carte (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
const camGrid = [];
for (const maxDistance of [70, 75, 80, 85, 90, 95, 100]) {
  for (const minGap of [12, 16, 20, 24, 28]) {
    const rule = { maxDistance, minGap };
    const acc = camPos.filter((q) => acceptMatch(q.top, rule));
    const right = acc.filter((q) => q.top.slice(0, 3).some((r) => r.id === q.id)).length;
    const fp = Object.fromEntries(['table seule', 'produit scellé'].map((kind) => {
      const list = camNeg.filter((q) => q.kind === kind);
      return [kind, list.length ? list.filter((q) => acceptMatch(q.top, rule)).length / list.length : null];
    }));
    camGrid.push({ maxDistance, minGap, accepted: acc.length / camPos.length, right: acc.length ? right / acc.length : null, fp });
  }
}
const camTop1 = camPos.filter((q) => q.top[0]?.id === q.id).length / camPos.length;
const camTop3 = camPos.filter((q) => q.top.slice(0, 3).some((r) => r.id === q.id)).length / camPos.length;

lines.push('## Règle d’acceptation du scanner', '',
  `Vraies cartes : ${posTop.length} (photo, sombre, claire, rotation, petite, seconde image). Autres images : ${negTop.length}. Réglage actuel : distance ≤ ${SCAN_MAX_DISTANCE}, écart ≥ ${SCAN_MIN_GAP}.`,
  'reconnues : part des vraies cartes acceptées ; bonne parmi les 3 : quand acceptée, la bonne carte est parmi les 3 proposées ; puis part des autres images faussement acceptées.', '',
  '| distance ≤ | écart ≥ | reconnues | bonne parmi les 3 | produit scellé | surface | gros plan |', '|---:|---:|---:|---:|---:|---:|---:|',
  ...grid.map((g) => `| ${g.maxDistance} | ${g.minGap} | ${pct(g.accepted)} | ${pct(g.right)} | ${pct(g.falsePos['produit scellé'])} | ${pct(g.falsePos.surface)} | ${pct(g.falsePos['gros plan'])} |`), '');
lines.push('## Scènes caméra (pipeline du téléphone)', '',
  `Cartes posées dans le cadre sur fond texturé : ${camPos.length} ; bonne carte en tête ${pct(camTop1)}, parmi les 3 premières ${pct(camTop3)}. Scènes sans carte : ${camNeg.length}.`, '',
  '| distance ≤ | écart ≥ | reconnues | bonne parmi les 3 | table seule | produit scellé |', '|---:|---:|---:|---:|---:|---:|',
  ...camGrid.map((g) => `| ${g.maxDistance} | ${g.minGap} | ${pct(g.accepted)} | ${pct(g.right)} | ${pct(g.fp['table seule'])} | ${pct(g.fp['produit scellé'])} |`), '');
await writeFile(join(values.out, 'measure.md'), lines.join('\n'));
console.log(lines.join('\n'));
