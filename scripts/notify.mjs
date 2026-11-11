#!/usr/bin/env node
// Notifications de prix cible, après l'enregistrement d'un nouveau jour : node scripts/notify.mjs --data data
// Variables : SUPABASE_URL, SUPABASE_SERVICE_KEY (clé secrète, lit les envies de tous les comptes),
// VAPID_PRIVATE_KEY (secret), VAPID_SUBJECT (adresse de contact pour les services push).
// La clé publique VAPID est celle du site (site/config.js).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { historyFile } from './ingest.mjs';
import { crossings, messages } from './lib/alerts.mjs';
import { sendPush } from './lib/webpush.mjs';
import { VAPID_PUBLIC_KEY } from '../site/config.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' } } });
const { SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;

const missing = Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.log(`Notifications non configurées (manque : ${missing.join(', ')}). Rien à envoyer.`);
  process.exit(0);
}

// Les nouvelles clés Supabase (sb_secret_…) passent seules ; les anciennes (JWT) aussi en Authorization.
const headers = { apikey: SUPABASE_SERVICE_KEY };
if (!SUPABASE_SERVICE_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${SUPABASE_SERVICE_KEY}`;
const rest = async (path, init = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
  if (!res.ok) throw new Error(`Supabase ${path.split('?')[0]} : HTTP ${res.status} ${await res.text()}`);
  return init.method === 'DELETE' ? null : res.json();
};
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

try {
  const snapshot = await readJson(join(values.data, 'snapshot.json'));
  const catalog = await readJson(join(values.data, 'catalog.json'));
  const byId = new Map(catalog.cards.map((c) => [c.id, c]));

  const wishes = await rest('wishes?select=user_id,id_product,target_cents&target_cents=not.is.null');
  const sets = [...new Set(wishes.map((w) => byId.get(w.id_product)?.s).filter(Boolean))];
  const histories = {};
  for (const set of sets) histories[set] = await readJson(join(values.data, 'history', historyFile(set))).catch(() => null);

  const byUser = messages(crossings({ wishes, byId, histories, date: snapshot.date }));
  if (!byUser.size) {
    console.log(`${snapshot.date} : aucune envie n'est passée sous sa cible.`);
    process.exit(0);
  }

  const subscriptions = await rest(`push_subscriptions?select=user_id,endpoint,p256dh,auth&user_id=in.(${[...byUser.keys()].join(',')})`);
  const vapid = { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY.trim(), subject: VAPID_SUBJECT || 'mailto:noreply@example.com' };
  let sent = 0;
  let failed = 0;
  for (const sub of subscriptions) {
    const result = await sendPush(sub, byUser.get(sub.user_id), vapid).catch((err) => ({ ok: false, gone: false, status: err.message }));
    if (result.ok) sent += 1;
    else if (result.gone) await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' });
    else { failed += 1; console.log(`Envoi refusé : ${result.status}`); }
  }
  console.log(`${snapshot.date} : ${byUser.size} compte(s) concerné(s), ${sent} notification(s) envoyée(s), ${failed} échec(s), ${subscriptions.length - sent - failed} appareil(s) désabonné(s).`);
  if (failed) process.exit(1);
} catch (err) {
  console.error(`ÉCHEC : ${err.message}`);
  process.exit(1);
}
