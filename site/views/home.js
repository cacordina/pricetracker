// Accueil : la collection en vitrine, puis ce qui mérite un coup d'œil aujourd'hui.
import { loadHistories } from '../lib/data.js';
import {
  COL, collectionValue, collectionSeries, rangeChange, sliceRange, marketList, completion,
  wishStatus, sortWishes, topOwned, formatEuro, formatPct, displayName, priceOf,
} from '../lib/metrics.js';
import { cardImg, cardRow, pctSpan, esc } from '../lib/ui.js';
import { frDate } from '../lib/chart.js';

const ICON = {
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.500" width="14" height="17" rx="2"/><path d="M12 8.500v7M8.500 12h7"/></svg>',
  album: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.500" y="4" width="7" height="7" rx="1.200"/><rect x="13.500" y="4" width="7" height="7" rx="1.200"/><rect x="3.500" y="13" width="7" height="7" rx="1.200"/><rect x="13.500" y="13" width="7" height="7" rx="1.200"/></svg>',
  sets: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5 12 4l8 3.5-8 3.5z"/><path d="m4 12 8 3.500 8-3.500"/><path d="m4 16.500 8 3.500 8-3.500"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.800-3.800"/></svg>',
};

export async function render(root, { catalog, snapshot, store }) {
  // Sans connexion, l'accueil reste utile : seules les parties « ma collection » changent.
  let holdings = null;
  let wishes = [];
  try {
    [holdings, wishes] = await Promise.all([store.listHoldings(), store.listWishes()]);
  } catch { /* non connecté ou service indisponible */ }

  const movers = (tab) => marketList(catalog, snapshot, { rarities: ['AR', 'SAR'], tab, window: 7, minCents: 500, limit: 12 });
  const ups = movers('up');
  const deals = movers('deals');

  root.innerHTML = `
    ${hero()}
    <div class="quick">
      <a href="#/ajout">${ICON.add}Ajouter par série</a>
      <a href="#/album">${ICON.album}Toutes les AR</a>
      <a href="#/extensions">${ICON.sets}Extensions</a>
      <a href="#/recherche">${ICON.search}Chercher une carte</a>
    </div>
    ${wishBlock()}
    ${strip('Hausses AR et SAR sur 7 jours', ups, 'Aucune hausse notable aujourd’hui.')}
    ${strip('Sous leur moyenne 30 jours', deals, 'Aucune bonne affaire aujourd’hui.')}
    ${doneBlock()}
    <p class="muted" style="text-align:center;margin-top:26px">Prix Cardmarket du ${esc(frDate(snapshot.date))}</p>`;

  function fan(cards) {
    return cards.length ? `<div class="fan" aria-hidden="true">${cards.map((c) => cardImg(c, catalog.sets)).join('')}</div>` : '';
  }

  function hero() {
    if (holdings === null) {
      return `<a class="hero" href="#/connexion">
        <div class="txt"><div class="muted">Votre collection</div>
          <h1 style="margin:4px 0 6px">Suivez la valeur de vos cartes japonaises</h1>
          <span class="link">Se connecter</span></div>
        ${fan(ups.slice(0, 3).map((m) => m.card))}</a>`;
    }
    if (!holdings.length) {
      return `<a class="hero" href="#/scan">
        <div class="txt"><div class="muted">Votre collection</div>
          <h1 style="margin:4px 0 6px">Elle est encore vide</h1>
          <span class="link">Scanner une première carte</span></div>
        ${fan(ups.slice(0, 3).map((m) => m.card))}</a>`;
    }
    const value = collectionValue(holdings, snapshot);
    return `<a class="hero" href="#/collection" id="hero">
      <div class="txt"><div class="muted">Ma collection · ${value.count} carte${value.count > 1 ? 's' : ''}</div>
        <div class="big">${formatEuro(value.totalCents)}</div>
        <div id="hero-change" class="muted">&nbsp;</div></div>
      ${fan(topOwned(holdings, catalog, snapshot, 3))}</a>`;
  }

  function wishBlock() {
    const under = sortWishes(wishes
      .map((wish) => ({ wish, card: catalog.byId.get(wish.id_product), row: snapshot.cards[wish.id_product] }))
      .filter((i) => i.card)
      .map((i) => ({ ...i, status: wishStatus(i.wish, i.row, null) })))
      .filter((i) => i.status.underTarget);
    if (!under.length) return '';
    return `<div class="section-head"><h2>Sous votre prix cible</h2><a class="link" href="#/envies">Mes envies</a></div>
      ${under.slice(0, 3).map((i) => cardRow(i.card, catalog.sets, {
        trend: priceOf(i.row), change: i.row?.[COL.d7] ?? null,
        sub: esc(`Cible ${formatEuro(i.wish.target_cents)}`), tags: '<span class="tag">Sous la cible</span>',
      })).join('')}`;
  }

  function strip(title, list, empty) {
    return `<div class="section-head"><h2>${esc(title)}</h2><a class="link" href="#/marche">Tout le marché</a></div>
      ${list.length ? `<div class="strip">${list.map(({ card, trend, change }) => `
        <a class="tile" href="#/carte/${card.id}">${cardImg(card, catalog.sets)}
          <b>${esc(displayName(card))}</b>${formatEuro(trend)} ${pctSpan(change)}</a>`).join('')}</div>`
        : `<p class="muted">${esc(empty)}</p>`}`;
  }

  function doneBlock() {
    if (!holdings?.length) return '';
    const done = completion(holdings, catalog, ['AR']);
    const started = done.sets.filter((s) => s.owned > 0).slice(0, 3);
    return `<div class="section-head"><h2>Complétion AR</h2><a class="link" href="#/album">Voir toutes les AR</a></div>
      <a class="meter-row total" href="#/album"><div class="line"><b>Toutes les séries</b><span>${done.owned}/${done.total}</span></div>
        <div class="meter"><i style="width:${done.pct}%"></i></div></a>
      ${started.map((s) => `<a class="meter-row" href="#/album/${encodeURIComponent(s.set)}">
        <div class="line"><span>${esc(s.set)} <span class="muted">${esc(s.name)}</span></span><span>${s.owned}/${s.total}</span></div>
        <div class="meter${s.owned === s.total ? ' full' : ''}"><i style="width:${s.pct}%"></i></div></a>`).join('')}`;
  }

  // La variation sur 30 jours demande les historiques : on l'ajoute après coup, sans retarder l'affichage.
  if (holdings?.length) {
    const sets = [...new Set(holdings.map((h) => catalog.byId.get(h.id_product)?.s).filter(Boolean))];
    loadHistories(sets).then((histories) => {
      const series = collectionSeries(holdings.filter((h) => catalog.byId.has(h.id_product)), histories);
      const change = rangeChange(series.values.slice(sliceRange(series.dates, '30')));
      const el = root.querySelector('#hero-change');
      if (!el) return;
      el.innerHTML = change
        ? `<span class="${change.deltaCents >= 0 ? 'up' : 'down'}">${change.deltaCents >= 0 ? '+' : ''}${formatEuro(change.deltaCents)} (${formatPct(change.pct)})</span> sur 30 jours`
        : 'Variation dès le deuxième relevé';
    }).catch(() => {});
  }
}
