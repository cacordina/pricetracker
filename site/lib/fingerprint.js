// Empreintes d'image des cartes, pour les reconnaître à leur image (scanner). Le même code tourne sur GitHub
// (empreintes du catalogue, à partir des images des cartes) et sur le téléphone (photo cadrée de la carte) :
// les empreintes sont donc comparables.
//
// Méthode reprise du scanner de pokemonpocket-v2 (src/features/scan/services/imageHashService.ts), éprouvée :
// hachage perceptuel couleur — l'image réduite à 24×24 par moyenne de blocs (déterministe, indépendante du
// navigateur), transformée en fréquences (DCT) sur chaque canal R, V, B ; les 35 basses fréquences de chaque
// canal (6×6 sans la composante continue) comparées à leur moyenne donnent 105 bits. Deux images proches ont
// peu de bits différents (distance de Hamming). Seule différence : on ne calcule que les 36 coefficients utiles
// (mêmes opérations, dans le même ordre : résultat identique), ce qui va environ 15 fois plus vite.

export const HASH_SIZE = 24;
export const FREQ_SIZE = 6;
export const HASH_BITS = (FREQ_SIZE * FREQ_SIZE - 1) * 3; // 105
export const HASH_BYTES = Math.ceil(HASH_BITS / 8); // 14

// Seuils de pokemonpocket-v2 (en % de ressemblance), à recalibrer sur des photos de vraies cartes.
export const RECOGNITION_THRESHOLD = 78; // au-dessus : carte reconnue
export const DISPLAY_MIN_CONFIDENCE = 75; // en dessous : trop incertain pour proposer la carte

/**
 * Réduction déterministe (moyenne par blocs) d'une image RGBA vers size×sizeY (carré par défaut), par canal.
 * Identique à boxDownscale de pokemonpocket-v2 pour une sortie carrée.
 */
export function boxDownscale(data, w, h, size, sizeY = size) {
  const r = new Array(size * sizeY);
  const g = new Array(size * sizeY);
  const b = new Array(size * sizeY);
  for (let ty = 0; ty < sizeY; ty++) {
    const y0 = Math.floor((ty * h) / sizeY);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / sizeY));
    for (let tx = 0; tx < size; tx++) {
      const x0 = Math.floor((tx * w) / size);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / size));
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++;
        }
      }
      const idx = ty * size + tx;
      r[idx] = sr / n; g[idx] = sg / n; b[idx] = sb / n;
    }
  }
  return { r, g, b };
}

/**
 * DCT de pokemonpocket-v2 (computeDCT), limitée aux fréquences u, v < keep : les autres valent 0.
 * Pour les coefficients calculés, mêmes opérations dans le même ordre, donc mêmes valeurs.
 */
export function computeDCT(pixels, n, keep = n) {
  const result = new Array(n * n).fill(0);
  for (let u = 0; u < keep; u++) {
    for (let v = 0; v < keep; v++) {
      let sum = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          sum += pixels[y * n + x]
            * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n))
            * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * n));
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      result[u * n + v] = ((2 * cu * cv) / n) * sum;
    }
  }
  return result;
}

/**
 * Empreinte couleur d'une image RGBA, dans l'ordre des bits de pokemonpocket-v2 : 105 bits (14 octets) par défaut,
 * (freq² − 1) × 3 bits avec l'option `freq`.
 */
export function colorHash(rgba, width, height, { size = HASH_SIZE, freq = FREQ_SIZE } = {}) {
  const { r, g, b } = boxDownscale(rgba, width, height, size);
  const dct = [r, g, b].map((channel) => computeDCT(channel, size, freq));
  const avg = dct.map((d) => {
    let sum = 0, count = 0;
    for (let y = 0; y < freq; y++) for (let x = 0; x < freq; x++) {
      if (!(x === 0 && y === 0)) { sum += d[y * size + x]; count++; }
    }
    return sum / count;
  });
  const bytes = new Uint8Array(Math.ceil(((freq * freq - 1) * 3) / 8));
  let bit = 0;
  for (let y = 0; y < freq; y++) {
    for (let x = 0; x < freq; x++) {
      if (x === 0 && y === 0) continue;
      const pos = y * size + x;
      for (let c = 0; c < 3; c++, bit++) if (dct[c][pos] > avg[c]) bytes[bit >> 3] |= 1 << (bit & 7);
    }
  }
  return bytes;
}

/** Empreinte en texte « 0101… » (105 caractères), le format stocké par pokemonpocket-v2. */
export function hashToString(bytes) {
  let s = '';
  for (let bit = 0; bit < HASH_BITS; bit++) s += (bytes[bit >> 3] >> (bit & 7)) & 1 ? '1' : '0';
  return s;
}

const POP = Uint8Array.from({ length: 256 }, (_, i) => { let c = 0; for (let v = i; v; v >>= 1) c += v & 1; return c; });

/** Nombre de bits différents entre deux empreintes (la seconde lue à partir de `offset` dans `b`). */
export function hamming(a, b, offset = 0, bytes = HASH_BYTES) {
  let d = 0;
  for (let i = 0; i < bytes; i++) d += POP[a[i] ^ b[offset + i]];
  return d;
}

/** Partie d'une image RGBA (rectangle en fractions de la largeur et de la hauteur). */
export function cropRGBA(rgba, width, height, { x = 0, y = 0, w = 1, h = 1 }) {
  const x0 = Math.round(x * width), y0 = Math.round(y * height);
  const cw = Math.max(1, Math.min(width - x0, Math.round(w * width)));
  const ch = Math.max(1, Math.min(height - y0, Math.round(h * height)));
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let row = 0; row < ch; row++) out.set(rgba.subarray(((y0 + row) * width + x0) * 4, ((y0 + row) * width + x0 + cw) * 4), row * cw * 4);
  return { rgba: out, width: cw, height: ch };
}

/**
 * Contenu de la carte dans une image qui en montre plus ou moins (fond de table, marge blanche, bord de la carte) :
 * rectangle en fractions. Une passe retire les bandes uniformes du pourtour : leur couleur est la moyenne du pourtour,
 * et une ligne (ou colonne) est gardée dès que plus de la moitié de ses pixels s'en écartent nettement. Plusieurs
 * passes, jusqu'à ce que le pourtour ne soit plus uniforme : la photo perd d'abord le fond de table puis le bord jaune ou
 * argenté de la carte, l'image du catalogue directement ce bord ; les deux arrivent au même cadre intérieur. Pixels transparents (coins arrondis) : du fond.
 * Une passe qui donnerait des proportions trop éloignées de celles d'une carte (63 × 88 mm) est ignorée.
 */
export const CARD_RATIO = 63 / 88;
export function trimBorders(rgba, width, height, { passes = 4, tolerance = 48, share = 0.5, max = 0.15, slack = 0.08 } = {}) {
  let rect = { left: 0, top: 0, right: width - 1, bottom: height - 1 };
  for (let pass = 0; pass < passes; pass++) {
    const next = trimPass(rgba, width, rect, { tolerance, share, max });
    if (!next) break;
    const w = next.right - next.left + 1, h = next.bottom - next.top + 1;
    if (Math.abs(w / h - CARD_RATIO) > slack) break;
    rect = next;
  }
  return { x: rect.left / width, y: rect.top / height, w: (rect.right - rect.left + 1) / width, h: (rect.bottom - rect.top + 1) / height };
}

/** Une passe de trimBorders dans le rectangle `r` (bornes incluses) ; null si rien à retirer. */
function trimPass(rgba, width, r, { tolerance, share, max }) {
  let sr = 0, sg = 0, sb = 0, n = 0;
  const add = (x, y) => { const i = (y * width + x) * 4; if (rgba[i + 3] >= 128) { sr += rgba[i]; sg += rgba[i + 1]; sb += rgba[i + 2]; n++; } };
  for (let x = r.left; x <= r.right; x++) { add(x, r.top); add(x, r.bottom); }
  for (let y = r.top; y <= r.bottom; y++) { add(r.left, y); add(r.right, y); }
  if (!n) return null;
  const bg = [sr / n, sg / n, sb / n];
  const fg = (x, y) => {
    const i = (y * width + x) * 4;
    if (rgba[i + 3] < 128) return false;
    return Math.abs(rgba[i] - bg[0]) + Math.abs(rgba[i + 1] - bg[1]) + Math.abs(rgba[i + 2] - bg[2]) > tolerance;
  };
  const w = r.right - r.left + 1, h = r.bottom - r.top + 1;
  const rowIn = (y) => { let c = 0; for (let x = r.left; x <= r.right; x++) c += fg(x, y); return c > share * w; };
  const colIn = (x) => { let c = 0; for (let y = r.top; y <= r.bottom; y++) c += fg(x, y); return c > share * h; };
  const limY = Math.floor(h * max), limX = Math.floor(w * max);
  let top = r.top; while (top - r.top < limY && !rowIn(top)) top++;
  let bottom = r.bottom; while (r.bottom - bottom < limY && !rowIn(bottom)) bottom--;
  let left = r.left; while (left - r.left < limX && !colIn(left)) left++;
  let right = r.right; while (r.right - right < limX && !colIn(right)) right--;
  if (top === r.top && bottom === r.bottom && left === r.left && right === r.right) return null;
  return { left, top, right, bottom };
}

/**
 * Vignette de comparaison fine (second tri des meilleures candidates) : image réduite à w×h en couleur, chaque canal
 * centré et réduit (insensible à la luminosité et au contraste de la photo).
 */
export function thumbnail(rgba, width, height, w = 16, h = 22) {
  const channels = boxDownscale(rgba, width, height, w, h);
  const out = new Float32Array(w * h * 3);
  [channels.r, channels.g, channels.b].forEach((c, k) => {
    const mean = c.reduce((s, v) => s + v, 0) / c.length;
    const sd = Math.sqrt(c.reduce((s, v) => s + (v - mean) ** 2, 0) / c.length) || 1;
    for (let i = 0; i < c.length; i++) out[k * c.length + i] = (c[i] - mean) / sd;
  });
  return out;
}

/** Écart moyen entre deux vignettes (0 = identiques). */
export function thumbnailDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2;
  return d / a.length;
}

/** Ressemblance en % (100 = identique), comme pokemonpocket-v2. */
export const confidence = (distance) => 100 - (distance / HASH_BITS) * 100;

/** Index des empreintes : un bloc de 18 octets par carte (identifiant Cardmarket sur 4 octets, puis l'empreinte). */
export const RECORD = 4 + HASH_BYTES;

export function encodeIndex(entries) {
  const out = new Uint8Array(entries.length * RECORD);
  const view = new DataView(out.buffer);
  entries.forEach(({ id, hash }, i) => {
    view.setUint32(i * RECORD, id, true);
    out.set(hash, i * RECORD + 4);
  });
  return out;
}

/**
 * Les cartes les plus proches d'une empreinte, de la plus proche à la moins proche.
 * `only` : identifiants à considérer (par exemple les cartes dont le numéro a été lu), ou null pour toutes.
 */
export function nearest(index, hash, { limit = 5, only = null } = {}) {
  const view = new DataView(index.buffer, index.byteOffset, index.byteLength);
  const out = [];
  for (let o = 0; o + RECORD <= index.byteLength; o += RECORD) {
    const id = view.getUint32(o, true);
    if (only && !only.has(id)) continue;
    const distance = hamming(hash, index, o + 4);
    out.push({ id, distance, confidence: confidence(distance) });
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, limit);
}
