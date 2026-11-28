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
 * Réduction déterministe (moyenne par blocs) d'une image RGBA vers size×size, par canal.
 * Identique à boxDownscale de pokemonpocket-v2.
 */
export function boxDownscale(data, w, h, size) {
  const r = new Array(size * size);
  const g = new Array(size * size);
  const b = new Array(size * size);
  for (let ty = 0; ty < size; ty++) {
    const y0 = Math.floor((ty * h) / size);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / size));
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

/** Empreinte couleur (105 bits, dans 14 octets) d'une image RGBA, dans l'ordre des bits de pokemonpocket-v2. */
export function colorHash(rgba, width, height) {
  const { r, g, b } = boxDownscale(rgba, width, height, HASH_SIZE);
  const dct = [r, g, b].map((channel) => computeDCT(channel, HASH_SIZE, FREQ_SIZE));
  const avg = dct.map((d) => {
    let sum = 0, count = 0;
    for (let y = 0; y < FREQ_SIZE; y++) for (let x = 0; x < FREQ_SIZE; x++) {
      if (!(x === 0 && y === 0)) { sum += d[y * HASH_SIZE + x]; count++; }
    }
    return sum / count;
  });
  const bytes = new Uint8Array(HASH_BYTES);
  let bit = 0;
  for (let y = 0; y < FREQ_SIZE; y++) {
    for (let x = 0; x < FREQ_SIZE; x++) {
      if (x === 0 && y === 0) continue;
      const pos = y * HASH_SIZE + x;
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
export function hamming(a, b, offset = 0) {
  let d = 0;
  for (let i = 0; i < HASH_BYTES; i++) d += POP[a[i] ^ b[offset + i]];
  return d;
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
