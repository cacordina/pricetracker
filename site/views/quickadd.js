// Saisie rapide : choisir une extension, puis toucher les cartes possédées.
import { COL, formatEuro, displayName } from '../lib/metrics.js';
import { cardImg, esc, loadPrefs, savePrefs, storeProblem } from '../lib/ui.js';

export async function render(root, { catalog, snapshot, store }) {
  let holdings;
  try {
    holdings = await store.listHoldings();
  } catch (err) {
    root.innerHTML = `<h1>Ajouter des cartes</h1>${storeProblem(err)}`;
    return;
  }
  const owned = new Map(holdings.map((h) => [h.id_product, h.qty]));
  const bySet = Map.groupBy(catalog.cards, (c) => c.s);
  // Extensions les plus récentes d'abord.
  const setIds = [...bySet.keys()].sort((a, b) => (catalog.sets[b]?.date ?? '').localeCompare(catalog.sets[a]?.date ?? '') || a.localeCompare(b));
  const prefs = loadPrefs('quickadd', { set: setIds[0], only: 'all' });
  if (!bySet.has(prefs.set)) prefs.set = setIds[0];

  function draw(message = '') {
    const cards = [...bySet.get(prefs.set)]
      .filter((c) => prefs.only === 'all' || c.r === 'AR' || c.r === 'SAR' || c.r === 'secret')
      .sort((a, b) => a.n.localeCompare(b.n, 'fr', { numeric: true }));
    const count = [...bySet.get(prefs.set)].filter((c) => owned.has(c.id)).length;
    root.innerHTML = `
      <div class="toolbar"><h1>Ajouter des cartes</h1><a class="link" href="#/collection">Terminé</a></div>
      <label class="field"><span>Extension</span>
        <select id="set" class="chip on" style="width:100%;border-radius:10px;padding:10px 12px">
          ${setIds.map((s) => `<option value="${esc(s)}"${s === prefs.set ? ' selected' : ''}>${esc(s)} — ${esc(catalog.sets[s]?.name ?? '')}</option>`).join('')}
        </select></label>
      <div class="chips">
        <button type="button" class="chip${prefs.only === 'all' ? ' on' : ''}" data-only="all">Toutes les cartes</button>
        <button type="button" class="chip${prefs.only === 'rare' ? ' on' : ''}" data-only="rare">AR, SAR et secrètes</button>
      </div>
      <div class="muted">Touchez une carte pour l’ajouter ; − et + règlent la quantité. Enregistrement immédiat. ${count} possédée${count > 1 ? 's' : ''} dans cette extension.</div>
      ${message ? `<p class="error">${esc(message)}</p>` : ''}
      <div class="grid" style="margin-top:10px">${cards.map(tile).join('') || '<p class="state">Aucune carte.</p>'}</div>`;
    root.querySelector('#set').onchange = (e) => { prefs.set = e.target.value; savePrefs('quickadd', prefs); draw(); window.scrollTo(0, 0); };
  }

  function tile(card) {
    const qty = owned.get(card.id) ?? 0;
    const trend = snapshot.cards[card.id]?.[COL.trend] ?? null;
    return `<div class="tile pick${qty ? ' owned' : ''}" data-id="${card.id}" role="button" tabindex="0" aria-pressed="${qty > 0}" aria-label="${esc(displayName(card))} ${esc(card.n)}">
      ${cardImg(card, catalog.sets)}
      <div class="muted">${esc(card.n)} · ${formatEuro(trend)}</div>
      ${qty ? `<div class="stepper"><button type="button" data-step="-1" aria-label="Retirer un exemplaire">−</button><b>${qty}</b><button type="button" data-step="1" aria-label="Ajouter un exemplaire">+</button></div>` : ''}
    </div>`;
  }

  async function change(id, next) {
    const before = owned.get(id) ?? 0;
    next > 0 ? owned.set(id, next) : owned.delete(id);
    draw();
    try {
      await store.setHolding(id, next);
    } catch (err) {
      before > 0 ? owned.set(id, before) : owned.delete(id); // on revient à l'état réellement enregistré
      draw(`Non enregistré : ${err.message}`);
    }
  }

  const act = (event) => {
    const only = event.target.closest('[data-only]');
    if (only) { prefs.only = only.dataset.only; savePrefs('quickadd', prefs); draw(); return; }
    const tileEl = event.target.closest('.tile.pick');
    if (!tileEl) return;
    const id = Number(tileEl.dataset.id);
    const step = event.target.closest('[data-step]');
    const qty = owned.get(id) ?? 0;
    if (step) change(id, Math.max(0, qty + Number(step.dataset.step)));
    else if (!qty) change(id, 1);
  };
  root.addEventListener('click', act);
  root.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('pick')) { event.preventDefault(); act(event); }
  });
  draw();
}
