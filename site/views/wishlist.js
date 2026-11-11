// Écran Envies : cartes convoitées, celles passées sous leur prix cible en tête.
import { loadHistories } from '../lib/data.js';
import { COL, wishStatus, sortWishes, formatEuro, priceOf } from '../lib/metrics.js';
import { cardRow, cardImg, esc, storeProblem } from '../lib/ui.js';
import { staleBanner, wireStale } from '../lib/migrate.js';
import { pushSupport, currentSubscription, enablePush, disablePush } from '../lib/push.js';

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
    <div id="alerts"></div>
    ${items.map(line).join('')}`;
  wireStale(root, wishes, catalog.aliases, 'wishes', store, refresh);
  renderAlerts(root.querySelector('#alerts'), store);

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
    return cardRow(card, catalog.sets, { trend: priceOf(row), change: row?.[COL.d7] ?? null, sub: esc(sub), tags });
  }
}

const SUPPORT_TEXT = {
  'ios-install': 'Sur iPhone, installez d’abord le site sur l’écran d’accueil (Safari → Partager → Sur l’écran d’accueil), puis ouvrez-le depuis son icône.',
  unsupported: 'Ce navigateur ne gère pas les notifications.',
  denied: 'Les notifications sont bloquées pour ce site : autorisez-les dans les réglages du navigateur, puis revenez ici.',
};

/** Interrupteur des alertes de prix cible pour cet appareil ; n'empêche jamais l'affichage des envies. */
async function renderAlerts(box, store) {
  const support = pushSupport();
  if (support === 'config') return;
  let on = false;
  if (support === 'ok') {
    const subscription = await currentSubscription().catch(() => null);
    on = Boolean(subscription);
    // Garde l'abonnement rattaché au compte connecté (il a pu être retiré, ou appartenir à un autre compte).
    if (subscription) store.savePushSubscription(subscription).catch(() => {});
  }

  function draw(message = '') {
    box.innerHTML = `<div class="box">
      <div class="line"><span>${on ? '🔔 Alertes de prix cible activées' : 'Alertes de prix cible'}</span>
        ${support === 'ok' ? `<button type="button" class="link" id="alerts-toggle">${on ? 'Désactiver' : 'Activer'}</button>` : ''}</div>
      <div class="muted" style="margin-top:4px">${support === 'ok'
        ? (on ? 'Une notification sur cet appareil le matin où une carte passe sous sa cible.'
              : 'Recevez une notification sur cet appareil quand une carte passe sous sa cible.')
        : SUPPORT_TEXT[support]}</div>
      ${message ? `<p class="error">${esc(message)}</p>` : ''}</div>`;
    const button = box.querySelector('#alerts-toggle');
    if (!button) return;
    button.onclick = async () => {
      button.disabled = true;
      try {
        if (on) await disablePush(store);
        else await enablePush(store);
        on = !on;
        draw();
      } catch (err) {
        draw(err.message);
      }
    };
  }
  draw();
}
