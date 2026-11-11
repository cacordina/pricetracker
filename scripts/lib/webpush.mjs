/**
 * Envoi de notifications Web Push sans dépendance : chiffrement du message (RFC 8291, aes128gcm)
 * et signature VAPID (RFC 8292) avec node:crypto.
 */
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (text) => Buffer.from(text, 'base64url');
const RECORD_SIZE = 4096;

/**
 * Chiffre `payload` pour un abonnement (clés `p256dh` et `auth` fournies par le navigateur).
 * `salt` et `senderPrivate` ne servent qu'aux tests ; sinon ils sont tirés au hasard à chaque envoi.
 */
export function encryptPayload(payload, { p256dh, auth }, { salt = randomBytes(16), senderPrivate = null } = {}) {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Abonnement push invalide (clés)');

  const sender = createECDH('prime256v1');
  if (senderPrivate) sender.setPrivateKey(senderPrivate);
  else sender.generateKeys();
  const asPublic = sender.getPublicKey();
  const shared = sender.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // 2 = dernier (et seul) bloc
  if (plain.length + 16 > RECORD_SIZE) throw new Error('Message push trop long');
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** Jeton VAPID signé (ES256) pour le service push qui héberge `endpoint`. */
export function vapidToken(endpoint, { publicKey, privateKey, subject }, now = Date.now()) {
  const pub = unb64u(publicKey);
  const key = createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
  });
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${b64u(signature)}`;
}

/**
 * Envoie un message à un abonnement { endpoint, p256dh, auth }.
 * @returns {Promise<{ ok: boolean, gone: boolean, status: number }>} gone : abonnement expiré, à supprimer.
 */
export async function sendPush(subscription, payload, vapid, { fetchImpl = fetch, ttl = 86400 } = {}) {
  const body = encryptPayload(JSON.stringify(payload), subscription);
  const res = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${vapidToken(subscription.endpoint, vapid)}, k=${vapid.publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'normal',
    },
    body,
  });
  return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status };
}
