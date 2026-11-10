// Album : toutes les cartes AR (et/ou SAR) du catalogue, par extension, possédées ou non.
import { COL, album, formatEuro, displayName } from '../lib/metrics.js';
import { cardImg, chips, onChip, esc, loadPrefs, savePrefs } from '../lib/ui.js';

const SHOW = [{ value: 'all', label: 'Toutes' }, { value: 'missing', label: 'Manquantes' }, { value: 'owned', label: 'Possédées' }];

export async function render(root, { catalog, snapshot, store, param }) {
  // L'album reste consultable sans connexion : on n'affiche alors simplement pas ce qui est possédé.
  let holdings = [];
  let connected = true;
  try {
    holdings = await store.listHoldings();
  } catch {
    connected = false;
  }
  const prefs = loadPrefs('album', { rarities: ['AR'], show: 'all' });
  if (!connected) prefs.show = 'all';

  function draw() {
    const groups = album(catalog, holdings, prefs);
    const full = album(catalog, holdings, { rarities: prefs.rarities, show: 'all' });
    const owned = full.reduce((n, g) => n + g.owned, 0);
    const total = full.reduce((n, g) => n + g.total, 0);
    const label = prefs.rarities.join(' + ');
    root.innerHTML = `
      <div class="toolbar"><h1>Toutes les ${esc(label)}</h1><a class="link" href="#/collection">← Collection</a></div>
      <div class="muted">${total} cartes dans ${full.length} extensions${connected ? ` · ${owned} possédées (${total ? Math.round((owned / total) * 100) : 0} %)` : ' · connectez-vous pour voir celles que vous possédez'}</div>
      <div class="chips" data-group="rarities">
        ${['AR', 'SAR'].map((r) => `<button type="button" class="chip${prefs.rarities.includes(r) ? ' on' : ''}" data-value="${r}">${r}</button>`).join('')}
      </div>
      ${connected ? chips('show', SHOW, prefs.show) : ''}
      ${groups.length ? groups.map(section).join('') : '<p class="state">Aucune carte avec ces filtres.</p>'}`;
  }

  function section(group) {
    return `<section id="set-${esc(group.set)}">
      <h2 class="toolbar"><span>${esc(group.set)} <span class="muted">${esc(group.name)}</span></span>
        <span class="muted">${connected ? `${group.owned}/${group.total}${group.owned === group.total ? ' ✓' : ''}` : group.total}</span></h2>
      <div class="grid">${group.cards.map(tile).join('')}</div>
    </section>`;
  }

  function tile({ card, qty }) {
    const trend = snapshot.cards[card.id]?.[COL.trend] ?? null;
    return `<a class="tile${connected ? ` pick${qty ? ' owned' : ''}` : ''}" href="#/carte/${card.id}" title="${esc(displayName(card))}">
      ${cardImg(card, catalog.sets)}${qty > 1 ? `<span class="qty">×${qty}</span>` : ''}
      <div class="muted">${esc(card.n)} · ${formatEuro(trend)}</div></a>`;
  }

  onChip(root, (group, value) => {
    if (group === 'rarities') {
      const next = prefs.rarities.includes(value) ? prefs.rarities.filter((r) => r !== value) : [...prefs.rarities, value];
      if (next.length) prefs.rarities = ['AR', 'SAR'].filter((r) => next.includes(r)); // au moins une rareté
    } else if (group === 'show') {
      prefs.show = value;
    }
    savePrefs('album', prefs);
    draw();
  });
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
