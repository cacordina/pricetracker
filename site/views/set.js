// Une extension : toutes ses cartes avec leur prix. Deux modes : Parcourir (toucher ouvre la fiche)
// et Ajouter à ma collection (toucher ajoute un exemplaire). Remplace l'ancien écran « Ajouter par série ».
import { setsOverview, setCards, seriesOf, SERIES, formatEuro } from '../lib/metrics.js';
import { chips, onChip, esc, loadPrefs, savePrefs } from '../lib/ui.js';
import { filterPanel, trackPanel, cardTile, wireAdding, MODES } from '../lib/cardgrid.js';
import { frDate } from '../lib/chart.js';

const RARITY = [{ value: 'all', label: 'Toutes', quiet: true }, { value: 'AR', label: 'AR' }, { value: 'SAR', label: 'SAR' }, { value: 'secret', label: 'Secrètes' }, { value: 'promo', label: 'Promos' }];
const SHOW = [{ value: 'all', label: 'Possédées ou non', quiet: true }, { value: 'missing', label: 'Manquantes' }, { value: 'owned', label: 'Possédées' }];
const SORT = [{ value: 'num', label: 'Par numéro', quiet: true }, { value: 'desc', label: 'Prix ↓' }, { value: 'asc', label: 'Prix ↑' }];

/** Liste déroulante de toutes les extensions, rangées par grande série, pour changer d'extension sans revenir à la liste. */
export function setPicker(catalog, current) {
  const used = new Set(catalog.cards.map((c) => c.s));
  const sets = Object.entries(catalog.sets).filter(([id]) => used.has(id))
    .sort(([a, x], [b, y]) => (y.date ?? '').localeCompare(x.date ?? '') || a.localeCompare(b));
  const groups = Map.groupBy(sets, ([id, s]) => seriesOf(id, s.date));
  return `<select class="setpick" id="setpick" aria-label="Changer d'extension">
    ${SERIES.filter((x) => groups.has(x)).map((x) => `<optgroup label="${esc(x.name)}">
      ${groups.get(x).map(([id, s]) => `<option value="${esc(id)}"${id === current ? ' selected' : ''}>${esc(id)} — ${esc(s.en ?? s.name)}</option>`).join('')}
    </optgroup>`).join('')}
  </select>`;
}

export async function render(root, { catalog, snapshot, store, param }) {
  const setId = param;
  const set = catalog.sets[setId];
  if (!set) {
    root.innerHTML = `<p class="state">Extension inconnue (${esc(setId)}).</p><a class="btn sec" href="#/extensions">Toutes les extensions</a>`;
    return;
  }
  let owned = new Map();
  let connected = true;
  try { owned = new Map((await store.listHoldings()).map((h) => [h.id_product, h.qty])); } catch { connected = false; }

  // Les raretés proposées sont celles qui existent dans cette extension.
  const present = new Set(catalog.cards.filter((c) => c.s === setId).map((c) => c.r));
  const rarityOptions = RARITY.filter((r) => r.value === 'all' || present.has(r.value));
  const prefs = loadPrefs('set', { rarity: 'all', show: 'all', sort: 'num', mode: 'browse' });
  if (!rarityOptions.some((r) => r.value === prefs.rarity)) prefs.rarity = 'all';
  if (!connected) { prefs.show = 'all'; prefs.mode = 'browse'; }
  const panel = { open: false };
  trackPanel(root, panel);

  function draw(message = '') {
    const holdings = [...owned].map(([id, qty]) => ({ id_product: id, qty }));
    const info = setsOverview({ ...catalog, cards: catalog.cards.filter((c) => c.s === setId) }, snapshot, holdings)[0];
    const items = setCards(catalog, snapshot, holdings, setId, {
      rarities: prefs.rarity === 'all' ? null : [prefs.rarity], show: prefs.show, sort: prefs.sort,
    });
    const filters = [
      ...(rarityOptions.length > 2 ? [{ key: 'rarity', label: 'Rareté', options: rarityOptions, value: prefs.rarity }] : []),
      ...(connected ? [{ key: 'show', label: 'Afficher', options: SHOW, value: prefs.show }] : []),
      { key: 'sort', label: 'Trier', options: SORT, value: prefs.sort },
    ];
    root.innerHTML = `
      <div class="toolbar"><h1>${esc(setId)}</h1><a class="link" href="#/extensions">Toutes les extensions</a></div>
      ${set.en ? `<div><b>${esc(set.en)}</b></div>` : ''}
      <div class="muted">${esc(set.name)}</div>
      <div class="muted">${esc(seriesOf(setId, set.date).name)}${set.date ? ` · sortie le ${esc(frDate(set.date))}` : ''}</div>
      <div style="margin-top:6px">${info.total} cartes · complète <b>${formatEuro(info.valueCents || null)}</b>${connected ? ` · possédées <b>${info.owned}/${info.total}</b>` : ''}</div>
      ${setPicker(catalog, setId)}
      ${connected ? `<div class="modes">${chips('mode', MODES, prefs.mode)}</div>` : ''}
      ${prefs.mode === 'add' ? '<div class="muted">Touchez une carte pour l’ajouter ; − et + règlent la quantité. Enregistrement immédiat.</div>' : ''}
      ${filterPanel(filters, { open: panel.open })}
      ${message ? `<p class="error">${esc(message)}</p>` : ''}
      ${items.length
        ? `<div class="grid" style="margin-top:12px">${items.map((item) => cardTile(item, { sets: catalog.sets, mode: prefs.mode, connected })).join('')}</div>`
        : '<p class="state">Aucune carte avec ces filtres.</p>'}
      <p class="muted" style="margin-top:10px">Valeur de l’extension complète : un exemplaire de chaque carte cotée, au prix suivi (moyenne des ventes 7 j).</p>`;
    root.querySelector('#setpick').onchange = (event) => { location.hash = `#/extension/${encodeURIComponent(event.target.value)}`; };
  }

  onChip(root, (group, value) => {
    if (!(group in prefs)) return;
    prefs[group] = value;
    savePrefs('set', prefs);
    if (group === 'mode' && value === 'add') rememberForAdding(setId);
    draw();
  });
  if (connected) wireAdding(root, { owned, store, redraw: draw });
  if (prefs.mode === 'add') rememberForAdding(setId);
  draw();
}

/** « Ajouter des cartes » (collection, accueil) rouvre la dernière extension utilisée en mode ajout. */
function rememberForAdding(setId) {
  savePrefs('quickadd', { ...loadPrefs('quickadd', {}), set: setId });
}
