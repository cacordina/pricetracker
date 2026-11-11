// Fiche d'une carte : image, prix, courbe, liens Cardmarket et eBay, collection et envies.
import { loadHistory } from '../lib/data.js';
import { COL, displayName, formatEuro, cardmarketUrl, ebaySoldUrl, RARITY_LABEL } from '../lib/metrics.js';
import { cardImg, chips, onChip, pctSpan, rarityTag, esc, RANGES, loadPrefs, savePrefs } from '../lib/ui.js';
import { renderPriceChart } from '../lib/chart.js';
import { CARDMARKET_FILTERS } from '../config.js';

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
  const history = await loadHistory(card.s).catch(() => null);
  const series = history?.cards?.[id];
  const priced = row && row[COL.trend] !== null;

  root.innerHTML = `
    <div class="card-head">
      ${cardImg(card, catalog.sets, 'high')}
      <div class="info">
        <h1 style="margin-bottom:2px">${esc(displayName(card))}</h1>
        <div class="muted">${esc(card.ja)}${card.fr && card.en ? ` · ${esc(card.en.replace(/\s*\[.*\]\s*$/, ""))}` : ""}</div>
        <div class="muted">${esc(card.s)} ${esc(card.n)}${rarityTag(card)}</div>
        <div class="muted">${esc(set?.name ?? '')}</div>
        ${priced ? `
          <div class="big" style="margin-top:10px">${formatEuro(row[COL.trend])}</div>
          <div>${pctSpan(row[COL.d7])} <span class="muted">7 j</span> &nbsp; ${pctSpan(row[COL.d30])} <span class="muted">30 j</span></div>
          <div class="kv">
            <span>Plus bas</span><span>${formatEuro(row[COL.low])}</span>
            <span>Moy. 7 j</span><span>${formatEuro(row[COL.avg7])}</span>
            <span>Moy. 30 j</span><span>${formatEuro(row[COL.avg30])}</span>
          </div>` : '<p class="muted" style="margin-top:10px">Pas de prix publié par Cardmarket pour cette carte.</p>'}
      </div>
    </div>
    <div class="chart" id="chart"></div>
    <div class="muted readout" style="min-height:1.4em"></div>
    <div class="legend"><span><i></i>tendance</span><span><i class="dash"></i>prix le plus bas</span></div>
    ${chips('range', RANGES, prefs.range)}
    <div class="muted">Le prix le plus bas peut correspondre à un exemplaire abîmé.</div>
    <a class="btn" href="${esc(cardmarketUrl(id, CARDMARKET_FILTERS))}" target="_blank" rel="noopener">Voir sur Cardmarket ↗</a>
    <div class="muted" style="text-align:center;margin-top:4px">Offres filtrées : cartes japonaises, vendeurs en France</div>
    <a class="btn sec" href="${esc(ebaySoldUrl(card, catalog.sets))}" target="_blank" rel="noopener">Dernières ventes sur eBay ↗</a>
    <div class="muted" style="text-align:center;margin-top:4px">Annonces vendues, les plus récentes d’abord</div>
    <div id="mine"></div>`;

  const chartEl = root.querySelector('#chart');
  const drawChart = () => renderPriceChart(chartEl, {
    dates: history?.dates ?? [],
    series: [
      { label: 'Tendance', values: series?.t ?? [] },
      { label: 'Plus bas', values: series?.l ?? [], dash: true },
    ],
  }, prefs.range);
  root._draw = drawChart;

  onChip(root, (group, value) => {
    if (group !== 'range') return;
    prefs.range = value;
    savePrefs('card', prefs);
    for (const chip of root.querySelectorAll('[data-group=range] .chip')) chip.classList.toggle('on', chip.dataset.value === value);
    drawChart();
  });

  renderMine(root.querySelector('#mine'), id, store);
}

export function mounted(root) {
  root._draw?.(); // le graphique a besoin d'être dans la page pour connaître sa largeur
}

/** Bloc « ma collection / mes envies » ; il ne bloque jamais l'affichage de la fiche. */
async function renderMine(box, id, store) {
  if (!store.isConfigured()) return;
  if (!(await store.getSession())) {
    box.innerHTML = '<a class="btn sec" href="#/connexion">Se connecter pour l’ajouter à ma collection ou à mes envies</a>';
    return;
  }
  let qty = 0;
  let wish = null;
  try {
    const [holdings, wishes] = await Promise.all([store.listHoldings(), store.listWishes()]);
    qty = holdings.find((h) => h.id_product === id)?.qty ?? 0;
    wish = wishes.find((w) => w.id_product === id) ?? null;
  } catch (err) {
    box.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }

  function draw(message = '') {
    box.innerHTML = `
      <div class="box"><div class="line">
        <span>${qty ? '✓ Dans ma collection' : 'Dans ma collection'}</span>
        <span class="stepper"><button type="button" data-act="minus" aria-label="Retirer un exemplaire" ${qty ? '' : 'disabled'}>−</button>
          <b>${qty}</b><button type="button" data-act="plus" aria-label="Ajouter un exemplaire">+</button></span>
      </div></div>
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
