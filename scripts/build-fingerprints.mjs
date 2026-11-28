#!/usr/bin/env node
// Empreintes d'image de toutes les cartes du catalogue, pour le scanner :
//   npm install --no-save sharp && node scripts/build-fingerprints.mjs --data data --cache .images --out out
// Télécharge les images des cartes (TCGdex et TCGplayer, petites tailles ; gardées dans --cache d'une fois sur
// l'autre), calcule leur empreinte avec le code du site (site/lib/fingerprint.js) et écrit :
//   out/fingerprints.bin      index : 18 octets par carte (voir encodeIndex), image TCGdex en priorité
//   out/fingerprints-alt.bin  index des images de l'autre source, pour les cartes qui en ont deux (mesure)
//   out/fingerprints.json     bilan : cartes sans image, échecs de téléchargement
// sharp (décodage des images) n'est installé que sur GitHub : le site n'en dépend pas.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { imageUrls } from '../site/lib/links.js';
import { colorHash, encodeIndex } from '../site/lib/fingerprint.js';

const HEADERS = { 'user-agent': 'jp-card-price-tracker' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (file) => access(file).then(() => true, () => false);

/** Pixels RGBA d'une image (fichier ou contenu), avec sharp. */
export async function decode(sharp, input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

/** Image en cache, sinon téléchargée (3 essais). null si introuvable. */
async function fetchImage(url, file, fetchImpl) {
  if (await exists(file)) return readFile(file);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: HEADERS });
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(file, buf);
      return buf;
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(1000 * attempt);
    }
  }
}

/** Exécute `fn` sur chaque élément, `n` à la fois. */
async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

export async function buildFingerprints({ catalog, cacheDir, sharp, fetchImpl = fetch, concurrency = 16, log = () => {} }) {
  await mkdir(cacheDir, { recursive: true });
  const main = [];
  const alt = [];
  const report = { cards: catalog.cards.length, indexed: 0, withAlt: 0, noImage: 0, failed: [] };
  let done = 0;
  await pool(catalog.cards, concurrency, async (card) => {
    const urls = imageUrls(card, catalog.sets, 'low');
    if (!urls.length) { report.noImage++; return; }
    const hashes = [];
    for (const [k, url] of urls.entries()) {
      try {
        const buf = await fetchImage(url, join(cacheDir, `${card.id}-${k}${url.endsWith('.webp') ? '.webp' : '.jpg'}`), fetchImpl);
        if (!buf) continue;
        const { rgba, width, height } = await decode(sharp, buf);
        hashes.push(colorHash(rgba, width, height));
      } catch (err) {
        report.failed.push({ id: card.id, url, error: String(err.message ?? err) });
      }
    }
    if (hashes[0]) { main.push({ id: card.id, hash: hashes[0] }); report.indexed++; }
    if (hashes[1]) { alt.push({ id: card.id, hash: hashes[1] }); report.withAlt++; }
    if (++done % 1000 === 0) log(`${done}/${catalog.cards.length}`);
  });
  // Ordre stable d'une fois sur l'autre (le téléchargement en parallèle mélange l'ordre).
  const byId = (a, b) => a.id - b.id;
  return { index: encodeIndex(main.sort(byId)), alt: encodeIndex(alt.sort(byId)), report };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' }, cache: { type: 'string', default: '.images' }, out: { type: 'string', default: 'out' } } });
  const sharp = (await import('sharp')).default;
  const catalog = JSON.parse(await readFile(join(values.data, 'catalog.json'), 'utf8'));
  const { index, alt, report } = await buildFingerprints({ catalog, cacheDir: values.cache, sharp, log: console.log });
  await mkdir(values.out, { recursive: true });
  await writeFile(join(values.out, 'fingerprints.bin'), index);
  await writeFile(join(values.out, 'fingerprints-alt.bin'), alt);
  await writeFile(join(values.out, 'fingerprints.json'), JSON.stringify({ ...report, failed: report.failed.slice(0, 200), failedCount: report.failed.length }, null, 1));
  console.log(`${report.indexed} cartes indexées (${(index.length / 1024).toFixed(0)} Ko), ${report.withAlt} avec une seconde image, ${report.noImage} sans image, ${report.failed.length} échecs`);
}
