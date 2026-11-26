// Extensions : toutes celles du catalogue japonais, rangées par grande série (Méga-Évolution, Écarlate et Violet…),
// des plus récentes aux plus anciennes.
import { normalizeText } from '../lib/model.js';
import { formatEuro } from '../lib/format.js';
import { setsOverview, seriesOf, SERIES } from '../lib/sets.js';
import { setImg, chips, onChip, esc, loadPrefs, savePrefs, exploreTabs } from '../lib/ui.js';

const SHOW = [{ value: 'all', label: 'Tout afficher' }, { value: 'started', label: 'Commencées seulement' }];
let lastFilter = '';

export async function render(root, { catalog, snapshot, store }) {
  // Sans connexion, la liste reste consultable : seule la progression manque.
  let holdings = null;
  try { holdings = await store.listHoldings(); } catch { /* non connecté */ }
  const all = setsOverview(catalog, snapshot, holdings ?? []).map((e) => ({ ...e, series: seriesOf(e.set, e.date) }));
  const present = SERIES.filter((x) => all.some((e) => e.series.id === x.id));
  const SERIES_CHIPS = [{ value: 'all', label: 'Toutes' }, ...present.map((x) => ({ value: x.id, label: x.short }))];
  // Par défaut, la série la plus récente : la liste complète fait plus de 30 écrans de haut.
  const prefs = loadPrefs('sets', { show: 'all', series: present[0]?.id ?? 'all' });
  if (!SERIES_CHIPS.some((c) => c.value === prefs.series)) prefs.series = 'all';
  if (!holdings) prefs.show = 'all';

  root.innerHTML = `
    ${exploreTabs('extensions')}
    <h1>Extensions</h1>
    <div class="muted">${all.length} extensions japonaises, ${catalog.cards.length.toLocaleString('fr-FR')} cartes</div>
    <a class="link" href="#/album" style="display:inline-block;margin-top:6px">Toutes les AR et SAR, toutes extensions ›</a>
    <input type="search" id="q" placeholder="Code ou nom — ex. « sv8a », « black bolt »" value="${esc(lastFilter)}" autocomplete="off" aria-label="Filtrer les extensions" style="margin-top:12px">
    <div id="chips"></div>
    <div id="list"></div>`;
  const input = root.querySelector('#q');

  function draw() {
    lastFilter = input.value;
    const words = normalizeText(input.value).split(/\s+/).filter(Boolean);
    // Un filtre texte cherche dans toutes les séries.
    const shown = all.filter((e) =>
      words.every((w) => normalizeText(`${e.set} ${e.name} ${catalog.sets[e.set]?.en ?? ''} ${e.series.name}`).includes(w))
      && (prefs.show === 'all' || e.owned > 0)
      && (words.length || prefs.series === 'all' || e.series.id === prefs.series));
    root.querySelector('#chips').innerHTML = `<div class="hscroll">${chips('series', SERIES_CHIPS, words.length ? 'all' : prefs.series)}</div>`
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
      ${setImg(catalog.sets[e.set], e.top, catalog.sets)}
      <div class="name"><b>${esc(e.set)} <span class="muted" style="font-weight:500">· ${esc(date)}</span></b>
        <div class="one">${esc(catalog.sets[e.set]?.en ?? e.name)}</div></div>
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
