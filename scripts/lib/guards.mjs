/**
 * Garde-fous avant d'ajouter un jour à l'historique.
 * { ok: true } | { ok: false, skip, reason } — skip = rien à faire (jour déjà enregistré), pas une erreur.
 */
export const MIN_PRICED_RATIO = 0.8;

export function checkDay({ date, lastDate, pricedCount, lastPricedCount }) {
  const refuse = (reason, skip = false) => ({ ok: false, skip, reason });
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return refuse('Date du fichier de prix illisible');
  if (lastDate && date === lastDate) return refuse(`Jour ${date} déjà enregistré`, true);
  if (lastDate && date < lastDate) return refuse(`Fichier de prix daté du ${date}, antérieur au dernier jour connu ${lastDate}`);
  if (!pricedCount) return refuse('Aucune carte japonaise cotée dans le fichier de prix');
  if (lastPricedCount && pricedCount < lastPricedCount * MIN_PRICED_RATIO) {
    return refuse(`Seulement ${pricedCount} cartes cotées contre ${lastPricedCount} la veille (seuil ${MIN_PRICED_RATIO * 100} %)`);
  }
  return { ok: true };
}
