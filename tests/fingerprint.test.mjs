import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HASH_BITS, HASH_BYTES, RECORD, boxDownscale, computeDCT, colorHash, hashToString, hamming, encodeIndex, nearest, confidence,
  trimBorders, cropRGBA, thumbnail, thumbnailDistance, scanHash, SCAN_BYTES, SCAN_MAX_DISTANCE,
} from '../site/lib/fingerprint.js';

/** Image RGBA fabriquée : formes et couleurs tirées d'une graine (une « carte »), plus des retouches. */
function card(seed, { w = 120, h = 168, light = 0, noise = 0 } = {}) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const blobs = Array.from({ length: 6 }, () => ({ x: rnd(), y: rnd(), r: 0.08 + rnd() * 0.3, c: [rnd() * 255, rnd() * 255, rnd() * 255] }));
  const px = new Uint8ClampedArray(w * h * 4);
  let n = 12345;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = [40, 40, 60];
    for (const b of blobs) if ((x / w - b.x) ** 2 + ((y / h - b.y) * 1.4) ** 2 < b.r ** 2) c = b.c;
    n = (n * 1103515245 + 12345) % 2 ** 31;
    const jitter = noise ? ((n / 2 ** 31) - 0.5) * noise : 0;
    const i = (y * w + x) * 4;
    px[i] = c[0] + light + jitter; px[i + 1] = c[1] + light + jitter; px[i + 2] = c[2] + light + jitter; px[i + 3] = 255;
  }
  return { px, w, h };
}
const hash = ({ px, w, h }) => colorHash(px, w, h);

// Tests repris de pokemonpocket-v2 (imageHashService.test.ts).
test('DCT : signal constant, coefficients de fréquence nuls', () => {
  const dct = computeDCT(new Array(64).fill(100), 8);
  assert.equal(dct.length, 64);
  for (let i = 1; i < 64; i++) assert.ok(Math.abs(dct[i]) < 1e-9);
  // Calcul limité aux basses fréquences : mêmes valeurs que le calcul complet.
  const pixels = Array.from({ length: 64 }, (_, i) => (i * 37) % 255);
  const full = computeDCT(pixels, 8);
  const part = computeDCT(pixels, 8, 3);
  for (let u = 0; u < 3; u++) for (let v = 0; v < 3; v++) assert.equal(part[u * 8 + v], full[u * 8 + v]);
});

test('réduction par blocs', () => {
  const px = new Uint8ClampedArray(2 * 2 * 4).fill(100);
  assert.deepEqual(boxDownscale(px, 2, 2, 1), { r: [100], g: [100], b: [100] });
  const mixed = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
  assert.deepEqual(boxDownscale(mixed, 2, 2, 2), { r: [10, 40, 70, 100], g: [20, 50, 80, 110], b: [30, 60, 90, 120] });
});

test('empreinte : 105 bits, texte au format de pokemonpocket-v2', () => {
  const h = hash(card(7));
  assert.equal(HASH_BITS, 105);
  assert.equal(h.length, HASH_BYTES);
  const s = hashToString(h);
  assert.match(s, /^[01]{105}$/);
});

test('empreinte : stable (clarté, bruit, résolution), différente pour une autre carte', () => {
  const a = hash(card(7));
  assert.ok(hamming(a, hash(card(7, { light: 25 }))) <= 6, 'plus claire');
  assert.ok(hamming(a, hash(card(7, { noise: 30 }))) <= 8, 'bruitée');
  assert.ok(hamming(a, hash(card(7, { w: 240, h: 336 }))) <= 8, 'autre résolution');
  assert.ok(hamming(a, hash(card(7, { w: 97, h: 135 }))) <= 10, 'résolution non multiple');
  const others = [11, 23, 42, 99].map((s) => hamming(a, hash(card(s))));
  assert.ok(Math.min(...others) >= 20, `autres cartes trop proches : ${others}`);
});

test('empreinte de scan et index : la carte se retrouve en tête, filtre par identifiants', () => {
  const scan = ({ px, w, h }) => scanHash(px, w, h);
  assert.equal(scan(card(7)).length, SCAN_BYTES);
  const entries = [7, 11, 23, 42].map((seed, i) => ({ id: 1000 + i, hash: scan(card(seed)) }));
  const index = encodeIndex(entries);
  assert.equal(index.length, 4 * RECORD);
  const found = nearest(index, scan(card(23, { light: 20, noise: 20 })), { limit: 2 });
  assert.equal(found.length, 2);
  assert.equal(found[0].id, 1002);
  assert.ok(found[0].distance < found[1].distance);
  assert.ok(found[0].distance <= SCAN_MAX_DISTANCE);
  assert.equal(nearest(index, scan(card(23)))[0].confidence, 100);
  assert.deepEqual(nearest(index, scan(card(23)), { only: new Set([1000, 1003]) }).map((r) => r.id).sort(), [1000, 1003]);
  assert.equal(confidence(21), 80);
});

test('recadrage : la photo et l’image du catalogue arrivent au même cadre', () => {
  // Carte 63×88 : bord jaune de 4 pixels, puis un intérieur varié (bandes de couleurs) ; sur une table grise (marge m).
  const draw = (W, H, m) => {
    const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const cx = x - m, cy = y - m;
      const inCard = cx >= 0 && cx < 63 && cy >= 0 && cy < 88;
      const inner = cx >= 4 && cx < 59 && cy >= 4 && cy < 84;
      const c = !inCard ? [90, 90, 90] : !inner ? [240, 200, 40] : [[200, 60, 60], [30, 60, 200], [20, 160, 70]][(cx + cy) % 3];
      px.set([...c, 255], (y * W + x) * 4);
    }
    return px;
  };
  const abs = (r, W, H, m) => [r.x * W - m, r.y * H - m, r.w * W, r.h * H].map(Math.round);
  const photo = abs(trimBorders(draw(83, 108, 10), 83, 108), 83, 108, 10);
  const scan = abs(trimBorders(draw(63, 88, 0), 63, 88), 63, 88, 0);
  assert.deepEqual(photo, scan);
  assert.deepEqual(scan, [4, 4, 55, 80]); // sans le bord jaune
  // Bande qui n'a pas les proportions d'une carte : rien n'est rogné.
  const px = draw(83, 108, 10);
  const wide = cropRGBA(px, 83, 108, { x: 0, y: 0.3, w: 1, h: 0.4 });
  assert.deepEqual(trimBorders(wide.rgba, wide.width, wide.height), { x: 0, y: 0, w: 1, h: 1 });
});

test('vignette : insensible à la luminosité', () => {
  const a = card(7), b = card(7, { light: 30 }), c = card(11);
  const ta = thumbnail(a.px, a.w, a.h);
  assert.ok(thumbnailDistance(ta, thumbnail(b.px, b.w, b.h)) < 0.05);
  assert.ok(thumbnailDistance(ta, thumbnail(c.px, c.w, c.h)) > 0.5);
});

test('reflets : la tache blanche est bouchée avec la couleur de la zone', async () => {
  const { maskGlare, glareShare } = await import('../site/lib/fingerprint.js');
  const a = card(7);
  const shiny = new Uint8ClampedArray(a.px);
  // Tache blanche au centre (un dixième de l'image environ).
  for (let y = 60; y < 110; y++) for (let x = 35; x < 85; x++) { const i = (y * a.w + x) * 4; shiny[i] = shiny[i + 1] = shiny[i + 2] = 250; }
  assert.ok(glareShare(shiny, a.w, a.h) > 0.1);
  const fixed = maskGlare(shiny, a.w, a.h);
  assert.ok(fixed.share > 0.1);
  assert.equal(glareShare(fixed.rgba, a.w, a.h), 0);
  const d = (x) => hamming(scanHash(a.px, a.w, a.h), scanHash(x, a.w, a.h), 0, SCAN_BYTES);
  assert.ok(d(fixed.rgba) < d(shiny), `bouché ${d(fixed.rgba)} contre ${d(shiny)}`);
  // Sans reflet : image inchangée.
  assert.equal(maskGlare(a.px, a.w, a.h).rgba, a.px);
});
