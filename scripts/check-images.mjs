#!/usr/bin/env node
// Diagnostic des images d'une extension : node scripts/check-images.mjs --data data --set m7
// Pour chaque carte : réponse des serveurs d'images (TCGdex, TCGplayer), taille, et images identiques entre cartes
// (une même image pour plusieurs cartes = image provisoire « bientôt disponible »).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { imageUrls } from '../site/lib/links.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' }, set: { type: 'string' } } });
const catalog = JSON.parse(await readFile(join(values.data, 'catalog.json'), 'utf8'));
const cards = catalog.cards.filter((c) => c.s === values.set);
const rows = [];
for (const card of cards) {
  for (const url of imageUrls(card, catalog.sets, 'low')) {
    const res = await fetch(url, { headers: { 'user-agent': 'jp-card-price-tracker' } }).catch((err) => ({ status: String(err.message) }));
    const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    rows.push({ n: card.n, url, status: res.status, bytes: buf?.length ?? 0, hash: buf ? createHash('sha1').update(buf).digest('hex').slice(0, 10) : '' });
  }
}
const same = new Map();
for (const r of rows) if (r.hash) same.set(r.hash, (same.get(r.hash) ?? 0) + 1);
const lines = [`## Images de ${values.set} (${cards.length} cartes)`, '', '| n° | réponse | octets | image | url |', '|---|---|---:|---|---|'];
for (const r of rows) lines.push(`| ${r.n} | ${r.status} | ${r.bytes} | ${r.hash}${same.get(r.hash) > 1 ? ` (×${same.get(r.hash)})` : ''} | ${r.url} |`);
const ok = rows.filter((r) => r.hash && same.get(r.hash) === 1).length;
lines.unshift(`${ok}/${rows.length} images propres, ${rows.filter((r) => !r.hash).length} absentes, ${rows.filter((r) => r.hash && same.get(r.hash) > 1).length} provisoires (identiques entre cartes)`, '');
console.log(lines.join('\n'));
