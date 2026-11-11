// Extensions : toutes celles du catalogue japonais, rangées par grande série (Méga-Évolution, Écarlate et Violet…),
// des plus récentes aux plus anciennes.
import { setsOverview, seriesOf, SERIES, formatEuro } from '../lib/metrics.js';
import { cardImg, chips, onChip, esc, loadPrefs, savePrefs } from '../lib/ui.js';

const SHOW = [{ value: 'all', label: 'Tout afficher' }, { value: 'started', label: 'Commencées seulement' }];
const norm = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
let lastFilter = '';

export async function render(root, { catalog, snapshot, store }) {
  // Sans connexion, la liste reste consultable : seule la progression manque.
  let holdings = null;
  try { holdings = await store.listHoldings(); } catch { /* non connecté */ }
  const all = setsOverview(catalog, snapshot, holdings ?? []).map((e) => ({ ...e, series: seriesOf(e.set, e.date) }));
  const present = SERIES.filter((x) => all.some((e) => e.series.id === x.id));
  const SERIES_CHIPS = [{ value: 'all', label: 'Toutes' }, ...present.map((x) => ({ value: x.id, label: x.short }))];
  const prefs = loadPrefs('sets', { show: 'all', series: 'all' });
  if (!SERIES_CHIPS.some((c) => c.value === prefs.series)) prefs.series = 'all';
  if (!holdings) prefs.show = 'all';

  root.innerHTML = `
    <h1>Extensions</h1>
    <div class="muted">${all.length} extensions japonaises, ${catalog.cards.length.toLocaleString('fr-FR')} cartes</div>
    <input type="search" id="q" placeholder="Code ou nom — ex. « sv8a », « テラスタル »" value="${esc(lastFilter)}" autocomplete="off" aria-label="Filtrer les extensions" style="margin-top:12px">
    <div id="chips"></div>
    <div id="list"></div>`;
  const input = root.querySelector('#q');

  function draw() {
    lastFilter = input.value;
    const words = norm(input.value).split(/\s+/).filter(Boolean);
    // Un filtre texte cherche dans toutes les séries.
    const shown = all.filter((e) =>
      words.every((w) => norm(`${e.set} ${e.name} ${e.series.name}`).includes(w))
      && (prefs.show === 'all' || e.owned > 0)
      && (words.length || prefs.series === 'all' || e.series.id === prefs.series));
    root.querySelector('#chips').innerHTML = chips('series', SERIES_CHIPS, words.length ? 'all' : prefs.series)
      + (holdings ? chips('show', SHOW, prefs.show) : '');
    const groups = Map.groupBy(shown, (e) => e.series);
    root.querySelector('#list').innerHTML = shown.length
      ? SERIES.filter((x) => groups.has(x)).map((x) => section(x, groups.get(x))).join('')
      : '<p class="state">Aucune extension ne correspond.</p>';
  }

  function section(series, sets) {
    const owned = sets.reduce((n, e) => n + e.owned, 0);
    const total = sets.reduce((n, e) => n + e.total, 0);
    const years = [sets.at(-1).date, sets[0].date].map((d) => d?.slice(0, 4)).filter(Boolean);
    return `<h2 class="toolbar"><span>${esc(series.name)}</span>
        <span class="muted" style="font-size:13px">${sets.length} ext. · ${[...new Set(years)].join('–')}${holdings ? ` · ${owned}/${total}` : ''}</span></h2>
      ${sets.map(row).join('')}`;
  }

  function row(e) {
    const date = e.date ? new Date(`${e.date}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
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
    if (group !== 'show' && group !== 'series') return;
    prefs[group] = value;
    if (group === 'series') input.value = ''; // choisir une série vide le filtre texte
    savePrefs('sets', prefs);
    draw();
  });
  draw();
}
