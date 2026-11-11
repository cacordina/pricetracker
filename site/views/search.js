// Recherche d'une carte par nom (japonais ou anglais), extension ou numéro, filtrée par rareté.
import { searchCards, COL, priceOf } from '../lib/metrics.js';
import { cardRow, chips, onChip, esc, loadPrefs, savePrefs } from '../lib/ui.js';

const RARITY_CHIPS = [{ value: 'AR', label: 'AR' }, { value: 'SAR', label: 'SAR' }, { value: 'secret', label: 'Secrètes' }, { value: 'promo', label: 'Promos' }, { value: 'all', label: 'Tout' }];

let lastQuery = '';

export async function render(root, { catalog, snapshot }) {
  root.innerHTML = `
    <h1>Recherche</h1>
    <input type="search" id="q" placeholder="Nom, extension, numéro — ex. « sv8a 212 »" value="${esc(lastQuery)}" autocomplete="off" enterkeyhint="search" aria-label="Rechercher une carte">
    <div id="filters"></div>
    <a class="link" href="#/extensions" style="display:inline-block;margin-top:6px">Parcourir les extensions ›</a>
    <div id="results"></div>`;
  const input = root.querySelector('#q');
  const filters = root.querySelector('#filters');
  const results = root.querySelector('#results');
  const prefs = loadPrefs('search', { rarities: null }); // null = toutes les raretés

  function draw() {
    lastQuery = input.value;
    filters.innerHTML = chips('rarity', RARITY_CHIPS, prefs.rarities ?? 'all');
    if (!input.value.trim()) {
      const count = prefs.rarities ? catalog.cards.filter((c) => prefs.rarities.includes(c.r)).length : catalog.cards.length;
      results.innerHTML = `<p class="state">${count.toLocaleString('fr-FR')} cartes japonaises${prefs.rarities ? ` ${prefs.rarities.map((r) => RARITY_CHIPS.find((c) => c.value === r).label).join(', ')}` : ''} dans ${Object.keys(catalog.sets).length} extensions.<br><span class="muted">Tapez un nom, une extension ou un numéro.</span></p>`;
      return;
    }
    const found = searchCards(catalog, input.value, 60, { rarities: prefs.rarities });
    results.innerHTML = found.length
      ? found.map((card) => {
        const row = snapshot.cards[card.id];
        return cardRow(card, catalog.sets, { trend: priceOf(row), change: row?.[COL.d7] ?? null });
      }).join('') + (found.length === 60 ? '<p class="muted" style="text-align:center;margin-top:12px">60 premiers résultats : précisez la recherche.</p>' : '')
      : `<p class="state">Aucune carte trouvée${prefs.rarities ? ' avec ce filtre de rareté' : ''}.</p>`;
  }
  input.addEventListener('input', draw);
  onChip(root, (group, value) => {
    if (group !== 'rarity') return;
    if (value === 'all') prefs.rarities = null;
    else {
      const current = new Set(prefs.rarities ?? []);
      current.has(value) ? current.delete(value) : current.add(value);
      prefs.rarities = current.size ? RARITY_CHIPS.map((c) => c.value).filter((v) => current.has(v)) : null;
    }
    savePrefs('search', prefs);
    draw();
  });
  draw();
}

export function mounted(root) {
  if (!lastQuery) root.querySelector('#q')?.focus();
}
