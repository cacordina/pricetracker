#!/usr/bin/env node
// Ingestion quotidienne : node scripts/ingest.mjs --data data [--prices fichier.json]
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { toCents } from './lib/money.mjs';
import { appendDay } from './lib/history.mjs';
import { checkDay } from './lib/guards.mjs';
import { buildSnapshot } from './lib/snapshot.mjs';

export const PRICES_URL = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';

/** Nom de fichier sûr pour l'historique d'une extension (même règle côté site). */
export const historyFile = (setId) =>
  `${String(setId).replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}.json`;

const readJson = async (file) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
const writeAtomic = async (file, value) => {
  await writeFile(`${file}.tmp`, JSON.stringify(value));
  await rename(`${file}.tmp`, file);
};

/** Ajoute le jour du fichier de prix à l'historique. Rejouable : un jour déjà enregistré est sauté. */
export async function ingest({ dataDir, priceGuide, catalog }) {
  if (typeof priceGuide?.createdAt !== 'string') throw new Error('Fichier de prix invalide : createdAt absent');
  if (!Array.isArray(priceGuide.priceGuides)) throw new Error('Fichier de prix invalide : priceGuides absent');
  if (!catalog?.cards?.length) throw new Error('Catalogue japonais vide ou absent');
  const date = priceGuide.createdAt.slice(0, 10);

  // Filtre japonais : seules les cartes du catalogue sont retenues.
  const wanted = new Set(catalog.cards.map((c) => c.id));
  const prices = new Map();
  for (const row of priceGuide.priceGuides) {
    if (!wanted.has(row.idProduct)) continue;
    prices.set(row.idProduct, {
      t: toCents(row.trend), l: toCents(row.low), a: toCents(row.avg1),
      a7: toCents(row.avg7), a30: toCents(row.avg30),
    });
  }
  const pricedCount = [...prices.values()].filter((p) => p.t !== null).length;

  const previous = await readJson(join(dataDir, 'snapshot.json'));
  const lastPricedCount = previous ? Object.values(previous.cards).filter((row) => row[0] !== null).length : null;
  const verdict = checkDay({ date, lastDate: previous?.date ?? null, pricedCount, lastPricedCount });
  if (!verdict.ok) {
    if (verdict.skip) return { status: 'skipped', date };
    throw new Error(verdict.reason);
  }

  // Tout est calculé en mémoire avant la première écriture.
  const bySet = Map.groupBy(catalog.cards, (c) => c.s);
  const histories = {};
  for (const [setId, cards] of bySet) {
    const current = await readJson(join(dataDir, 'history', historyFile(setId)));
    histories[setId] = appendDay(current, date, prices, cards.map((c) => c.id));
  }
  const snapshot = buildSnapshot({ date, prices, histories, catalog });

  await mkdir(join(dataDir, 'history'), { recursive: true });
  for (const [setId, history] of Object.entries(histories)) {
    if (Object.keys(history.cards).length === 0) continue; // extension jamais cotée
    await writeAtomic(join(dataDir, 'history', historyFile(setId)), history);
  }
  await writeAtomic(join(dataDir, 'snapshot.json'), snapshot); // en dernier : marque le jour comme terminé
  return { status: 'written', date };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' }, prices: { type: 'string' } } });
  try {
    const catalog = await readJson(join(values.data, 'catalog.json'));
    if (!catalog) throw new Error(`Catalogue introuvable dans ${values.data}/catalog.json`);
    let priceGuide;
    if (values.prices) {
      priceGuide = JSON.parse(await readFile(values.prices, 'utf8'));
    } else {
      const res = await fetch(PRICES_URL);
      if (!res.ok) throw new Error(`Téléchargement des prix : HTTP ${res.status}`);
      priceGuide = await res.json();
    }
    const result = await ingest({ dataDir: values.data, priceGuide, catalog });
    console.log(`${result.status} ${result.date}`);
  } catch (err) {
    console.error(`ÉCHEC : ${err.message}`);
    process.exit(1);
  }
}
