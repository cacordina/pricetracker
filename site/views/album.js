// Toutes les AR (et/ou SAR) du catalogue, possédées ou non, par extension ou par prix : la même vue que la page
// d'une extension, appliquée à toutes les extensions (mêmes filtres, même mode ajout).
import { album, albumByPrice, priceOf } from '../lib/metrics.js';
import { chips, onChip, esc, loadPrefs, savePrefs } from '../lib/ui.js';
import { filterPanel, trackPanel, cardTile, wireAdding, MODES } from '../lib/cardgrid.js';

const RARITIES = [{ value: 'AR', label: 'AR' }, { value: 'SAR', label: 'SAR' }];
const SHOW = [{ value: 'all', label: 'Possédées ou non', quiet: true }, { value: 'missing', label: 'Manquantes' }, { value: 'owned', label: 'Possédées' }];
const SORT = [{ value: 'set', label: 'Par extension', quiet: true }, { value: 'desc', label: 'Prix ↓' }, { value: 'asc', label: 'Prix ↑' }];

export async function render(root, { catalog, snapshot, store, param }) {
  // L'album reste consultable sans connexion : on n'affiche alors simplement pas ce qui est possédé.
  let owned = new Map();
  let connected = true;
  try { owned = new Map((await store.listHoldings()).map((h) => [h.id_product, h.qty])); } catch { connected = false; }
  const prefs = loadPrefs('album', { rarities: ['AR'], show: 'all', sort: 'set', mode: 'browse' });
  if (!connected) { prefs.show = 'all'; prefs.mode = 'browse'; }
  // Arrivée sur une extension précise (depuis la complétion) : il faut les extensions, quel que soit le tri choisi.
  let sort = param ? 'set' : prefs.sort;
  const panel = { open: false };
  trackPanel(root, panel);

  function draw(message = '') {
    const holdings = [...owned].map(([id, qty]) => ({ id_product: id, qty }));
    const full = album(catalog, holdings, { rarities: prefs.rarities, show: 'all' });
    const have = full.reduce((n, g) => n + g.owned, 0);
    const total = full.reduce((n, g) => n + g.total, 0);
    const filters = [
      { key: 'rarities', label: 'Rareté', options: RARITIES, value: prefs.rarities },
      ...(connected ? [{ key: 'show', label: 'Afficher', options: SHOW, value: prefs.show }] : []),
      { key: 'sort', label: 'Trier', options: SORT, value: sort },
    ];
    root.innerHTML = `
      <div class="toolbar"><h1>Toutes les ${esc(prefs.rarities.join(' + '))}</h1><a class="link" href="#/extensions">Extensions</a></div>
      <div class="muted">${total} cartes dans ${full.length} extensions${connected ? ` · ${have} possédées (${total ? Math.round((have / total) * 100) : 0} %)` : ' · connectez-vous pour voir celles que vous possédez'}</div>
      ${connected ? `<div class="modes">${chips('mode', MODES, prefs.mode)}</div>` : ''}
      ${prefs.mode === 'add' ? '<div class="muted">Touchez une carte pour l’ajouter ; − et + règlent la quantité. Enregistrement immédiat.</div>' : ''}
      ${filterPanel(filters, { open: panel.open })}
      ${message ? `<p class="error">${esc(message)}</p>` : ''}
      ${sort === 'set' ? bySet(holdings) : byPrice(holdings)}`;
  }

  const tile = (item, showSet = false) => cardTile(item, { sets: catalog.sets, mode: prefs.mode, connected, showSet });

  function bySet(holdings) {
    const groups = album(catalog, holdings, prefs);
    if (!groups.length) return '<p class="state">Aucune carte avec ces filtres.</p>';
    return groups.map((group) => `<section id="set-${esc(group.set)}">
      <h2 class="toolbar"><a href="#/extension/${encodeURIComponent(group.set)}">${esc(group.set)} <span class="muted">${esc(catalog.sets[group.set]?.en ?? group.name)}</span> <span class="muted">›</span></a>
        <span class="muted">${connected ? `${group.owned}/${group.total}${group.owned === group.total ? ' ✓' : ''}` : group.total}</span></h2>
      <div class="grid">${group.cards.map(({ card, qty }) => tile({ card, qty, price: priceOf(snapshot.cards[card.id]) })).join('')}</div>
    </section>`).join('');
  }

  function byPrice(holdings) {
    const list = albumByPrice(catalog, holdings, snapshot, { rarities: prefs.rarities, show: prefs.show, dir: sort });
    return list.length
      ? `<div class="grid" style="margin-top:12px">${list.map(({ card, qty, trend }) => tile({ card, qty, price: trend }, true)).join('')}</div>`
      : '<p class="state">Aucune carte avec ces filtres.</p>';
  }

  onChip(root, (group, value) => {
    if (group === 'rarities') {
      const next = prefs.rarities.includes(value) ? prefs.rarities.filter((r) => r !== value) : [...prefs.rarities, value];
      if (next.length) prefs.rarities = ['AR', 'SAR'].filter((r) => next.includes(r)); // au moins une rareté
    } else if (group === 'show' || group === 'mode') {
      prefs[group] = value;
    } else if (group === 'sort') {
      sort = prefs.sort = value;
      window.scrollTo(0, 0);
    } else return;
    savePrefs('album', prefs);
    draw();
  });
  if (connected) wireAdding(root, { owned, store, redraw: draw });
  root._target = param;
  draw();
}

export function mounted(root) {
  // Arrivée depuis la complétion d'une extension : on se place directement dessus.
  if (!root._target) return;
  const go = () => document.getElementById(`set-${root._target}`)?.scrollIntoView();
  go();
  setTimeout(go, 400); // une seconde fois, quand la mise en page s'est stabilisée
}
