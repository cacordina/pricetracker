// Scanner : dès l'ouverture, la caméra cherche la carte présentée dans le cadre, sans rien taper ni appuyer.
// Deux lectures en parallèle :
//   - l'image : empreinte de la carte comparée à celles du catalogue, plusieurs fois par seconde (méthode principale) ;
//   - le texte : série et numéro imprimés en bas à gauche (OCR, plus lent, pas toujours lisible). Quand il est lu,
//     il départage les rééditions à l'illustration identique, que l'image seule ne distingue pas.
// À la première carte reconnue, la caméra s'arrête et affiche la carte, avec les autres possibilités en dessous.
import { parseScan, mergeScans, createTracker, createEvidence, createImageTracker, preferRead, acceptMatch } from '../lib/scan.js';
import { prepare, readCardPasses } from '../lib/ocr.js';
import { scanHash, nearest, SCAN_MAX_DISTANCE, SCAN_MIN_GAP } from '../lib/fingerprint.js';
import { loadFingerprints } from '../lib/data.js';
import { displayName, priceOf } from '../lib/model.js';
import { formatEuro } from '../lib/format.js';
import { cardImg, esc } from '../lib/ui.js';

const CARD_RATIO = 63 / 88;

const IMAGE_WIDTH = 300; // largeur de l'image comparée aux empreintes (celles du catalogue viennent d'images de 200 à 250 px)
const ALTERNATIVES = 2; // autres possibilités affichées sous la carte reconnue

/** Recadre la source aux proportions d'une carte (comme l'aperçu à l'écran) et renvoie un canvas, réduit à `width`. */
function frameCanvas(source, width = null) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  let w = sw;
  let h = Math.round(sw / CARD_RATIO);
  if (h > sh) { h = sh; w = Math.round(sh * CARD_RATIO); }
  const scale = width && width < w ? width / w : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, Math.round((sw - w) / 2), Math.round((sh - h) / 2), w, h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Les cartes du catalogue les plus proches de l'image : [{ id, distance }]. */
function lookImage(index, source) {
  const canvas = frameCanvas(source, IMAGE_WIDTH);
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return nearest(index, scanHash(data, canvas.width, canvas.height), { limit: 8 });
}

const HINT = '<div class="muted" style="text-align:center">Présentez la carte entière dans le cadre, bien à plat : elle est reconnue toute seule, sans appuyer.</div>';

export async function render(root, { catalog, snapshot, store }) {
  root.innerHTML = `
    <h1>Scanner</h1>
    <div class="scan-frame" id="frame">
      <video id="video" playsinline muted></video>
      <div class="scan-zone" aria-hidden="true"></div>
      <div class="scan-pill" id="pill" aria-live="polite">Démarrage de la caméra…</div>
      <button type="button" class="scan-torch" id="torch" hidden aria-pressed="false">Lampe</button>
      <div class="scan-toast" id="toast" hidden></div>
    </div>
    <div id="result">${HINT}</div>
    <p style="text-align:center"><label class="link" style="cursor:pointer">Choisir une photo<input type="file" id="file" accept="image/*" hidden></label></p>`;

  const frame = root.querySelector('#frame');
  const video = root.querySelector('#video');
  const pill = root.querySelector('#pill');
  const toast = root.querySelector('#toast');
  const torch = root.querySelector('#torch');
  const resultBox = root.querySelector('#result');

  const tracker = createTracker();
  const evidence = createEvidence(catalog); // cumule ce qui est lu d'une image à l'autre
  const RULE = { maxDistance: SCAN_MAX_DISTANCE, minGap: SCAN_MIN_GAP };
  const imageTracker = createImageTracker(RULE);
  let index = null; // empreintes du catalogue
  let lastRead = []; // dernières cartes trouvées par le texte lu (OCR)
  let stream = null;
  let alive = true;
  let paused = false;
  let timer = null;
  let imageTimer = null;
  let owned = new Map();
  let connected = false;
  let current = null; // { card, others } : résultat affiché
  const indexReady = loadFingerprints().then((i) => { index = i; }, () => {});

  store.listHoldings()
    .then((rows) => { owned = new Map(rows.map((r) => [r.id_product, r.qty])); connected = true; if (current) drawResult(); })
    .catch(() => {});

  const price = (card) => priceOf(snapshot.cards[card.id]);

  // ---------- Caméra ----------
  function stop() {
    alive = false;
    clearTimeout(timer);
    clearTimeout(imageTimer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  window.addEventListener('hashchange', stop, { once: true });

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      pill.textContent = 'Caméra indisponible : utilisez « Choisir une photo »';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false,
      });
      if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play();
      const track = stream.getVideoTracks()[0];
      if (track.getCapabilities?.().torch) {
        torch.hidden = false;
        torch.onclick = async () => {
          const on = torch.getAttribute('aria-pressed') !== 'true';
          try {
            await track.applyConstraints({ advanced: [{ torch: on }] });
            torch.setAttribute('aria-pressed', String(on));
            torch.classList.toggle('on', on);
          } catch { torch.hidden = true; }
        };
      }
      pill.textContent = 'Recherche d’une carte…';
      loop();
      imageLoop();
    } catch {
      pill.textContent = 'Caméra refusée : autorisez-la pour ce site, ou choisissez une photo';
    }
  }

  // ---------- Lecture en continu ----------
  async function read(source) {
    const texts = await readCardPasses(frameCanvas(source), { cardTop: 0 });
    return mergeScans(texts.map((text) => parseScan(text, catalog)));
  }

  // Texte (OCR) : lent, en continu tant que la caméra cherche.
  async function loop() {
    if (!alive) return;
    const wait = (ms) => { timer = setTimeout(loop, ms); };
    if (paused || document.hidden || !stream || video.readyState < 2) return wait(400);
    try {
      const result = evidence.add(await read(video));
      if (!alive || paused) return wait(400);
      lastRead = result.candidates;
      const hit = tracker.push(result);
      if (hit) detected(hit.candidates, 5); // numéro lu : les cartes qui le portent
      else if (result.number) pill.textContent = `Lu ${result.number}${result.official ? `/${result.official}` : ''}… je vérifie`;
    } catch (err) {
      // Moteur de lecture indisponible (hors connexion…) : la reconnaissance par l'image continue seule.
      if (!index) pill.textContent = `Lecture impossible : ${err.message}`;
      return wait(5000);
    }
    wait(200);
  }

  // Image : rapide, plusieurs fois par seconde.
  async function imageLoop() {
    if (!alive) return;
    const wait = (ms) => { imageTimer = setTimeout(imageLoop, ms); };
    await indexReady;
    if (!index) return; // empreintes pas encore publiées : le texte seul
    if (paused || document.hidden || !stream || video.readyState < 2) return wait(300);
    try {
      const hit = imageTracker.push(lookImage(index, video));
      if (hit) detected(preferRead(hit.ids, lastRead).map((id) => catalog.byId.get(id)).filter(Boolean));
    } catch (err) {
      console.warn('Reconnaissance par l’image :', err);
      return wait(2000);
    }
    wait(150);
  }

  /** Une carte vient d'être reconnue : on fige l'image et on affiche la carte, avec les autres possibilités. */
  function detected(cards, alternatives = ALTERNATIVES) {
    if (!cards.length || paused) return;
    navigator.vibrate?.(60);
    paused = true;
    video.pause();
    frame.classList.add('hit');
    toast.hidden = true;
    const [card, ...others] = cards;
    current = { card, others: others.slice(0, alternatives) };
    pill.textContent = 'Carte reconnue';
    drawResult();
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Relance la recherche pour une autre carte. */
  function resume() {
    current = null;
    tracker.reset();
    imageTracker.reset();
    evidence.clear();
    lastRead = [];
    frame.classList.remove('hit');
    paused = false;
    if (stream) video.play().catch(() => {});
    pill.textContent = stream ? 'Recherche d’une carte…' : pill.textContent;
    resultBox.innerHTML = HINT;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function drawResult(message = '') {
    const again = '<button type="button" class="btn sec" data-act="again">Scanner une autre carte</button>';
    const { card, others } = current;
    const have = owned.get(card.id) ?? 0;
    // Les autres possibilités : surtout des rééditions de la même illustration, à départager par le coin bas gauche.
    const alternatives = others.length ? `<div class="box" style="margin-top:12px">
        <b>Pas la bonne ?</b> <span class="muted">Comparez le code et le numéro en bas à gauche de votre carte.</span>
        <div class="grid" style="margin-top:8px">${others.map((c) => `
          <button type="button" class="tile choice" data-act="pick" data-id="${c.id}">
            ${cardImg(c, catalog.sets)}<div class="muted"><b>${esc(c.s)} ${esc(c.n)}</b></div><div class="muted">${formatEuro(price(c))}</div></button>`).join('')}</div>
      </div>` : '';
    resultBox.innerHTML = `
      <a class="row" href="#/carte/${card.id}" style="border-top:0">
        ${cardImg(card, catalog.sets)}
        <div class="name"><b>${esc(displayName(card))}</b>
          <div class="muted">${esc(card.s)} · ${esc(card.n)}${card.r === 'AR' || card.r === 'SAR' ? ` · ${card.r}` : ''}</div>
          <div class="muted">${have ? `Dans ma collection ×${have}` : connected ? 'Pas encore dans ma collection' : ''}</div></div>
        <div class="price"><span class="big" style="font-size:22px">${formatEuro(price(card))}</span></div>
      </a>
      ${message ? `<div class="banner">${esc(message)}</div>` : ''}
      ${connected
        ? `<button type="button" class="btn" data-act="add">${have ? 'Ajouter un exemplaire de plus' : 'Ajouter à ma collection'}</button>`
        : '<a class="btn" href="#/connexion">Se connecter pour l’ajouter à ma collection</a>'}
      ${again}
      <a class="btn sec" href="#/carte/${card.id}">Voir la fiche et la courbe</a>
      ${alternatives}`;
  }

  resultBox.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const act = button.dataset.act;
    if (act === 'again') return resume();
    if (act === 'pick') {
      // La carte choisie prend la place de la proposition principale, qui passe dans les autres possibilités.
      const card = current.others.find((c) => c.id === Number(button.dataset.id));
      if (card) {
        current = { card, others: [current.card, ...current.others.filter((c) => c !== card)] };
        drawResult();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }
    if (act === 'add') {
      event.preventDefault();
      button.disabled = true;
      const card = current.card;
      try {
        const next = (owned.get(card.id) ?? 0) + 1;
        await store.setHolding(card.id, next);
        owned.set(card.id, next);
        drawResult(`✓ Ajoutée à votre collection (×${next}).`);
      } catch (err) {
        drawResult(`Non enregistré : ${err.message}`);
      }
    }
  });

  // ---------- Photo ----------
  root.querySelector('#file').onchange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const image = new Image();
    image.src = URL.createObjectURL(file);
    const before = pill.textContent;
    pill.textContent = 'Lecture de la photo…';
    try {
      await image.decode();
      await indexReady;
      const top = index ? lookImage(index, image) : [];
      if (acceptMatch(top, RULE)) {
        // Le texte, s'il est lisible, départage les rééditions ; la photo est reconnue même sans.
        const result = await read(image).catch(() => ({ candidates: [] }));
        return detected(preferRead(top.map((r) => r.id), result.candidates).map((id) => catalog.byId.get(id)).filter(Boolean));
      }
      const result = await read(image);
      if (result.candidates.length) return detected(result.candidates, 5);
      pill.textContent = before;
      resultBox.innerHTML = `<div class="banner">Photo non reconnue${result.number ? ` (lu ${esc(result.number)}${result.official ? `/${esc(result.official)}` : ''})` : ''}. Cadrez la carte entière, à plat et sans reflet.</div>`;
    } catch {
      pill.textContent = before;
      resultBox.innerHTML = '<div class="banner">Cette photo n’a pas pu être lue.</div>';
    } finally {
      URL.revokeObjectURL(image.src);
    }
  };

  root._start = () => { prepare().catch(() => {}); startCamera(); };
}

export function mounted(root) {
  root._start?.();
}
