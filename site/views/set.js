// Une extension : toutes ses cartes avec leur prix, possédées ou non, par numéro ou par prix.
import { setsOverview, setCards, seriesOf, formatEuro, displayName } from '../lib/metrics.js';
import { cardImg, chips, onChip, esc, loadPrefs, savePrefs } from '../lib/ui.js';
import { frDate } from '../lib/chart.js';

const RARITY = [{ value: 'all', label: 'Toutes' }, { value: 'AR', label: 'AR' }, { value: 'SAR', label: 'SAR' }, { value: 'secret', label: 'Secrètes' }, { value: 'promo', label: 'Promos' }];
const SHOW = [{ value: 'all', label: 'Toutes' }, { value: 'missing', label: 'Manquantes' }, { value: 'owned', label: 'Possédées' }];
const SORT = [{ value: 'num', label: 'Par numéro' }, { value: 'desc', label: 'Prix ↓' }, { value: 'asc', label: 'Prix ↑' }];

export async function render(root, { catalog, snapshot, store, param }) {
  const setId = param;
  if (!catalog.sets[setId]) {
    root.innerHTML = `<p class="state">Extension inconnue (${esc(setId)}).</p><a class="btn sec" href="#/extensions">Toutes les extensions</a>`;
    return;
  }
  let holdings = [];
  let connected = true;
  try { holdings = await store.listHoldings(); } catch { connected = false; }
  const info = setsOverview({ ...catalog, cards: catalog.cards.filter((c) => c.s === setId) }, snapshot, holdings)[0];
  const set = catalog.sets[setId];
  // Les raretés proposées sont celles qui existent dans cette extension.
  const present = new Set(catalog.cards.filter((c) => c.s === setId).map((c) => c.r));
  const rarityChips = RARITY.filter((r) => r.value === 'all' || present.has(r.value));
  const prefs = loadPrefs('set', { rarity: 'all', show: 'all', sort: 'num' });
  if (!rarityChips.some((r) => r.value === prefs.rarity)) prefs.rarity = 'all';
  if (!connected) prefs.show = 'all';

  function draw() {
    const items = setCards(catalog, snapshot, holdings, setId, {
      rarities: prefs.rarity === 'all' ? null : [prefs.rarity], show: prefs.show, sort: prefs.sort,
    });
    root.innerHTML = `
      <div class="toolbar"><h1>${esc(setId)}</h1><a class="link" href="#/extensions">Extensions</a></div>
      <div class="muted">${esc(set.name)}</div>
      <div class="muted">${esc(seriesOf(setId, set.date).name)}${set.date ? ` · sortie le ${esc(frDate(set.date))}` : ''}</div>
      <div class="kv">
        <span>Cartes</span><span>${info.total}${set.official ? ` · ${set.official} numérotées` : ''}</span>
        <span>Extension complète</span><span>${formatEuro(info.valueCents || null)}</span>
        ${connected ? `<span>Possédées</span><span>${info.owned}/${info.total} · ${info.total ? Math.round((info.owned / info.total) * 100) : 0} %</span>` : ''}
      </div>
      ${rarityChips.length > 2 ? chips('rarity', rarityChips, prefs.rarity) : ''}
      ${connected ? chips('show', SHOW, prefs.show) : ''}
      ${chips('sort', SORT, prefs.sort)}
      ${items.length ? `<div class="grid" style="margin-top:12px">${items.map(tile).join('')}</div>` : '<p class="state">Aucune carte avec ces filtres.</p>'}
      ${connected ? `<a class="btn sec" href="#/ajout" id="add">Ajouter des cartes de cette extension</a>` : ''}
      <p class="muted" style="margin-top:10px">Valeur de l’extension complète : un exemplaire de chaque carte cotée, au prix suivi (moyenne des ventes 7 j).</p>`;
    // L'écran d'ajout s'ouvre directement sur cette extension.
    root.querySelector('#add')?.addEventListener('click', () => savePrefs('quickadd', { ...loadPrefs('quickadd', {}), set: setId }));
  }

  function tile({ card, qty, price }) {
    return `<a class="tile${connected ? ` pick${qty ? ' owned' : ''}` : ''}" href="#/carte/${card.id}" title="${esc(displayName(card))}">
      ${cardImg(card, catalog.sets)}${qty > 1 ? `<span class="qty">×${qty}</span>` : ''}
      <div class="muted">${esc(card.n)} · ${formatEuro(price)}</div></a>`;
  }

  onChip(root, (group, value) => {
    if (!(group in prefs)) return;
    prefs[group] = value;
    savePrefs('set', prefs);
    draw();
  });
  draw();
}
