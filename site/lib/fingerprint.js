// Empreintes d'image des cartes, pour les reconnaître à leur image (scanner). Le même code tourne sur GitHub
// (construction de l'index, à partir des images du catalogue) et sur le téléphone (photo de la carte) : les
// empreintes sont donc comparables. Entrée : pixels RGBA (Uint8ClampedArray / Uint8Array), largeur, hauteur.
//
// Méthode : hachage perceptuel (pHash) — l'image réduite en 32×32 niveaux de gris, transformée en fréquences (DCT),
// et les 63 basses fréquences comparées à leur médiane donnent 64 bits. Deux images proches ont peu de bits
// différents (distance de Hamming). Deux empreintes par carte : la carte entière, et la zone de l'illustration.

/** Zone de l'illustration sur une carte Pokémon (en proportion de la largeur et de la hauteur). */
export const ART = { x: 0.08, y: 0.1, w: 0.84, h: 0.42 };

/**
 * Niveaux de gris réduits par moyenne de surface (chaque pixel de sortie = moyenne des pixels qu'il couvre),
 * sur la région { x, y, w, h } (en proportions) de l'image.
 */
export function grayResize(rgba, width, height, outW, outH, region = { x: 0, y: 0, w: 1, h: 1 }) {
  const x0 = region.x * width;
  const y0 = region.y * height;
  const sw = (region.w * width) / outW;
  const sh = (region.h * height) / outH;
  const out = new Float64Array(outW * outH);
  for (let oy = 0; oy < outH; oy++) {
    const ya = y0 + oy * sh;
    const yb = ya + sh;
    for (let ox = 0; ox < outW; ox++) {
      const xa = x0 + ox * sw;
      const xb = xa + sw;
      let sum = 0;
      let weight = 0;
      for (let y = Math.floor(ya); y < Math.ceil(yb) && y < height; y++) {
        const wy = Math.min(yb, y + 1) - Math.max(ya, y);
        for (let x = Math.floor(xa); x < Math.ceil(xb) && x < width; x++) {
          const w = wy * (Math.min(xb, x + 1) - Math.max(xa, x));
          const i = (y * width + x) * 4;
          sum += w * (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
          weight += w;
        }
      }
      out[oy * outW + ox] = weight ? sum / weight : 0;
    }
  }
  return out;
}

const N = 32;
// Coefficients de la DCT 32 points, calculés une fois.
const COS = (() => {
  const c = new Float64Array(N * N);
  for (let k = 0; k < N; k++) for (let n = 0; n < N; n++) c[k * N + n] = Math.cos((Math.PI / N) * (n + 0.5) * k);
  return c;
})();

/** pHash 64 bits (Uint8Array de 8 octets) d'une image 32×32 en niveaux de gris. */
export function phash(gray32) {
  // DCT en deux passes (lignes puis colonnes), seulement les 8 premières fréquences dans chaque sens.
  const rows = new Float64Array(N * 8);
  for (let y = 0; y < N; y++) {
    for (let k = 0; k < 8; k++) {
      let s = 0;
      for (let x = 0; x < N; x++) s += gray32[y * N + x] * COS[k * N + x];
      rows[y * 8 + k] = s;
    }
  }
  const freq = new Float64Array(64);
  for (let k = 0; k < 8; k++) {
    for (let j = 0; j < 8; j++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += rows[y * 8 + j] * COS[k * N + y];
      freq[k * 8 + j] = s;
    }
  }
  const ac = [...freq.slice(1)].sort((a, b) => a - b); // sans la composante continue (luminosité moyenne)
  const median = (ac[31] + ac[32]) / 2;
  const bits = new Uint8Array(8);
  for (let i = 1; i < 64; i++) if (freq[i] > median) bits[i >> 3] |= 1 << (i & 7);
  return bits;
}

/** Empreintes d'une carte : la carte entière et son illustration. */
export function cardFingerprint(rgba, width, height) {
  return {
    full: phash(grayResize(rgba, width, height, N, N)),
    art: phash(grayResize(rgba, width, height, N, N, ART)),
  };
}

const POP = Uint8Array.from({ length: 256 }, (_, i) => { let c = 0; for (let v = i; v; v >>= 1) c += v & 1; return c; });

/** Nombre de bits différents entre deux empreintes de 8 octets (lues à partir de `offset` dans `b`). */
export function hamming(a, b, offset = 0) {
  let d = 0;
  for (let i = 0; i < 8; i++) d += POP[a[i] ^ b[offset + i]];
  return d;
}

/**
 * Index des empreintes : un bloc de 20 octets par carte (identifiant Cardmarket sur 4 octets, puis empreinte
 * de la carte entière et de l'illustration, 8 octets chacune).
 */
export const RECORD = 20;

export function encodeIndex(entries) {
  const out = new Uint8Array(entries.length * RECORD);
  const view = new DataView(out.buffer);
  entries.forEach(({ id, full, art }, i) => {
    view.setUint32(i * RECORD, id, true);
    out.set(full, i * RECORD + 4);
    out.set(art, i * RECORD + 12);
  });
  return out;
}

/**
 * Les cartes les plus proches d'une empreinte, de la plus proche à la moins proche.
 * Distance = carte entière + illustration (0 à 128). `only` : identifiants à considérer (ex. numéro lu), ou null.
 */
export function nearest(index, fp, { limit = 5, only = null } = {}) {
  const view = new DataView(index.buffer, index.byteOffset, index.byteLength);
  const out = [];
  for (let o = 0; o + RECORD <= index.byteLength; o += RECORD) {
    const id = view.getUint32(o, true);
    if (only && !only.has(id)) continue;
    const full = hamming(fp.full, index, o + 4);
    const art = hamming(fp.art, index, o + 12);
    out.push({ id, distance: full + art, full, art });
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, limit);
}
