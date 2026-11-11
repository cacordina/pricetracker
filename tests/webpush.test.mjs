import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { encryptPayload, vapidToken, sendPush } from '../scripts/lib/webpush.mjs';

const b64u = (b) => Buffer.from(b).toString('base64url');

/** Côté navigateur : déchiffre un message aes128gcm (RFC 8291), écrit indépendamment de l'envoi. */
function decrypt(body, browser, authSecret) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const senderPublic = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const shared = browser.computeSecret(senderPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), browser.getPublicKey(), senderPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, 'délimiteur de dernier bloc');
  return { rs, text: plain.subarray(0, -1).toString() };
}

function browserKeys() {
  const browser = createECDH('prime256v1');
  browser.generateKeys();
  const authSecret = Buffer.from('0123456789abcdef');
  return { browser, authSecret, sub: { endpoint: 'https://push.example.net/abc', p256dh: b64u(browser.getPublicKey()), auth: b64u(authSecret) } };
}

function vapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()), subject: 'mailto:test@example.com' };
}

test('webpush : le navigateur retrouve le message', () => {
  const { browser, authSecret, sub } = browserKeys();
  const message = JSON.stringify({ title: 'Prix cible atteint', body: 'Nymphali ex : 99,38 €' });
  const body = encryptPayload(message, sub);
  assert.deepEqual(decrypt(body, browser, authSecret), { rs: 4096, text: message });
  assert.notDeepEqual(encryptPayload(message, sub), body, 'sel et clé éphémère tirés à chaque envoi');
  assert.throws(() => encryptPayload('x', { p256dh: 'AAAA', auth: sub.auth }), /clés/);
  assert.throws(() => encryptPayload('x'.repeat(5000), sub), /trop long/);
});

test('webpush : jeton VAPID signé pour le service push, vérifiable avec la clé publique', () => {
  const vapid = vapidKeys();
  const now = Date.UTC(2026, 10, 12, 6, 0, 0);
  const [h, c, s] = vapidToken('https://fcm.googleapis.com/fcm/send/xyz', vapid, now).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url')), { aud: 'https://fcm.googleapis.com', exp: now / 1000 + 43200, sub: 'mailto:test@example.com' });
  const pub = Buffer.from(vapid.publicKey, 'base64url');
  const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) } });
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

test('webpush : en-têtes d’envoi et abonnement expiré', async () => {
  const { browser, authSecret, sub } = browserKeys();
  const vapid = vapidKeys();
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: false, status: 410 }; };
  assert.deepEqual(await sendPush(sub, { title: 'x' }, vapid, { fetchImpl }), { ok: false, gone: true, status: 410 });
  assert.equal(seen.url, sub.endpoint);
  assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm');
  assert.match(seen.init.headers.Authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`));
  assert.equal(decrypt(seen.init.body, browser, authSecret).text, '{"title":"x"}');
  const ok = await sendPush(sub, {}, vapid, { fetchImpl: async () => ({ ok: true, status: 201 }) });
  assert.deepEqual(ok, { ok: true, gone: false, status: 201 });
});
