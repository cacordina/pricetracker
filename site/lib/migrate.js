// Quand une extension est rattachée à une autre version Cardmarket, ses cartes changent d'identifiant.
// Ce module propose à l'utilisateur de basculer sa collection ou ses envies vers les nouveaux identifiants.
import { staleIds } from './metrics.js';
import { esc } from './ui.js';

/** Bandeau à insérer en haut d'un écran, ou chaîne vide s'il n'y a rien à mettre à jour. */
export function staleBanner(rows, aliases, what) {
  const count = staleIds(rows, aliases).length;
  if (!count) return '';
  return `<div class="banner warn" id="stale">${count} carte${count > 1 ? 's' : ''} de ${esc(what)} ${count > 1 ? 'pointent' : 'pointe'} sur une ancienne référence Cardmarket (extension rattachée à la bonne langue).
    <button type="button" class="btn sec" id="stale-fix" style="margin-top:8px">Mettre à jour ${count > 1 ? 'ces cartes' : 'cette carte'}</button></div>`;
}

/** Branche le bouton du bandeau ; `kind` = "holdings" | "wishes". */
export function wireStale(root, rows, aliases, kind, store, refresh) {
  const button = root.querySelector('#stale-fix');
  if (!button) return;
  button.onclick = async () => {
    button.disabled = true;
    button.textContent = 'Mise à jour…';
    try {
      const byId = new Map(rows.map((r) => [r.id_product, r]));
      for (const { from, to } of staleIds(rows, aliases)) {
        const row = byId.get(from);
        if (kind === 'holdings') {
          const target = byId.get(to);
          await store.setHolding(to, (target?.qty ?? 0) + row.qty); // la nouvelle ligne d'abord : rien n'est perdu en cas d'arrêt
          const hasPurchase = (r) => r && (r.paid_cents !== null && r.paid_cents !== undefined || r.bought_on);
          if (hasPurchase(row) && !hasPurchase(target)) {
            await store.setPurchase(to, { paidCents: row.paid_cents ?? null, boughtOn: row.bought_on ?? null });
          }
          await store.setHolding(from, 0);
        } else {
          if (!byId.has(to)) await store.setWish(to, row.target_cents);
          await store.removeWish(from);
        }
      }
      refresh();
    } catch (err) {
      button.disabled = false;
      button.textContent = `Échec : ${err.message} — réessayer`;
    }
  };
}
