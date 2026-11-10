// Collection et envies, gardées dans Supabase derrière une connexion.
// Les tables sont protégées par des règles d'accès : chacun ne voit que ses propres lignes.
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

/** code : "config" (Supabase non configuré) | "auth" (connexion requise) | "network" (service injoignable) */
export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const isConfigured = () => Boolean(SUPABASE_URL && SUPABASE_KEY && window.supabase);

let client = null;
function sb() {
  if (!isConfigured()) throw new StoreError('config', 'La sauvegarde en ligne n’est pas encore configurée.');
  client ??= window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}

function fail(error) {
  if (error instanceof StoreError) return error;
  const status = error?.status ?? 0;
  const text = String(error?.message ?? error);
  if (status === 401 || status === 403 || error?.code === 'PGRST301' || error?.code === '42501' || /jwt|not authenticated/i.test(text)) {
    return new StoreError('auth', 'Connexion requise.');
  }
  return new StoreError('network', 'Service indisponible, réessayez.');
}

/** Exécute une requête Supabase et normalise les erreurs. */
async function run(build) {
  let result;
  try {
    result = await build(sb());
  } catch (err) {
    throw fail(err);
  }
  if (result.error) throw fail(result.error);
  return result.data;
}

export async function getSession() {
  if (!isConfigured()) return null;
  try {
    const { data } = await sb().auth.getSession();
    return data.session ?? null;
  } catch {
    return null;
  }
}

async function requireSession() {
  const session = await getSession();
  if (!session) throw isConfigured() ? new StoreError('auth', 'Connexion requise.') : new StoreError('config', 'La sauvegarde en ligne n’est pas encore configurée.');
  return session;
}

export async function signIn(email, password) {
  const { error } = await sb().auth.signInWithPassword({ email, password }).catch((e) => ({ error: e }));
  if (error) throw new StoreError(error.status === 400 ? 'auth' : 'network', error.status === 400 ? 'E-mail ou mot de passe incorrect.' : 'Service indisponible, réessayez.');
}

/** Renvoie true si le compte est utilisable tout de suite, false s'il faut confirmer l'e-mail. */
export async function signUp(email, password) {
  const { data, error } = await sb().auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }).catch((e) => ({ error: e }));
  if (error) {
    const closed = /signups? not allowed|disabled/i.test(error.message ?? '');
    throw new StoreError(closed ? 'auth' : 'network', closed ? 'Les inscriptions sont fermées.' : (error.message || 'Service indisponible, réessayez.'));
  }
  return Boolean(data.session);
}

export async function signOut() {
  if (isConfigured()) await sb().auth.signOut().catch(() => {});
}

/** Prévient quand l'utilisateur connecté change (et non à chaque retour sur l'onglet). */
export function onAuthChange(callback) {
  if (!isConfigured()) return;
  let current;
  sb().auth.onAuthStateChange((event, session) => {
    const user = session?.user?.id ?? null;
    if (event === 'INITIAL_SESSION') { current = user; return; }
    if (user === current) return;
    current = user;
    callback(event);
  });
}

/** @returns {Promise<Array<{ id_product: number, qty: number }>>} */
export async function listHoldings() {
  await requireSession();
  return run((db) => db.from('holdings').select('id_product, qty').order('id_product'));
}

/** Fixe la quantité possédée ; 0 retire la carte. */
export async function setHolding(idProduct, qty) {
  await requireSession();
  if (qty <= 0) {
    await run((db) => db.from('holdings').delete().eq('id_product', idProduct));
  } else {
    await run((db) => db.from('holdings').upsert(
      { id_product: idProduct, qty, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,id_product' },
    ));
  }
}

/** @returns {Promise<Array<{ id_product: number, target_cents: number | null }>>} */
export async function listWishes() {
  await requireSession();
  return run((db) => db.from('wishes').select('id_product, target_cents').order('created_at'));
}

export async function setWish(idProduct, targetCents) {
  await requireSession();
  await run((db) => db.from('wishes').upsert(
    { id_product: idProduct, target_cents: targetCents ?? null },
    { onConflict: 'user_id,id_product' },
  ));
}

export async function removeWish(idProduct) {
  await requireSession();
  await run((db) => db.from('wishes').delete().eq('id_product', idProduct));
}
