#!/usr/bin/env node
// Notifications après l'enregistrement d'un nouveau jour : alertes de prix cible, et résumé de la collection
// au premier relevé de chaque semaine. Usage : node scripts/notify.mjs --data data
// Variables : SUPABASE_URL, SUPABASE_SERVICE_KEY (clé secrète, lit les envies de tous les comptes),
// VAPID_PRIVATE_KEY (secret), VAPID_SUBJECT (adresse de contact pour les services push).
// La clé publique VAPID est celle du site (site/config.js).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { historyFile } from '../site/lib/model.js';
import { crossings, messages } from './lib/alerts.mjs';
import { isNewWeek, weeklySummaries } from './lib/weekly.mjs';
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

/** Envoie à chaque appareil de chaque compte son message ; retire les appareils désabonnés. */
async function sendToUsers(label, byUser, vapid) {
  if (!byUser.size) return { sent: 0, failed: 0 };
  const subscriptions = await rest(`push_subscriptions?select=user_id,endpoint,p256dh,auth&user_id=in.(${[...byUser.keys()].join(',')})`);
  let sent = 0;
  let failed = 0;
  for (const sub of subscriptions) {
    const result = await sendPush(sub, byUser.get(sub.user_id), vapid).catch((err) => ({ ok: false, gone: false, status: err.message }));
    if (result.ok) sent += 1;
    else if (result.gone) await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' });
    else { failed += 1; console.log(`Envoi refusé : ${result.status}`); }
  }
  console.log(`${label} : ${byUser.size} compte(s) concerné(s), ${sent} notification(s) envoyée(s), ${failed} échec(s), ${subscriptions.length - sent - failed} appareil(s) désabonné(s).`);
  return { sent, failed };
}

try {
  const snapshot = await readJson(join(values.data, 'snapshot.json'));
  const catalog = await readJson(join(values.data, 'catalog.json'));
  const byId = new Map(catalog.cards.map((c) => [c.id, c]));
  catalog.byId = byId;
  const vapid = { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY.trim(), subject: VAPID_SUBJECT || 'mailto:noreply@example.com' };
  let failed = 0;

  // 1. Alertes de prix cible : les envies passées sous leur cible avec ce relevé.
  const wishes = await rest('wishes?select=user_id,id_product,target_cents&target_cents=not.is.null');
  const sets = [...new Set(wishes.map((w) => byId.get(w.id_product)?.s).filter(Boolean))];
  const histories = {};
  for (const set of sets) histories[set] = await readJson(join(values.data, 'history', historyFile(set))).catch(() => null);
  const alerts = messages(crossings({ wishes, byId, histories, date: snapshot.date }));
  if (alerts.size) failed += (await sendToUsers(`${snapshot.date}, alertes`, alerts, vapid)).failed;
  else console.log(`${snapshot.date} : aucune envie n'est passée sous sa cible.`);

  // 2. Résumé hebdomadaire de la collection, au premier relevé d'une nouvelle semaine.
  // Toutes les extensions cotées ont les mêmes dates : celle de la première carte cotée suffit.
  const anySet = byId.get(Number(Object.keys(snapshot.cards)[0]))?.s;
  const dates = anySet ? (await readJson(join(values.data, 'history', historyFile(anySet))).catch(() => null))?.dates ?? [] : [];
  const previous = dates.filter((d) => d < snapshot.date).at(-1) ?? null;
  if (isNewWeek(snapshot.date, previous)) {
    // Seulement les comptes qui ont activé les notifications sur au moins un appareil.
    const users = [...new Set((await rest('push_subscriptions?select=user_id')).map((r) => r.user_id))];
    const holdings = users.length ? await rest(`holdings?select=user_id,id_product,qty&user_id=in.(${users.join(',')})`) : [];
    failed += (await sendToUsers(`${snapshot.date}, résumé de la semaine`, weeklySummaries({ holdings, catalog, snapshot }), vapid)).failed;
  } else {
    console.log(`${snapshot.date} : pas de résumé (même semaine que le relevé du ${previous}).`);
  }
  if (failed) process.exit(1);
} catch (err) {
  console.error(`ÉCHEC : ${err.message}`);
  process.exit(1);
}
