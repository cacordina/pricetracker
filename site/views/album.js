// Toutes les AR (et/ou SAR) du catalogue, possédées ou non, par extension ou par prix : la même vue que la page
// d'une extension, appliquée à toutes les extensions (mêmes filtres, même mode ajout).
import { priceOf } from '../lib/model.js';
import { album, albumByPrice } from '../lib/sets.js';
import { chips, onChip, esc, loadPrefs, savePrefs } from '../lib/ui.js';
import { filterPanel, trackPanel, cardTile, wireAdding, MODES } from '../lib/cardgrid.js';

const RARITIES = [{ value: 'AR', label: 'AR' }, { value: 'SAR', label: 'SAR' }];
const SHOW = [{ value: 'all', label: 'Possédées ou non', quiet: true }, { value: 'missing', label: 'Manquantes' }, { value: 'owned', label: 'Possédées' }];
const SORT = [{ value: 'set', label: 'Par extension', quiet: true }, { value: 'desc', label: 'Prix ↓' }, { value: 'asc', label: 'Prix ↑' }];
const PAGE = 60;

// Gardés tant que l'app est ouverte : extensions dépliées et nombre de cartes affichées en tri par prix,
// pour retrouver l'écran tel qu'on l'a laissé en revenant d'une fiche.
const openSets = new Set();
let shownByPrice = PAGE;

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
  if (param) openSets.add(param);
  root.addEventListener('toggle', (event) => {
    const group = event.target.closest?.('details.setgroup');
    if (group) group.open ? openSets.add(group.dataset.set) : openSets.delete(group.dataset.set);
  }, true);
  root.addEventListener('click', (event) => {
    if (event.target.closest('#more')) { shownByPrice += PAGE; draw(); }
    if (event.target.closest('#toggle-all')) {
      const groups = [...root.querySelectorAll('details.setgroup')];
      const open = !openSets.size;
      openSets.clear();
      for (const g of groups) { g.open = open; if (open) openSets.add(g.dataset.set); }
      root.querySelector('#toggle-all').textContent = open ? 'Tout replier' : 'Tout déplier';
    }
  });

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
      <h1>Toutes les ${esc(prefs.rarities.join(' + '))}</h1>
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
    // Une extension par bloc repliable : la liste dépliée entière ferait plus de 40 écrans de haut.
    return `<p style="text-align:right;margin:8px 0 0"><button type="button" class="link" id="toggle-all">${openSets.size ? 'Tout replier' : 'Tout déplier'}</button></p>`
      + groups.map((group) => `<details class="setgroup" id="set-${esc(group.set)}" data-set="${esc(group.set)}"${openSets.has(group.set) ? ' open' : ''}>
      <summary><span class="one"><b>${esc(group.set)}</b> <span class="muted">${esc(catalog.sets[group.set]?.en ?? group.name)}</span></span>
        <span class="muted">${connected ? `${group.owned}/${group.total}${group.owned === group.total ? ' ✓' : ''}` : group.total}</span></summary>
      <div class="grid">${group.cards.map(({ card, qty }) => tile({ card, qty, price: priceOf(snapshot.cards[card.id]) })).join('')}</div>
      <a class="link" href="#/extension/${encodeURIComponent(group.set)}" style="display:inline-block;margin:8px 0 4px">Toute l’extension ${esc(group.set)} ›</a>
    </details>`).join('');
  }

  function byPrice(holdings) {
    const list = albumByPrice(catalog, holdings, snapshot, { rarities: prefs.rarities, show: prefs.show, dir: sort });
    if (!list.length) return '<p class="state">Aucune carte avec ces filtres.</p>';
    const rest = list.length - shownByPrice;
    return `<div class="grid" style="margin-top:12px">${list.slice(0, shownByPrice).map(({ card, qty, trend }) => tile({ card, qty, price: trend }, true)).join('')}</div>
      ${rest > 0 ? `<button type="button" class="btn sec" id="more">Afficher ${Math.min(PAGE, rest)} de plus <span class="muted">(${rest} restantes)</span></button>` : ''}`;
  }

  onChip(root, (group, value) => {
    if (group === 'rarities') {
      const next = prefs.rarities.includes(value) ? prefs.rarities.filter((r) => r !== value) : [...prefs.rarities, value];
      if (next.length) prefs.rarities = ['AR', 'SAR'].filter((r) => next.includes(r)); // au moins une rareté
    } else if (group === 'show' || group === 'mode') {
      prefs[group] = value;
    } else if (group === 'sort') {
      sort = prefs.sort = value;
      shownByPrice = PAGE;
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
