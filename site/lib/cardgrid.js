// Briques communes aux écrans de cartes (extension, toutes les AR/SAR, marché) :
// filtres regroupés derrière un bouton, interrupteur Parcourir / Ajouter, vignettes et ajout en un geste.
import { formatEuro, displayName } from './metrics.js';
import { cardImg, chips, esc } from './ui.js';

/**
 * Filtres repliés derrière un bouton qui résume les choix en cours.
 * groups : [{ key, label, options: [{ value, label, quiet? }], value (ou tableau de valeurs) }]
 *          ou [{ label, html, summary }] pour un champ libre ; une option `quiet` (valeur par défaut) n'apparaît pas dans le résumé.
 * open : le panneau reste ouvert d'un affichage à l'autre tant que l'utilisateur ne le ferme pas.
 */
export function filterPanel(groups, { open = false } = {}) {
  const summary = groups
    .map((g) => {
      if (g.html !== undefined) return g.summary ?? ''; // champ libre (liste déroulante…) : résumé fourni
      const values = Array.isArray(g.value) ? g.value : [g.value];
      return g.options.filter((o) => values.includes(o.value) && !o.quiet).map((o) => o.label).join(' + ');
    })
    .filter(Boolean)
    .join(' · ');
  return `<details class="filters"${open ? ' open' : ''}>
    <summary><span class="ico" aria-hidden="true">⚙︎</span> Filtres <span class="muted">${esc(summary)}</span></summary>
    ${groups.map((g) => `<div class="frow"><span class="flabel">${esc(g.label)}</span>${g.html ?? chips(g.key, g.options, g.value)}</div>`).join('')}
  </details>`;
}

/** Retient l'ouverture du panneau de filtres d'un écran. */
export function trackPanel(root, state) {
  root.addEventListener('toggle', (event) => {
    if (event.target.matches?.('details.filters')) state.open = event.target.open;
  }, true);
}

export const MODES = [{ value: 'browse', label: 'Parcourir' }, { value: 'add', label: 'Ajouter à ma collection' }];

/**
 * Vignette d'une carte. Mode « browse » : lien vers la fiche ; mode « add » : toucher ajoute un exemplaire,
 * − et + règlent la quantité. `connected` : affiche l'état possédé (coche dorée).
 */
export function cardTile({ card, qty, price }, { sets, mode = 'browse', connected = false, showSet = false }) {
  const caption = `<div class="muted">${showSet ? `${esc(card.s)} ` : ''}${esc(card.n)} · ${formatEuro(price)}</div>`;
  const badge = qty > 1 ? `<span class="qty">×${qty}</span>` : '';
  if (mode === 'add') {
    return `<div class="tile pick${qty ? ' owned' : ''}" data-id="${card.id}" role="button" tabindex="0" aria-pressed="${qty > 0}" aria-label="${esc(displayName(card))} ${esc(card.n)}${qty ? `, ${qty} possédée${qty > 1 ? 's' : ''}` : ', toucher pour ajouter'}">
      ${cardImg(card, sets)}${badge}${caption}
      ${qty ? `<div class="stepper"><button type="button" data-step="-1" aria-label="Retirer un exemplaire">−</button><b>${qty}</b><button type="button" data-step="1" aria-label="Ajouter un exemplaire">+</button></div>` : ''}
    </div>`;
  }
  return `<a class="tile${connected ? ` pick${qty ? ' owned' : ''}` : ''}" href="#/carte/${card.id}" title="${esc(displayName(card))}">
    ${cardImg(card, sets)}${badge}${caption}</a>`;
}

/**
 * Ajout en un geste dans une grille en mode « add ». `owned` : Map idProduct → quantité, tenue à jour ici.
 * L'écran est redessiné tout de suite (`redraw`), puis remis à l'état réellement enregistré en cas d'échec.
 */
export function wireAdding(root, { owned, store, redraw }) {
  async function change(id, next) {
    const before = owned.get(id) ?? 0;
    next > 0 ? owned.set(id, next) : owned.delete(id);
    redraw();
    try {
      await store.setHolding(id, next);
    } catch (err) {
      before > 0 ? owned.set(id, before) : owned.delete(id);
      redraw(`Non enregistré : ${err.message}`);
    }
  }
  const act = (event) => {
    const tile = event.target.closest('.tile.pick[data-id]');
    if (!tile) return;
    const id = Number(tile.dataset.id);
    const qty = owned.get(id) ?? 0;
    const step = event.target.closest('[data-step]');
    if (step) change(id, Math.max(0, qty + Number(step.dataset.step)));
    else if (!qty) change(id, 1);
  };
  root.addEventListener('click', act);
  root.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('.tile.pick[data-id]')) { event.preventDefault(); act(event); }
  });
}
