import { readFile } from 'node:fs/promises';
const fx = (name) => new URL(`./fixtures/${name}`, import.meta.url);
export const readJson = async (name) => JSON.parse(await readFile(fx(name), 'utf8'));

/** Client TCGdex simulé, servi par les fixtures ; `calls` trace les appels. */
export async function fakeClient() {
  const set = await readJson('tcgdex-set-SV8a.json');
  const cards = {};
  for (const n of ['001', '190', '212']) cards[`SV8a-${n}`] = await readJson(`tcgdex-card-SV8a-${n}.json`);
  const calls = [];
  return {
    calls,
    async listSets() { calls.push('sets'); return [{ id: 'SV8a', name: set.name, cardCount: { total: 3, official: 187 } }]; },
    async getSet(id) { calls.push(`set:${id}`); return set; },
    async getCard(id) { calls.push(`card:${id}`); return cards[id]; },
  };
}
