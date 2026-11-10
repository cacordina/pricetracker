// Lecture du texte imprimé au bas d'une carte, dans le navigateur (Tesseract.js, chargé à la demande).
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/- ';

let workerPromise = null;

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = () => reject(new Error('La bibliothèque de lecture n’a pas pu être chargée (connexion ?).'));
    document.head.append(script);
  });
}

/** Prépare le moteur de lecture (environ 6 Mo au premier usage, gardés en cache ensuite). */
export function prepare() {
  workerPromise ??= (async () => {
    if (!window.Tesseract) await loadScript(TESSERACT_URL);
    const worker = await window.Tesseract.createWorker('eng');
    await worker.setParameters({ tessedit_char_whitelist: WHITELIST, tessedit_pageseg_mode: '11' }); // 11 = texte épars
    return worker;
  })();
  workerPromise.catch(() => { workerPromise = null; });
  return workerPromise;
}

/**
 * Découpe une bande de la source et la prépare pour la lecture : mise à hauteur fixe, niveaux de gris, contraste étiré.
 * `band` = { top, bottom, left, right } en fractions de la source.
 */
export function cropBand(source, band, targetHeight = 220) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const x = Math.round(sw * band.left);
  const y = Math.round(sh * band.top);
  const w = Math.round(sw * (band.right - band.left));
  const h = Math.round(sh * (band.bottom - band.top));
  const scale = targetHeight / h; // toujours ramenée à la même hauteur : le moteur lit mieux un texte de taille constante
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, x, y, w, h, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    px[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const span = Math.max(1, max - min);
  for (let i = 0; i < px.length; i += 4) {
    const g = ((px[i] - min) / span) * 255;
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Inverse ou binarise un canvas déjà en niveaux de gris (seuil d'Otsu). */
function recontrast(canvas, mode) {
  if (mode === 'plain') return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < px.length; i += 4) hist[px[i]] += 1;
  const total = px.length / 4;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i] > threshold ? 0 : 255; // texte clair sur fond sombre → noir sur blanc
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// Sur une carte japonaise, série et numéro sont en bas à gauche (« sv8a 212/187 SAR »).
// Bandes exprimées en fractions de la carte entière ; plusieurs passes car aucune ne lit toutes les cartes
// (essais sur 8 images : 4/8 pour la meilleure passe seule, 5/8 en les combinant).
export const PASSES = [
  { band: { top: 0.9, bottom: 0.985, left: 0.0, right: 0.6 }, height: 90, mode: 'plain' },
  { band: { top: 0.925, bottom: 0.978, left: 0.02, right: 0.5 }, height: 150, mode: 'plain' },
  { band: { top: 0.925, bottom: 0.978, left: 0.02, right: 0.5 }, height: 150, mode: 'otsu' },
];

/**
 * Lit le bas d'une carte. `cardTop` = fraction de la carte où commence la source : 0 si la source montre
 * la carte entière, 0.75 pour un gros plan sur son quart inférieur. Renvoie un texte par passe.
 */
export async function readCardPasses(source, { cardTop = 0 } = {}) {
  const worker = await prepare();
  const span = 1 - cardTop;
  const texts = [];
  for (const pass of PASSES) {
    const band = { ...pass.band, top: Math.max(0, (pass.band.top - cardTop) / span), bottom: Math.min(1, (pass.band.bottom - cardTop) / span) };
    const canvas = recontrast(cropBand(source, band, pass.height), pass.mode);
    const { data } = await worker.recognize(canvas);
    texts.push(data.text.replace(/\s+/g, ' ').trim());
  }
  return texts;
}
