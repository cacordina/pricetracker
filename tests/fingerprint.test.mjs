import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grayResize, phash, cardFingerprint, hamming, encodeIndex, nearest } from '../site/lib/fingerprint.js';

/** Image RGBA fabriquée : formes et couleurs tirées d'une graine (une « carte »), plus des retouches. */
function card(seed, { w = 120, h = 168, light = 0, noise = 0 } = {}) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const blobs = Array.from({ length: 6 }, () => ({ x: rnd() * w, y: rnd() * h, r: 10 + rnd() * 40, c: [rnd() * 255, rnd() * 255, rnd() * 255] }));
  const px = new Uint8ClampedArray(w * h * 4);
  let n = 12345;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = [40, 40, 60];
    for (const b of blobs) if ((x - b.x) ** 2 + (y - b.y) ** 2 < b.r ** 2) c = b.c;
    n = (n * 1103515245 + 12345) % 2 ** 31;
    const jitter = noise ? ((n / 2 ** 31) - 0.5) * noise : 0;
    const i = (y * w + x) * 4;
    px[i] = c[0] + light + jitter; px[i + 1] = c[1] + light + jitter; px[i + 2] = c[2] + light + jitter; px[i + 3] = 255;
  }
  return { px, w, h };
}
const fp = ({ px, w, h }) => cardFingerprint(px, w, h);

test('réduction en niveaux de gris par moyenne de surface', () => {
  const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]); // 2×2 : noir, blanc / noir, blanc
  assert.deepEqual([...grayResize(px, 2, 2, 1, 1)].map(Math.round), [128]);
  assert.deepEqual([...grayResize(px, 2, 2, 2, 1)].map(Math.round), [0, 255]);
  assert.deepEqual([...grayResize(px, 2, 2, 1, 1, { x: 0.5, y: 0, w: 0.5, h: 1 })].map(Math.round), [255]);
});

test('empreinte : stable si la photo est plus claire ou bruitée, différente pour une autre carte', () => {
  const a = fp(card(7));
  assert.equal(phash(grayResize(card(7).px, 120, 168, 32, 32)).length, 8);
  assert.ok(hamming(a.full, fp(card(7, { light: 25 })).full) <= 4, 'plus claire');
  assert.ok(hamming(a.full, fp(card(7, { noise: 30 })).full) <= 8, 'bruitée');
  const others = [11, 23, 42, 99].map((s) => hamming(a.full, fp(card(s)).full));
  assert.ok(Math.min(...others) >= 16, `autres cartes trop proches : ${others}`);
});

test('index : la carte se retrouve en tête, filtre par identifiants', () => {
  const entries = [7, 11, 23, 42].map((seed, i) => ({ id: 1000 + i, ...fp(card(seed)) }));
  const index = encodeIndex(entries);
  assert.equal(index.length, 4 * 20);
  const found = nearest(index, fp(card(23, { light: 20, noise: 20 })), { limit: 2 });
  assert.equal(found[0].id, 1002);
  assert.ok(found[0].distance < found[1].distance);
  assert.deepEqual(nearest(index, fp(card(23)), { only: new Set([1000, 1003]) }).map((r) => r.id).sort(), [1000, 1003]);
});

// Connu : cette première version (réduction par surface fractionnaire) n'est pas assez stable quand la
// résolution change. À remplacer par l'empreinte couleur de pokemonpocket-v2 (réduction par blocs, éprouvée).
test('empreinte : stable quand la résolution de la photo change', { todo: 'prototype : remplacer par l’empreinte couleur de pokemonpocket-v2' }, () => {
  assert.ok(hamming(fp(card(7)).full, fp(card(7, { w: 240, h: 336 })).full) <= 6, 'autre résolution');
});
