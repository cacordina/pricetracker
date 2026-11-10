import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'https://api.tcgdex.net/v2/ja';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Client TCGdex « poli » : délai entre requêtes, reprises avec attente doublée,
 * cache disque facultatif pour les fiches de cartes.
 */
export function createClient({ fetchImpl = fetch, delayMs = 150, retries = 3, cacheDir = null } = {}) {
  let last = 0;
  async function get(path) {
    let wait = 1000;
    for (let attempt = 0; ; attempt++) {
      const pause = last + delayMs - Date.now();
      if (pause > 0) await sleep(pause);
      last = Date.now();
      try {
        const res = await fetchImpl(`${BASE}${path}`, { headers: { 'user-agent': 'jp-card-price-tracker' } });
        if (res.status === 404) return null;
        if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} (définitif)`, { cause: 'fatal' });
        return await res.json();
      } catch (err) {
        if (err.cause === 'fatal' || attempt >= retries) throw err;
        await sleep(wait);
        wait *= 2;
      }
    }
  }
  return {
    listSets: () => get('/sets'),
    getSet: (id) => get(`/sets/${encodeURIComponent(id)}`),
    async getCard(id) {
      const file = cacheDir && join(cacheDir, `${id.replace(/[^\w.-]/g, '_')}.json`);
      if (file) {
        try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* pas en cache */ }
      }
      const card = await get(`/cards/${encodeURIComponent(id)}`);
      if (file && card) {
        await mkdir(cacheDir, { recursive: true });
        await writeFile(file, JSON.stringify(card));
      }
      return card;
    },
  };
}
