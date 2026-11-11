#!/usr/bin/env node
// Prix de marché TCGplayer (États-Unis) : node scripts/ingest-us.mjs --data data
// Complément des prix Cardmarket : fichiers à part (data/us/), une panne ici ne touche pas aux prix Cardmarket.
// Rejouable : un même jour est simplement réécrit.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { historyFile } from './ingest.mjs';
import { matchGroups } from './lib/tcgcsv.mjs';
import { marketPrices, parseEcbRate, pricesByCard, putDay, checkUsDay } from './lib/tcgplayer.mjs';

const TCGCSV = 'https://tcgcsv.com';
const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const HEADERS = { 'user-agent': 'jp-card-price-tracker' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readJson = async (file) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
const writeAtomic = async (file, value) => {
  await writeFile(`${file}.tmp`, JSON.stringify(value));
  await rename(`${file}.tmp`, file);
};

/** Télécharge tout ce qu'il faut, puis écrit. Rien n'est écrit si une vérification échoue. */
export async function ingestUs({ dataDir, catalog, fetchImpl = fetch, delayMs = 150, today = new Date().toISOString().slice(0, 10), log = () => {} }) {
  const get = async (url, as = 'json') => {
    const res = await fetchImpl(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
    return as === 'json' ? res.json() : res.text();
  };

  // Date des prix : dernière mise à jour de tcgcsv (une fois par jour), sinon aujourd'hui.
  const stamp = await get(`${TCGCSV}/last-updated.txt`, 'text').catch(() => '');
  const date = /^\d{4}-\d{2}-\d{2}/.exec(stamp.trim())?.[0] ?? today;

  const setIds = [...new Set(catalog.cards.filter((c) => c.g).map((c) => c.s))];
  const groups = matchGroups((await get(`${TCGCSV}/tcgplayer/85/groups`)).results ?? [], setIds);
  const byProduct = new Map();
  let failed = 0;
  for (const [setId, groupId] of groups) {
    try {
      for (const [id, cents] of marketPrices((await get(`${TCGCSV}/tcgplayer/85/${groupId}/prices`)).results ?? [])) byProduct.set(id, cents);
    } catch (err) {
      failed += 1;
      log(`${setId} : ${err.message}`);
    }
    await sleep(delayMs);
  }
  const prices = pricesByCard(catalog, byProduct);

  const previous = await readJson(join(dataDir, 'us', 'snapshot.json'));
  const problem = checkUsDay({ date, lastDate: previous?.date ?? null, count: prices.size, lastCount: previous ? Object.keys(previous.cards).length : null });
  if (problem) throw new Error(problem);

  // Taux BCE ; s'il manque, on garde le précédent (sa date le dit), sinon les prix restent en dollars seulement.
  let fx = null;
  try {
    fx = parseEcbRate(await get(ECB_URL, 'text'));
  } catch (err) {
    log(`Taux BCE indisponible (${err.message})${previous?.rate ? `, taux du ${previous.rateDate} conservé` : ''}`);
    if (previous?.rate) fx = { rate: previous.rate, date: previous.rateDate };
  }

  const bySet = Map.groupBy(catalog.cards.filter((c) => c.g), (c) => c.s);
  const histories = {};
  for (const [setId, cards] of bySet) {
    const current = await readJson(join(dataDir, 'us', 'history', historyFile(setId)));
    const next = putDay(current, date, fx?.rate ?? null, prices, cards.map((c) => c.id));
    if (Object.keys(next.cards).length) histories[setId] = next;
  }

  await mkdir(join(dataDir, 'us', 'history'), { recursive: true });
  for (const [setId, history] of Object.entries(histories)) {
    await writeAtomic(join(dataDir, 'us', 'history', historyFile(setId)), history);
  }
  await writeAtomic(join(dataDir, 'us', 'snapshot.json'), {
    date, rate: fx?.rate ?? null, rateDate: fx?.date ?? null, cards: Object.fromEntries(prices),
  });
  return { date, priced: prices.size, groups: groups.size, failed, rate: fx?.rate ?? null };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' } } });
  try {
    const catalog = await readJson(join(values.data, 'catalog.json'));
    if (!catalog) throw new Error(`Catalogue introuvable dans ${values.data}/catalog.json`);
    const r = await ingestUs({ dataDir: values.data, catalog, log: (m) => console.log(m) });
    console.log(`TCGplayer ${r.date} : ${r.priced} cartes cotées (${r.groups} extensions, ${r.failed} en erreur), 1 $ = ${r.rate ?? '?'} €`);
  } catch (err) {
    console.error(`ÉCHEC : ${err.message}`);
    process.exit(1);
  }
}
