// Extensions : toutes les séries du catalogue japonais, des plus récentes aux plus anciennes, groupées par année.
import { setsOverview, formatEuro } from '../lib/metrics.js';
import { cardImg, chips, onChip, esc, loadPrefs, savePrefs } from '../lib/ui.js';

const SHOW = [{ value: 'all', label: 'Toutes' }, { value: 'started', label: 'Commencées' }];
const norm = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
let lastFilter = '';

export async function render(root, { catalog, snapshot, store }) {
  // Sans connexion, la liste reste consultable : seule la progression manque.
  let holdings = null;
  try { holdings = await store.listHoldings(); } catch { /* non connecté */ }
  const all = setsOverview(catalog, snapshot, holdings ?? []);
  const prefs = loadPrefs('sets', { show: 'all' });
  if (!holdings) prefs.show = 'all';

  root.innerHTML = `
    <h1>Extensions</h1>
    <div class="muted">${all.length} extensions japonaises, ${catalog.cards.length.toLocaleString('fr-FR')} cartes</div>
    <input type="search" id="q" placeholder="Code ou nom — ex. « sv8a », « テラスタル »" value="${esc(lastFilter)}" autocomplete="off" aria-label="Filtrer les extensions" style="margin-top:12px">
    <div id="show"></div>
    <div id="list"></div>`;
  const input = root.querySelector('#q');

  function draw() {
    lastFilter = input.value;
    const words = norm(input.value).split(/\s+/).filter(Boolean);
    const shown = all.filter((e) =>
      words.every((w) => norm(`${e.set} ${e.name}`).includes(w)) && (prefs.show === 'all' || e.owned > 0));
    root.querySelector('#show').innerHTML = holdings ? chips('show', SHOW, prefs.show) : '';
    const years = Map.groupBy(shown, (e) => e.date?.slice(0, 4) ?? 'Sans date');
    root.querySelector('#list').innerHTML = shown.length
      ? [...years].map(([year, sets]) => `<h2>${esc(year)}</h2>${sets.map(row).join('')}`).join('')
      : '<p class="state">Aucune extension ne correspond.</p>';
  }

  function row(e) {
    const date = e.date ? new Date(`${e.date}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '';
    const progress = holdings
      ? `<div class="muted">${e.owned}/${e.total}${e.owned === e.total ? ' ✓' : ''}</div>`
      : `<div class="muted">${e.total} cartes</div>`;
    return `<a class="row" href="#/extension/${encodeURIComponent(e.set)}">
      ${e.top ? cardImg(e.top, catalog.sets) : '<div class="noimg"></div>'}
      <div class="name"><b>${esc(e.set)}</b> <span class="muted">${esc(date)}</span><div class="muted">${esc(e.name)}</div></div>
      <div class="price">${formatEuro(e.valueCents || null)}${progress}</div></a>`;
  }

  input.addEventListener('input', draw);
  onChip(root, (group, value) => {
    if (group !== 'show') return;
    prefs.show = value;
    savePrefs('sets', prefs);
    draw();
  });
  draw();
}
