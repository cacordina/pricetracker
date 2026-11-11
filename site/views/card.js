// Fiche d'une carte : image, prix, courbe, liens Cardmarket et eBay, collection et envies.
import { loadHistory, loadUsSnapshot, loadUsHistory } from '../lib/data.js';
import { COL, priceOf, priceSource, displayName, formatEuro, formatPct, formatUsd, usdToEur, usGap, alignTo, cardmarketUrl, ebaySoldUrl, RARITY_LABEL } from '../lib/metrics.js';
import { cardImg, chips, onChip, pctSpan, rarityTag, esc, RANGES, loadPrefs, savePrefs } from '../lib/ui.js';
import { renderPriceChart, frDate } from '../lib/chart.js';
import { CARDMARKET_FILTERS } from '../config.js';

const SOURCE_LABEL = {
  avg7: 'moyenne des ventes sur 7 jours',
  avg30: 'moyenne des ventes sur 30 jours (aucune vente sur 7 jours)',
  trend: 'tendance Cardmarket (aucune vente récente)',
  null: '',
};

export async function render(root, { catalog, snapshot, store, param }) {
  const id = Number(param);
  const card = catalog.byId.get(id);
  if (!card) {
    root.innerHTML = `<p class="state">Carte inconnue (n° ${esc(param)}).<br>Elle n’est pas, ou plus, dans le catalogue japonais.</p>
      <a class="btn sec" href="${esc(cardmarketUrl(id, CARDMARKET_FILTERS))}" target="_blank" rel="noopener">Voir sur Cardmarket ↗</a>`;
    return;
  }
  const row = snapshot.cards[id];
  const set = catalog.sets[card.s];
  const prefs = loadPrefs('card', { range: '30' });
  const [history, us, usHistory] = await Promise.all([
    loadHistory(card.s).catch(() => null), loadUsSnapshot(), loadUsHistory(card.s),
  ]);
  const series = history?.cards?.[id];
  const price = priceOf(row);
  const priced = price !== null;
  const source = priceSource(row);
  // TCGplayer : prix en dollars, convertis au taux BCE du jour du relevé.
  const usd = us?.cards?.[id] ?? null;
  const usEur = usdToEur(usd, us?.rate);
  const usSeries = usHistory?.cards?.[id]
    ? alignTo(history?.dates ?? [], usHistory.dates, usHistory.cards[id].map((v, i) => usdToEur(v, usHistory.rates?.[i] ?? us?.rate)))
    : null;

  root.innerHTML = `
    <div class="card-head">
      ${cardImg(card, catalog.sets, 'high')}
      <div class="info">
        <h1 style="margin-bottom:2px">${esc(displayName(card))}</h1>
        <div class="muted">${esc(card.ja)}${card.fr && card.en ? ` · ${esc(card.en.replace(/\s*\[.*\]\s*$/, ""))}` : ""}</div>
        <div class="muted">${esc(card.s)} ${esc(card.n)}${rarityTag(card)}</div>
        <a class="muted" href="#/extension/${encodeURIComponent(card.s)}" style="text-decoration:underline">${esc(set?.name ?? card.s)}</a>
        ${priced ? `
          <div class="big" style="margin-top:10px">${formatEuro(price)}</div>
          <div class="muted" style="font-size:12px">${SOURCE_LABEL[source]}</div>
          <div>${row[COL.d7] === null && row[COL.d30] === null
            ? '<span class="muted" style="font-size:13px">Variations après 7 jours de relevés</span>'
            : `${pctSpan(row[COL.d7])} <span class="muted">7 j</span> &nbsp; ${pctSpan(row[COL.d30])} <span class="muted">30 j</span>`}</div>
          <div class="kv">
            <span>Moy. 30 j</span><span>${formatEuro(row[COL.avg30])}</span>
            <span>Plus bas</span><span>${formatEuro(row[COL.low])}</span>
            <span>Tendance</span><span>${formatEuro(row[COL.trend])}</span>
          </div>` : '<p class="muted" style="margin-top:10px">Pas de prix publié par Cardmarket pour cette carte.</p>'}
      </div>
    </div>
    ${usBlock()}
    <div class="chart" id="chart"></div>
    <div class="muted readout" style="min-height:1.4em"></div>
    <div class="legend"><span><i></i>moyenne 7 j</span><span><i class="dash"></i>plus bas en vente</span>${usSeries?.some((v) => v !== null) ? '<span><i class="us"></i>TCGplayer (€)</span>' : ''}</div>
    ${chips('range', RANGES, prefs.range)}
    <div class="muted">Prix suivi : moyenne des ventes Cardmarket sur 7 jours (états Excellent ou mieux). Le plus bas en vente peut être un exemplaire abîmé ; la tendance Cardmarket est donnée pour information.</div>
    <a class="btn" href="${esc(cardmarketUrl(id, CARDMARKET_FILTERS))}" target="_blank" rel="noopener">Voir sur Cardmarket ↗</a>
    <div class="muted" style="text-align:center;margin-top:4px">Offres filtrées : cartes japonaises, vendeurs en France</div>
    <a class="btn sec" href="${esc(ebaySoldUrl(card, catalog.sets))}" target="_blank" rel="noopener">Dernières ventes sur eBay ↗</a>
    <div class="muted" style="text-align:center;margin-top:4px">Annonces vendues, les plus récentes d’abord</div>
    <div id="mine"></div>`;

  const chartEl = root.querySelector('#chart');
  const drawChart = () => renderPriceChart(chartEl, {
    dates: history?.dates ?? [],
    series: [
      { label: 'Moy. 7 j', values: series?.p ?? [] },
      { label: 'Plus bas', values: series?.l ?? [], dash: true },
      ...(usSeries ? [{ label: 'TCGplayer', values: usSeries, color: 'var(--us)' }] : []),
    ],
  }, prefs.range, { empty: priced ? 'La courbe de la moyenne des ventes 7 j apparaîtra avec les prochains relevés.' : undefined });
  root._draw = drawChart;

  function usBlock() {
    if (!us) return ''; // prix TCGplayer pas encore publiés
    if (usd === null) return '<p class="muted" style="margin-top:12px">Pas de prix de marché TCGplayer (États-Unis) pour cette carte.</p>';
    const gap = priced ? usGap(price, usEur) : null;
    return `<div class="box us">
      <div class="line"><span>TCGplayer <span class="muted">États-Unis</span></span><b>${formatUsd(usd)}</b></div>
      <div class="line" style="margin-top:2px">
        <span class="muted">${usEur !== null ? `≈ ${formatEuro(usEur)}` : ''}</span>
        <span class="muted">${gap === null ? '' : gap ? `${formatPct(gap)} par rapport à Cardmarket` : 'même prix que Cardmarket'}</span>
      </div>
      <div class="muted" style="font-size:12px;margin-top:6px">Prix de marché (ventes récentes), relevé du ${esc(frDate(us.date))}${us.rate ? ` · 1 $ = ${us.rate.toFixed(4).replace('.', ',')} € (BCE)` : ''}</div>
    </div>`;
  }

  onChip(root, (group, value) => {
    if (group !== 'range') return;
    prefs.range = value;
    savePrefs('card', prefs);
    for (const chip of root.querySelectorAll('[data-group=range] .chip')) chip.classList.toggle('on', chip.dataset.value === value);
    drawChart();
  });

  renderMine(root.querySelector('#mine'), id, store, price);
}

export function mounted(root) {
  root._draw?.(); // le graphique a besoin d'être dans la page pour connaître sa largeur
}

/** Bloc « ma collection / mes envies » ; il ne bloque jamais l'affichage de la fiche. */
async function renderMine(box, id, store, trend) {
  if (!store.isConfigured()) return;
  if (!(await store.getSession())) {
    box.innerHTML = '<a class="btn sec" href="#/connexion">Se connecter pour l’ajouter à ma collection ou à mes envies</a>';
    return;
  }
  let qty = 0;
  let paid = null;   // prix d'achat par exemplaire, en centimes
  let bought = null; // date d'achat "AAAA-MM-JJ"
  let wish = null;
  try {
    const [holdings, wishes] = await Promise.all([store.listHoldings(), store.listWishes()]);
    const holding = holdings.find((h) => h.id_product === id);
    qty = holding?.qty ?? 0;
    paid = holding?.paid_cents ?? null;
    bought = holding?.bought_on ?? null;
    wish = wishes.find((w) => w.id_product === id) ?? null;
  } catch (err) {
    box.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }

  function purchaseBlock() {
    const gain = paid !== null && trend !== null ? (trend - paid) * qty : null;
    return `
      <div class="line" style="margin-top:10px">
        <span class="muted">Prix d’achat</span>
        <span class="muted"><input class="small" type="number" id="paid" inputmode="decimal" min="0" step="0.01" placeholder="—" value="${paid !== null ? (paid / 100).toFixed(2) : ''}" aria-label="Prix d’achat par exemplaire en euros"> €</span>
      </div>
      <div class="line" style="margin-top:8px">
        <span class="muted">Date d’achat</span>
        <input class="small date" type="date" id="bought" max="${new Date().toISOString().slice(0, 10)}" value="${esc(bought ?? '')}" aria-label="Date d’achat">
      </div>
      <div class="line" style="margin-top:8px">
        <button type="button" class="link" data-act="purchase">Enregistrer l’achat</button>
        ${gain !== null ? `<span class="${gain >= 0 ? 'up' : 'down'}">${gain >= 0 ? '+' : ''}${formatEuro(gain)}${paid ? ` (${formatPct(((trend - paid) / paid) * 100)})` : ''}</span>` : ''}
      </div>
      ${qty > 1 ? '<div class="muted" style="margin-top:4px">Prix par exemplaire ; s’ils n’ont pas coûté pareil, indiquez la moyenne.</div>' : ''}`;
  }

  function draw(message = '') {
    box.innerHTML = `
      <div class="box"><div class="line">
        <span>${qty ? '✓ Dans ma collection' : 'Dans ma collection'}</span>
        <span class="stepper"><button type="button" data-act="minus" aria-label="Retirer un exemplaire" ${qty ? '' : 'disabled'}>−</button>
          <b>${qty}</b><button type="button" data-act="plus" aria-label="Ajouter un exemplaire">+</button></span>
      </div>
      ${qty ? purchaseBlock() : ''}</div>
      <div class="box"><div class="line">
        <span>${wish ? '★ Dans mes envies' : 'Mes envies'}</span>
        <span class="muted">prix cible <input class="small" type="number" id="target" inputmode="decimal" min="0" step="0.01" placeholder="—" value="${wish?.target_cents ? (wish.target_cents / 100).toFixed(2) : ''}" aria-label="Prix cible en euros"> €</span>
      </div>
      <div class="line" style="margin-top:8px">
        <button type="button" class="link" data-act="wish">${wish ? 'Mettre à jour la cible' : 'Ajouter à mes envies'}</button>
        ${wish ? '<button type="button" class="link" data-act="unwish">Retirer de mes envies</button>' : ''}
      </div></div>
      ${message ? `<p class="error">${esc(message)}</p>` : ''}`;
  }

  box.addEventListener('click', async (event) => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    try {
      if (act === 'plus' || act === 'minus') {
        const next = Math.max(0, qty + (act === 'plus' ? 1 : -1));
        await store.setHolding(id, next);
        qty = next;
        if (!next) { paid = null; bought = null; } // la ligne est supprimée avec ses infos d’achat
      } else if (act === 'purchase') {
        const raw = box.querySelector('#paid').value.trim().replace(',', '.');
        const euros = raw === '' ? null : Number(raw);
        if (euros !== null && !(euros >= 0)) return draw('Le prix d’achat doit être un montant positif.');
        const date = box.querySelector('#bought').value || null;
        if (date && date > new Date().toISOString().slice(0, 10)) return draw('La date d’achat ne peut pas être dans le futur.');
        const cents = euros === null ? null : Math.round(euros * 100);
        await store.setPurchase(id, { paidCents: cents, boughtOn: date });
        paid = cents;
        bought = date;
      } else if (act === 'wish') {
        const raw = box.querySelector('#target').value.trim().replace(',', '.');
        const euros = raw === '' ? null : Number(raw);
        if (euros !== null && !(euros > 0)) return draw('Le prix cible doit être un montant positif.');
        const target = euros === null ? null : Math.round(euros * 100);
        await store.setWish(id, target);
        wish = { id_product: id, target_cents: target };
        window.dispatchEvent(new Event('wishes-changed'));
      } else if (act === 'unwish') {
        await store.removeWish(id);
        wish = null;
        window.dispatchEvent(new Event('wishes-changed'));
      }
      draw();
    } catch (err) {
      draw(err.message);
    }
  });
  draw();
}
