// Fausse sauvegarde (à la place de site/lib/store.js) pour les tests des écrans : un utilisateur connecté,
// qui possède les trois premières AR du catalogue et en a une en envie. Tout reste en mémoire.
export class StoreError extends Error {}
export const isConfigured = () => true;
export const configProblem = () => '';
export const getSession = async () => ({ user: { id: 'test' } });
export const onAuthChange = () => {};
export const signIn = async () => {};
export const signUp = async () => true;
export const signOut = async () => {};

const holdings = new Map();
const wishes = new Map();
const ready = fetch('./data/catalog.json').then((r) => r.json()).then((catalog) => {
  const ar = catalog.cards.filter((c) => c.r === 'AR');
  ar.slice(0, 3).forEach((c, i) => holdings.set(c.id, { id_product: c.id, qty: i + 1, paid_cents: i ? null : 500, bought_on: null }));
  wishes.set(ar[5].id, { id_product: ar[5].id, target_cents: 1 });
});
window.__store = { holdings, wishes };

export const listHoldings = async () => { await ready; return [...holdings.values()].map((h) => ({ ...h })); };
export async function setHolding(id, qty) {
  if (qty <= 0) holdings.delete(id);
  else holdings.set(id, { paid_cents: null, bought_on: null, ...holdings.get(id), id_product: id, qty });
}
export async function setPurchase(id, { paidCents, boughtOn }) { Object.assign(holdings.get(id), { paid_cents: paidCents, bought_on: boughtOn }); }
export const listWishes = async () => { await ready; return [...wishes.values()].map((w) => ({ ...w })); };
export async function setWish(id, target) { wishes.set(id, { id_product: id, target_cents: target }); }
export async function removeWish(id) { wishes.delete(id); }
export async function savePushSubscription() {}
export async function removePushSubscription() {}
