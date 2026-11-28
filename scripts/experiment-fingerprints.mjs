#!/usr/bin/env node
// Comparaison de variantes de reconnaissance, SANS numéro lu sur la carte (le but : ne rien taper) :
//   node scripts/experiment-fingerprints.mjs --data data --cache .images --out out [--sample 600]
// Le cache d'images est celui de build-fingerprints.mjs. Variantes :
//   base       empreinte 105 bits de l'image entière (méthode actuelle)
//   rognée     la même, après recadrage automatique sur les bords de la carte (trimBorders)
//   189 bits   recadrée, empreinte plus fine (8×8 fréquences)
//   +illus.    recadrée, 189 bits de la carte + 105 bits de la zone de l'illustration
// Et pour chacune :
//   + 2d tri   les 20 meilleures départagées par une comparaison fine (vignette 16×22 en couleur), ce que le
//              téléphone peut faire en téléchargeant l'image de ces 20 cartes
//   + bas      2d tri avec en plus la bande du bas de la carte (numéro, symbole d'extension) : rééditions
// Écrit out/experiment.md.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { colorHash, cropRGBA, trimBorders, thumbnail, thumbnailDistance, hamming } from '../site/lib/fingerprint.js';
import { decode } from './build-fingerprints.mjs';
import { degradations } from './lib/degrade.mjs';

const { values } = parseArgs({ options: {
  data: { type: 'string', default: 'data' }, cache: { type: 'string', default: '.images' },
  out: { type: 'string', default: 'out' }, sample: { type: 'string', default: '600' },
} });
const sharp = (await import('sharp')).default;
const catalog = JSON.parse(await readFile(join(values.data, 'catalog.json'), 'utf8'));

const ART = { x: 0.08, y: 0.1, w: 0.84, h: 0.42 }; // fenêtre de l'illustration d'une carte classique
const BOTTOM = { x: 0, y: 0.86, w: 1, h: 0.12 }; // bande du bas : numéro, rareté, symbole d'extension

/** Toutes les caractéristiques d'une image (pixels RGBA décodés). */
function features({ rgba, width, height }) {
  const rect = trimBorders(rgba, width, height);
  const card = cropRGBA(rgba, width, height, rect);
  const art = cropRGBA(card.rgba, card.width, card.height, ART);
  const bottom = cropRGBA(card.rgba, card.width, card.height, BOTTOM);
  return {
    base: colorHash(rgba, width, height),
    trim: colorHash(card.rgba, card.width, card.height),
    fine: colorHash(card.rgba, card.width, card.height, { freq: 8 }),
    art: colorHash(art.rgba, art.width, art.height),
    thumb: thumbnail(card.rgba, card.width, card.height),
    bottom: thumbnail(bottom.rgba, bottom.width, bottom.height, 40, 5),
  };
}
const fromBuffer = async (buf) => features(await decode(sharp, await sharp(buf).png().toBuffer()));

// Index : toutes les cartes dont la première image est en cache.
const files = await readdir(values.cache);
const mainFile = new Map(), altFile = new Map();
for (const f of files) {
  const m = /^(\d+)-(\d)\./.exec(f);
  if (m) (m[2] === '0' ? mainFile : altFile).set(Number(m[1]), f);
}
const ids = catalog.cards.map((c) => c.id).filter((id) => mainFile.has(id));
const index = [];
const t0 = Date.now();
for (const id of ids) {
  try { index.push({ id, ...(await fromBuffer(await readFile(join(values.cache, mainFile.get(id))))) }); } catch { /* image illisible */ }
  if (index.length % 3000 === 0) console.log(`index ${index.length}/${ids.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

const METHODS = [
  { name: 'base', dist: (q, c) => hamming(q.base, c.base, 0, 14) },
  { name: 'rognée', dist: (q, c) => hamming(q.trim, c.trim, 0, 14) },
  { name: '189 bits', dist: (q, c) => hamming(q.fine, c.fine, 0, 24) },
  { name: '+illus.', dist: (q, c) => hamming(q.fine, c.fine, 0, 24) + hamming(q.art, c.art, 0, 14) },
];
const RERANK = 20;
const rerank = (withBottom) => (q, top) => top
  .map((c) => ({ c, d: thumbnailDistance(q.thumb, c.thumb) + (withBottom ? 0.5 * thumbnailDistance(q.bottom, c.bottom) : 0) }))
  .sort((a, b) => a.d - b.d).map((x) => x.c);

/** Les k cartes les plus proches, sans trier tout l'index. */
function topK(q, dist, k) {
  const best = [];
  let worst = Infinity;
  for (const c of index) {
    const d = dist(q, c);
    if (best.length === k && d >= worst) continue;
    let i = best.length;
    while (i > 0 && best[i - 1].d > d) i--;
    best.splice(i, 0, { c, d });
    if (best.length > k) best.pop();
    if (best.length === k) worst = best[k - 1].d;
  }
  return best.map((x) => x.c);
}

const VARIANTS = METHODS.flatMap((m) => [m.name, `${m.name} + 2d tri`, `${m.name} + 2d tri + bas`]);
function evaluate(queries) {
  const res = Object.fromEntries(VARIANTS.map((k) => [k, { top1: 0, top3: 0 }]));
  const hit = (name, ranked, id) => {
    const rank = ranked.findIndex((c) => c.id === id);
    if (rank === 0) res[name].top1++;
    if (rank >= 0 && rank < 3) res[name].top3++;
  };
  for (const q of queries) {
    for (const m of METHODS) {
      const ranked = topK(q, m.dist, RERANK);
      hit(m.name, ranked, q.id);
      hit(`${m.name} + 2d tri`, rerank(false)(q, ranked), q.id);
      hit(`${m.name} + 2d tri + bas`, rerank(true)(q, ranked), q.id);
    }
  }
  for (const r of Object.values(res)) { r.top1 /= queries.length; r.top3 /= queries.length; }
  return res;
}

// Requêtes : un échantillon fixe de cartes, abîmées ; et la seconde image (autre source) des cartes qui en ont deux.
let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pool = [...index];
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const sample = pool.slice(0, Number(values.sample));
const KEEP = ['photo', 'margin', 'rotate', 'light'];
const rows = [];
for (const d of degradations(sharp).filter((x) => KEEP.includes(x.key))) {
  const queries = [];
  for (const c of sample) {
    const buf = await readFile(join(values.cache, mainFile.get(c.id)));
    queries.push({ id: c.id, ...(await fromBuffer(await (await d.make(buf)).png().toBuffer())) });
  }
  rows.push({ name: d.name, count: queries.length, res: evaluate(queries) });
  console.log(`${d.name} : ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
const altQueries = [];
const indexed = new Set(index.map((c) => c.id));
for (const [id, f] of altFile) {
  if (!indexed.has(id)) continue;
  try { altQueries.push({ id, ...(await fromBuffer(await readFile(join(values.cache, f)))) }); } catch { /* illisible */ }
}
rows.push({ name: 'seconde image (autre source)', count: altQueries.length, res: evaluate(altQueries) });

const pct = (x) => `${(x * 100).toFixed(1)} %`;
const lines = [
  '# Reconnaissance sans numéro : variantes',
  '',
  `Index : ${index.length} cartes. Bonne carte en 1re position (entre parenthèses : parmi les 3 premières).`,
  '2d tri : les 20 meilleures départagées par une vignette 16×22 en couleur ; bas : avec la bande du bas (numéro, extension).',
  '',
  `| méthode | ${rows.map((r) => `${r.name} (${r.count})`).join(' | ')} |`,
  `|---|${rows.map(() => '---:').join('|')}|`,
  ...VARIANTS.map((v) => `| ${v} | ${rows.map((r) => `${pct(r.res[v].top1)} (${pct(r.res[v].top3)})`).join(' | ')} |`),
  '',
];
await writeFile(join(values.out, 'experiment.md'), lines.join('\n'));
console.log(lines.join('\n'));
