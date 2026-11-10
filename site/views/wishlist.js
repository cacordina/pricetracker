// Écran Envies : cartes convoitées, celles passées sous leur prix cible en tête.
import { loadHistories } from '../lib/data.js';
import { COL, wishStatus, sortWishes, formatEuro } from '../lib/metrics.js';
import { cardRow, cardImg, esc, storeProblem } from '../lib/ui.js';
import { staleBanner, wireStale } from '../lib/migrate.js';

export async function render(root, { catalog, snapshot, store, refresh }) {
  let wishes;
  try {
    wishes = await store.listWishes();
  } catch (err) {
    root.innerHTML = `<h1>Mes envies</h1>${storeProblem(err)}`;
    return;
  }
  if (!wishes.length) {
    root.innerHTML = `<h1>Mes envies</h1>
      <p class="state">Aucune envie pour l’instant.<br>Ouvrez une carte depuis le marché ou la recherche, puis « Ajouter à mes envies » avec un prix cible.</p>
      <a class="btn" href="#/marche">Voir le marché</a>`;
    return;
  }

  const known = wishes.map((w) => catalog.byId.get(w.id_product)).filter(Boolean);
  const histories = await loadHistories(known.map((c) => c.s));
  const items = sortWishes(wishes.map((wish) => {
    const card = catalog.byId.get(wish.id_product) ?? null;
    const row = snapshot.cards[wish.id_product];
    return { wish, card, row, status: wishStatus(wish, row, card ? histories[card.s] : null) };
  }));
  const under = items.filter((i) => i.status.underTarget).length;

  root.innerHTML = `
    <h1>Mes envies</h1>
    ${staleBanner(wishes, catalog.aliases, 'vos envies')}
    <div class="muted">${under
      ? `${under} carte${under > 1 ? 's' : ''} sous votre prix cible`
      : 'Aucune carte sous votre prix cible pour l’instant'}</div>
    ${items.map(line).join('')}`;
  wireStale(root, wishes, catalog.aliases, 'wishes', store, refresh);

  function line({ wish, card, row, status }) {
    if (!card) {
      return `<a class="row" href="#/carte/${wish.id_product}"><div class="noimg" style="width:44px">?</div>
        <div class="name"><b>Carte inconnue (n° ${wish.id_product})</b><div class="muted">Plus dans le catalogue japonais</div></div></a>`;
    }
    const tags = [
      status.underTarget ? '<span class="tag">Sous la cible</span>' : '',
      status.low30 ? '<span class="tag">Au plus bas sur 30 j</span>' : '',
      status.rising && !status.underTarget ? '<span class="tag warn">En hausse</span>' : '',
    ].join(' ');
    const sub = wish.target_cents === null
      ? 'Pas de prix cible'
      : `Cible ${formatEuro(wish.target_cents)}${status.gapCents > 0 ? ` · encore ${formatEuro(status.gapCents)} au-dessus` : ''}`;
    return cardRow(card, catalog.sets, { trend: row?.[COL.trend] ?? null, change: row?.[COL.d7] ?? null, sub: esc(sub), tags });
  }
}
