import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wishEvents, messages } from '../scripts/lib/alerts.mjs';
const plainText = (t) => t.replace(/[\u00a0\u202f]/g, ' ');
const crossings = (args) => wishEvents(args).filter((e) => e.kind === 'target'); // passages sous la cible

const cards = [
  { id: 1, s: 'SV8a', n: '212', ja: 'ニンフィアex', fr: 'Nymphali ex' },
  { id: 2, s: 'SV8a', n: '190', ja: 'コルサ', en: 'Brassius' },
  { id: 3, s: 'M2', n: '100', ja: 'リザードン', en: 'Mega Charizard' },
];
const byId = new Map(cards.map((c) => [c.id, c]));
const histories = {
  SV8a: { dates: ['2026-11-09', '2026-11-10', '2026-11-11'], cards: { 1: { p: [12000, 10500, 9900] }, 2: { p: [400, null, 380] } } },
  M2: { dates: ['2026-11-10'], cards: { 3: { p: [5000] } } }, // pas coté le 11
};
const date = '2026-11-11';

test('alertes : seulement le jour où le prix passe sous la cible', () => {
  const wishes = [
    { user_id: 'a', id_product: 1, target_cents: 10000 }, // 10500 → 9900 : passe sous la cible
    { user_id: 'a', id_product: 2, target_cents: 500 },   // déjà sous la cible au relevé précédent (400, le trou est ignoré)
    { user_id: 'b', id_product: 1, target_cents: 9900 },  // atteint pile la cible
    { user_id: 'b', id_product: 1, target_cents: 9000 },  // pas encore
    { user_id: 'c', id_product: 3, target_cents: 6000 },  // extension pas cotée ce jour-là
    { user_id: 'c', id_product: 1, target_cents: null },  // pas de cible
    { user_id: 'c', id_product: 99, target_cents: 100 },  // carte inconnue
  ];
  assert.deepEqual(crossings({ wishes, byId, histories, date }).map((c) => [c.userId, c.card.id, c.trend, c.target]),
    [['a', 1, 9900, 10000], ['b', 1, 9900, 9900]]);
});

test('alertes : une carte tout juste cotée et déjà sous la cible déclenche une alerte', () => {
  const h = { SV8a: { dates: ['2026-11-10', '2026-11-11'], cards: { 2: { p: [null, 300], t: [null, 310] } } } };
  assert.equal(crossings({ wishes: [{ user_id: 'a', id_product: 2, target_cents: 500 }], byId, histories: h, date }).length, 1);
});

test('alertes : pas d’alerte en masse le jour où la série du prix retenu apparaît', () => {
  const h = { SV8a: { dates: ['2026-11-10', '2026-11-11'], cards: { 2: { p: [null, 300], t: [280, 290] } } } };
  assert.equal(crossings({ wishes: [{ user_id: 'a', id_product: 2, target_cents: 500 }], byId, histories: h, date }).length, 0);
});

test('alertes : un message par compte, résumé au-delà d’une carte', () => {
  const card = (id) => byId.get(id);
  const plain = (m) => ({ ...m, body: m.body.replace(/[\u00a0\u202f]/g, ' ') }); // formatEuro met des espaces insécables
  const out = messages([
    { userId: 'a', card: card(1), trend: 9900, target: 10000 },
    { userId: 'b', card: card(2), trend: 380, target: 500 },
    { userId: 'b', card: card(1), trend: 9900, target: 9900 },
  ]);
  assert.deepEqual(plain(out.get('a')), { title: 'Prix cible atteint', body: 'Nymphali ex (SV8a 212) : 99,00 €, cible 100,00 €', url: '#/carte/1', tag: 'envie-1' });
  assert.equal(out.get('b').title, '2 cartes sous votre prix cible');
  assert.equal(out.get('b').url, '#/envies');
  assert.match(plain(out.get('b')).body, /^Brassius 3,80 € · Nymphali ex 99,00 €$/); // la plus grosse marge sous la cible d'abord
});

// Historique de 40 jours : prix stable autour de 120 €, puis ce qui est testé le dernier jour.
const day = (i) => new Date(Date.UTC(2026, 9, 3) + i * 86400000).toISOString().slice(0, 10);
const long = (last, beforeLast = null) => {
  const dates = Array.from({ length: 40 }, (_, i) => day(i));
  const p = dates.map((_, i) => 12000 + (i % 3) * 100);
  if (beforeLast !== null) p[38] = beforeLast;
  p[39] = last;
  return { dates, p };
};
const hist = ({ dates, p }) => ({ SV8a: { dates, cards: { 1: { p } } } });

test('alertes : une envie sans cible prévient le jour où elle devient la moins chère depuis 30 jours', () => {
  const h = long(9000);
  const events = wishEvents({ wishes: [{ user_id: 'a', id_product: 1, target_cents: null }], byId, histories: hist(h), date: h.dates.at(-1) });
  assert.deepEqual(events.map((e) => [e.kind, e.days, e.gapPct]), [['low', 30, -25.6]]);
  const msg = messages(events).get('a');
  assert.equal(msg.title, 'Au plus bas depuis 30 jours');
  assert.match(plainText(msg.body), /^Nymphali ex \(SV8a 212\) : 90,00 €, −25,6 % sous sa médiane sur 30 jours$/);
  // Déjà au plus bas la veille : pas de nouvelle alerte.
  const again = long(8900, 9000);
  assert.equal(wishEvents({ wishes: [{ user_id: 'a', id_product: 1, target_cents: null }], byId, histories: hist(again), date: again.dates.at(-1) }).length, 0);
});

test('alertes : baisse de 15 % en 7 jours, prévenue une fois', () => {
  const dates = Array.from({ length: 12 }, (_, i) => day(i));
  const p = dates.map(() => 10000); p[11] = 8400; // −16 % : pas d'historique de 30 jours, donc pas « au plus bas »
  const events = wishEvents({ wishes: [{ user_id: 'a', id_product: 1, target_cents: null }], byId, histories: hist({ dates, p }), date: dates.at(-1) });
  assert.deepEqual(events.map((e) => [e.kind, e.change]), [['drop', -16]]);
  assert.equal(messages(events).get('a').title.replace(/[\u00a0\u202f]/g, ' '), '−16,0 % en 7 jours');
  const p2 = [...p]; p2[10] = 8400; p2[11] = 8300; // déjà −16 % la veille
  assert.equal(wishEvents({ wishes: [{ user_id: 'a', id_product: 1, target_cents: null }], byId, histories: hist({ dates, p: p2 }), date: dates.at(-1) }).length, 0);
});

test('alertes : une seule par carte, le prix cible d’abord ; message groupé si plusieurs cartes', () => {
  const h = long(9000);
  const events = wishEvents({ byId, histories: hist(h), date: h.dates.at(-1), wishes: [
    { user_id: 'a', id_product: 1, target_cents: 9500 }, // sous la cible ET au plus bas : une alerte « cible »
  ] });
  assert.deepEqual(events.map((e) => e.kind), ['target']);
  const two = messages([
    { userId: 'b', card: byId.get(1), kind: 'low', trend: 9000, days: 30, gapPct: -25.6 },
    { userId: 'b', card: byId.get(2), kind: 'drop', trend: 300, change: -20 },
  ]).get('b');
  assert.equal(two.title, '2 cartes de vos envies à surveiller');
  assert.equal(plainText(two.body), 'Nymphali ex au plus bas 30 j · Brassius −20,0 %');
  assert.equal(two.url, '#/envies');
});
