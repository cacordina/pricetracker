// « Ajouter des cartes » : ouvre la page de la dernière extension utilisée (sinon la plus récente) en mode ajout.
// L'ajout se fait désormais sur la page d'une extension (mode « Ajouter à ma collection »).
import { loadPrefs, savePrefs } from '../lib/ui.js';

export async function render(root, { catalog }) {
  const used = new Set(catalog.cards.map((c) => c.s));
  const newest = Object.entries(catalog.sets).filter(([id]) => used.has(id))
    .sort(([a, x], [b, y]) => (y.date ?? '').localeCompare(x.date ?? '') || a.localeCompare(b))[0]?.[0];
  const last = loadPrefs('quickadd', {}).set;
  const setId = used.has(last) ? last : newest;
  savePrefs('set', { ...loadPrefs('set', {}), mode: 'add' });
  root.innerHTML = '<p class="state">Ouverture…</p>';
  location.replace(`#/extension/${encodeURIComponent(setId)}`); // remplace l'entrée : « précédent » ne revient pas ici
}
