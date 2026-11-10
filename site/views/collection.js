// Écran Collection : valeur totale, courbe et mosaïque des cartes possédées.
import { loadHistories } from '../lib/data.js';
import { COL, completion, collectionValue, collectionSeries, formatEuro, formatPct, rangeChange, sliceRange } from '../lib/metrics.js';
import { cardImg, chips, onChip, esc, RANGES, loadPrefs, savePrefs, storeProblem } from '../lib/ui.js';
import { renderPriceChart } from '../lib/chart.js';
import { staleBanner, wireStale } from '../lib/migrate.js';

const SORTS = [{ value: 'value', label: 'Par valeur' }, { value: 'change', label: 'Par variation' }];

export async function render(root, { catalog, snapshot, store, refresh }) {
  let holdings;
  try {
    holdings = await store.listHoldings();
  } catch (err) {
    root.innerHTML = `<h1>Ma collection</h1>${storeProblem(err)}`;
    return;
  }
  if (!holdings.length) {
    root.innerHTML = `<h1>Ma collection</h1>
      <p class="state">Votre collection est vide.</p>
      <a class="btn" href="#/ajout">Ajouter des cartes par extension</a>
      <p class="muted" style="text-align:center;margin-top:10px">Ou ouvrez une carte depuis la recherche et touchez « + ».</p>`;
    return;
  }

  const prefs = loadPrefs('collection', { range: '30', filter: 'all', set: '', sort: 'value', done: ['AR'], doneAll: false });
  // Chaque possession avec sa carte (ou null si elle a disparu du catalogue).
  const items = holdings.map((h) => ({ ...h, card: catalog.byId.get(h.id_product) ?? null, row: snapshot.cards[h.id_product] }));
  const ownedSets = [...new Set(items.filter((i) => i.card).map((i) => i.card.s))];
  const histories = await loadHistories(ownedSets);
  if (prefs.set && !ownedSets.includes(prefs.set)) prefs.set = '';

  const visible = () => items.filter((i) =>
    (prefs.filter === 'all' || i.card?.r === prefs.filter) && (!prefs.set || i.card?.s === prefs.set));

  function draw() {
    const shown = visible();
    const value = collectionValue(shown, snapshot);
    const series = collectionSeries(shown.filter((i) => i.card), histories);
    const from = sliceRange(series.dates, prefs.range);
    const change = rangeChange(series.values.slice(from));
    const sorted = [...shown].sort((a, b) => (prefs.sort === 'change'
      ? (b.row?.[COL.d7] ?? -Infinity) - (a.row?.[COL.d7] ?? -Infinity)
      : (b.row?.[COL.trend] ?? -1) * b.qty - (a.row?.[COL.trend] ?? -1) * a.qty));
    const done = completion(holdings, catalog, prefs.done);
    const doneSets = done.sets.filter((e) => prefs.doneAll || e.owned > 0);
    const rangeLabel = RANGES.find((r) => r.value === prefs.range).label.toLowerCase();

    root.innerHTML = `
      <div class="toolbar"><h1>Ma collection</h1><a class="link" href="#/ajout">+ Ajouter des cartes</a></div>
      ${staleBanner(holdings, catalog.aliases, 'votre collection')}
      <div class="big">${formatEuro(value.totalCents)}</div>
      <div>${change
        ? `<span class="${change.deltaCents >= 0 ? 'up' : 'down'}">${change.deltaCents >= 0 ? '▲ +' : '▼ '}${formatEuro(change.deltaCents)} (${formatPct(change.pct)})</span> <span class="muted">sur ${rangeLabel === 'tout' ? 'tout l’historique' : rangeLabel}</span>`
        : '<span class="muted">Variation disponible dès le deuxième relevé de prix.</span>'}</div>
      <div class="muted">${value.count} carte${value.count > 1 ? 's' : ''}${value.unpriced ? ` · ${value.unpriced} sans prix, non comptée${value.unpriced > 1 ? 's' : ''}` : ''}</div>
      <div class="muted">Complétion ${esc(prefs.done.join(' + '))} : <b>${done.owned}/${done.total}</b> (${done.pct} %) · <a href="#" id="to-done" style="text-decoration:underline">détail par extension</a></div>
      <div class="chart" id="chart"></div>
      <div class="muted readout" style="min-height:1.4em"></div>
      ${chips('range', RANGES, prefs.range)}
      <div class="chips" data-group="filter">
        ${[['all', 'Toutes'], ['AR', 'AR'], ['SAR', 'SAR']].map(([v, l]) => `<button type="button" class="chip${prefs.filter === v ? ' on' : ''}" data-value="${v}">${l}</button>`).join('')}
        <select class="chip${prefs.set ? ' on' : ''}" id="set" aria-label="Filtrer par extension">
          <option value="">Toutes les extensions</option>
          ${ownedSets.sort().map((s) => `<option value="${esc(s)}"${prefs.set === s ? ' selected' : ''}>${esc(s)} — ${esc(catalog.sets[s]?.name ?? '')}</option>`).join('')}
        </select>
      </div>
      ${chips('sort', SORTS, prefs.sort)}
      ${sorted.length ? `<div class="grid">${sorted.map(tile).join('')}</div>` : '<p class="state">Aucune carte avec ces filtres.</p>'}
      <h2 id="done">Complétion</h2>
      <div class="chips" data-group="done">
        ${['AR', 'SAR'].map((r) => `<button type="button" class="chip${prefs.done.includes(r) ? ' on' : ''}" data-value="${r}">${r}</button>`).join('')}
      </div>
      <div class="meter-row total"><div class="line"><b>Toutes les extensions</b><span>${done.owned}/${done.total} · ${done.pct} %</span></div>
        <div class="meter" role="img" aria-label="${done.pct} % complété"><i style="width:${done.pct}%"></i></div></div>
      ${doneSets.map((e) => `<a class="meter-row" href="#/ajout" data-set="${esc(e.set)}">
        <div class="line"><span>${esc(e.set)} <span class="muted">${esc(e.name)}</span></span><span>${e.owned}/${e.total} · ${e.pct} %${e.owned === e.total ? ' ✓' : ''}</span></div>
        <div class="meter" role="img" aria-label="${e.pct} % complété"><i style="width:${e.pct}%"></i></div></a>`).join('')}
      <p style="text-align:center"><button type="button" class="link" id="done-all">${prefs.doneAll ? 'Seulement les extensions commencées' : `Voir les ${done.sets.length} extensions`}</button></p>
      <p class="muted">Cartes distinctes possédées parmi celles classées ${esc(prefs.done.join(' ou '))} ; les doublons ne comptent qu’une fois. Touchez une extension pour y cocher vos cartes.</p>
      <p style="text-align:center;margin-top:22px"><button type="button" class="link" id="signout">Se déconnecter</button></p>`;

    renderPriceChart(root.querySelector('#chart'), { dates: series.dates, series: [{ label: 'Valeur', values: series.values }] }, prefs.range);
    root.querySelector('#set').onchange = (e) => { prefs.set = e.target.value; savePrefs('collection', prefs); draw(); };
    root.querySelector('#signout').onclick = () => store.signOut();
    root.querySelector('#to-done').onclick = (e) => { e.preventDefault(); root.querySelector('#done').scrollIntoView({ behavior: 'smooth' }); };
    root.querySelector('#done-all').onclick = () => { prefs.doneAll = !prefs.doneAll; savePrefs('collection', prefs); draw(); root.querySelector('#done').scrollIntoView(); };
    for (const row of root.querySelectorAll('a.meter-row')) {
      // ouvre la saisie rapide directement sur cette extension, filtrée sur les cartes rares
      row.onclick = () => savePrefs('quickadd', { set: row.dataset.set, only: 'rare' });
    }
    wireStale(root, holdings, catalog.aliases, 'holdings', store, refresh);
  }

  function tile(item) {
    const trend = item.row?.[COL.trend] ?? null;
    const d7 = item.row?.[COL.d7] ?? null;
    const arrow = d7 > 0 ? ' <span class="up">▲</span>' : d7 < 0 ? ' <span class="down">▼</span>' : '';
    const image = item.card
      ? cardImg(item.card, catalog.sets)
      : `<div class="noimg">Carte inconnue<br>(n° ${item.id_product})</div>`;
    return `<a class="tile" href="#/carte/${item.id_product}">
      ${image}${item.qty > 1 ? `<span class="qty">×${item.qty}</span>` : ''}
      ${trend === null ? '<span class="muted">pas de prix</span>' : formatEuro(trend)}${arrow}</a>`;
  }

  onChip(root, (group, value) => {
    if (group === 'done') {
      const next = prefs.done.includes(value) ? prefs.done.filter((r) => r !== value) : [...prefs.done, value];
      prefs.done = next.length ? ['AR', 'SAR'].filter((r) => next.includes(r)) : prefs.done; // au moins une rareté
      savePrefs('collection', prefs);
      draw();
      root.querySelector('#done').scrollIntoView();
      return;
    }
    if (!(group in prefs)) return;
    prefs[group] = value;
    savePrefs('collection', prefs);
    draw();
  });
  root._draw = draw;
  draw();
}

export function mounted(root) {
  root._draw?.(); // redessine une fois dans la page, pour que la courbe connaisse sa largeur
}
