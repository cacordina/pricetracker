// Recherche d'une carte par nom (japonais ou anglais), extension ou numéro.
import { searchCards, COL } from '../lib/metrics.js';
import { cardRow, esc } from '../lib/ui.js';

let lastQuery = '';

export async function render(root, { catalog, snapshot }) {
  root.innerHTML = `
    <h1>Recherche</h1>
    <input type="search" id="q" placeholder="Nom, extension, numéro — ex. « sv8a 212 »" value="${esc(lastQuery)}" autocomplete="off" enterkeyhint="search" aria-label="Rechercher une carte">
    <div id="results"></div>`;
  const input = root.querySelector('#q');
  const results = root.querySelector('#results');

  function draw() {
    lastQuery = input.value;
    if (!input.value.trim()) {
      results.innerHTML = `<p class="state">${catalog.cards.length.toLocaleString('fr-FR')} cartes japonaises dans ${Object.keys(catalog.sets).length} extensions.</p>`;
      return;
    }
    const found = searchCards(catalog, input.value, 60);
    results.innerHTML = found.length
      ? found.map((card) => {
        const row = snapshot.cards[card.id];
        return cardRow(card, catalog.sets, { trend: row?.[COL.trend] ?? null, change: row?.[COL.d7] ?? null });
      }).join('') + (found.length === 60 ? '<p class="muted" style="text-align:center;margin-top:12px">60 premiers résultats : précisez la recherche.</p>' : '')
      : '<p class="state">Aucune carte trouvée.</p>';
  }
  input.addEventListener('input', draw);
  draw();
}

export function mounted(root) {
  if (!lastQuery) root.querySelector('#q')?.focus();
}
