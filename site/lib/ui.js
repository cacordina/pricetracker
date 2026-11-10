// Petits utilitaires d'affichage partagés par les écrans.
import { imageUrl, displayName, formatEuro, formatPct, RARITY_LABEL } from './metrics.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Image d'une carte, avec repli si elle manque. */
export function cardImg(card, sets, quality = 'low') {
  const url = card ? imageUrl(card, sets, quality) : null;
  const label = card ? esc(displayName(card)) : 'Carte inconnue';
  if (!url) return `<div class="noimg">${label}</div>`;
  return `<img src="${esc(url)}" alt="${label}" loading="lazy" onerror="this.outerHTML='<div class=&quot;noimg&quot;>Image indisponible</div>'">`;
}

export const rarityTag = (card) => (RARITY_LABEL[card.r] ? ` <span class="muted">${RARITY_LABEL[card.r]}</span>` : '');

export function pctSpan(value) {
  if (value === null || value === undefined) return '<span class="muted">—</span>';
  const cls = value > 0 ? 'up' : value < 0 ? 'down' : 'muted';
  return `<span class="${cls}">${formatPct(value)}</span>`;
}

/** Ligne de liste standard : image, nom, extension · numéro, prix et variation. */
export function cardRow(card, sets, { trend, change, sub = '', tags = '' }) {
  return `<a class="row" href="#/carte/${card.id}">
    ${cardImg(card, sets)}
    <div class="name"><b>${esc(displayName(card))}</b>
      <div class="muted">${esc(card.s)} · ${esc(card.n)}${rarityTag(card)} ${tags}</div>
      ${sub ? `<div class="muted">${sub}</div>` : ''}</div>
    <div class="price">${formatEuro(trend)}<div>${pctSpan(change)}</div></div>
  </a>`;
}

/** Groupe de puces ; `options` = [{ value, label }], `selected` = valeur ou tableau de valeurs. */
export function chips(name, options, selected) {
  const on = (v) => (Array.isArray(selected) ? selected.includes(v) : selected === v);
  return `<div class="chips" data-group="${name}">${options.map((o) =>
    `<button type="button" class="chip${on(o.value) ? ' on' : ''}" data-value="${esc(o.value)}" aria-pressed="${on(o.value)}">${esc(o.label)}</button>`).join('')}</div>`;
}

/** Appelle `handler(groupe, valeur)` quand une puce est touchée. */
export function onChip(root, handler) {
  root.addEventListener('click', (event) => {
    const chip = event.target.closest('button.chip');
    const group = chip?.closest('[data-group]');
    if (group) handler(group.dataset.group, chip.dataset.value);
  });
}

export const RANGES = [{ value: '7', label: '7 j' }, { value: '30', label: '30 j' }, { value: '90', label: '90 j' }, { value: 'all', label: 'Tout' }];

/** Préférences d'affichage par appareil ; le site doit fonctionner sans. */
export function loadPrefs(key, defaults) {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? '{}') };
  } catch {
    return { ...defaults };
  }
}
export function savePrefs(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* stockage indisponible : tant pis */ }
}

/** Écran affiché quand collection ou envies ne sont pas accessibles. */
export function storeProblem(error) {
  if (error?.code === 'auth') {
    return `<p class="state">Connexion requise pour voir cette page.</p><a class="btn" href="#/connexion">Se connecter</a>`;
  }
  if (error?.code === 'config') {
    return `<p class="state">La sauvegarde en ligne de la collection n’est pas encore configurée.<br>Le marché, la recherche et les fiches fonctionnent déjà.</p>`;
  }
  return `<p class="state">Service indisponible, réessayez.</p><button class="btn sec" onclick="location.reload()">Réessayer</button>`;
}
