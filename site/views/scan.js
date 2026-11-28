// Scanner : dès l'ouverture, la caméra cherche la carte présentée dans le cadre, sans rien taper ni appuyer.
// Deux lectures en parallèle :
//   - l'image : empreinte de la carte comparée à celles du catalogue, plusieurs fois par seconde (méthode principale) ;
//   - le texte : série et numéro imprimés en bas à gauche (OCR, plus lent, pas toujours lisible). Quand il est lu,
//     il départage les rééditions à l'illustration identique, que l'image seule ne distingue pas.
// À la première carte reconnue, la caméra s'arrête et affiche la carte, avec les autres possibilités en dessous.
import {
  parseScan, mergeScans, createTracker, createEvidence, createImageTracker, preferRead, acceptMatch, checkWithNumber, lookFrame, GUIDE, CROPS,
} from '../lib/scan.js';
import { prepare, readCardPasses, PASSES } from '../lib/ocr.js';
import { nearest, cropRGBA, glareShare, SCAN_MAX_DISTANCE, SCAN_MIN_GAP, SCAN_MAX_DISTANCE_WITH_NUMBER } from '../lib/fingerprint.js';
import { loadFingerprints } from '../lib/data.js';
import { displayName, priceOf } from '../lib/model.js';
import { formatEuro } from '../lib/format.js';
import { cardImg, esc } from '../lib/ui.js';

const CARD_RATIO = 63 / 88;

const GLARE_HINT = 0.04; // part du cadre en reflet au-delà de laquelle on conseille d'incliner la carte
const FRAME_WIDTH = 375; // largeur de l'aperçu analysé : la carte y fait environ 300 px (le catalogue : images de 200 à 250 px)
const ALTERNATIVES = 2; // autres possibilités affichées sous la carte reconnue

/**
 * Recadre la source aux proportions d'une carte (comme l'aperçu à l'écran), puis à `rect` (fractions de cet aperçu,
 * par exemple le cadre de visée), et renvoie un canvas, réduit à `width`.
 */
function frameCanvas(source, width = null, rect = null) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  let w = sw;
  let h = Math.round(sw / CARD_RATIO);
  if (h > sh) { h = sh; w = Math.round(sh * CARD_RATIO); }
  let x = (sw - w) / 2, y = (sh - h) / 2;
  if (rect) { x += rect.x * w; y += rect.y * h; w = Math.round(rect.w * w); h = Math.round(rect.h * h); }
  const scale = width && width < w ? width / w : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, Math.round(x), Math.round(y), w, h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Empreinte de l'image et cartes du catalogue les plus proches : { hash, top }, voir lookFrame. */
function lookImage(index, source, crops) {
  const canvas = frameCanvas(source, FRAME_WIDTH);
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const guide = cropRGBA(data, canvas.width, canvas.height, GUIDE);
  return { ...lookFrame(index, data, canvas.width, canvas.height, crops), glare: glareShare(guide.rgba, guide.width, guide.height) };
}

/** Les cartes `cards` (qui portent le numéro lu) classées par ressemblance avec l'empreinte : [{ id, distance }]. */
const rankByImage = (index, hash, cards) => nearest(index, hash, { limit: 12, only: new Set(cards.map((c) => c.id)) });

const HINT = '<div class="muted" style="text-align:center">Placez la carte dans le cadre, bord à bord et bien à plat : elle est reconnue toute seule, sans appuyer.</div>';

export async function render(root, { catalog, snapshot, store, param }) {
  const diag = param === 'diag'; // #/scan/diag : distances et cadence affichées en direct, pour régler le scanner
  root.innerHTML = `
    <h1>Scanner</h1>
    <div class="scan-frame" id="frame">
      <video id="video" playsinline muted></video>
      <div class="scan-guide" aria-hidden="true"><i></i><i></i><i></i><i></i><div class="scan-zone"></div></div>
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
  let lastNumber = null; // dernier numéro lu : { number, official }
  let lastHash = null; // empreinte de la dernière image regardée
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
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
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
  // `rect` : la carte dans l'image (le cadre de visée pour la caméra) ; `quick` : une seule passe de lecture.
  async function read(source, { rect = null, quick = false } = {}) {
    const texts = await readCardPasses(frameCanvas(source, null, rect), { cardTop: 0, passes: quick ? PASSES.slice(0, 1) : PASSES });
    return mergeScans(texts.map((text) => parseScan(text, catalog)));
  }

  // Texte (OCR) : lent, en continu tant que la caméra cherche.
  async function loop() {
    if (!alive) return;
    const wait = (ms) => { timer = setTimeout(loop, ms); };
    if (paused || document.hidden || !stream || video.readyState < 2) return wait(400);
    try {
      const result = evidence.add(await read(video, { rect: GUIDE, quick: true }));
      if (!alive || paused) return wait(400);
      lastRead = result.candidates;
      if (result.number) lastNumber = { number: result.number, official: result.official };
      const hit = tracker.push(result);
      // Numéro lu avec certitude : les cartes qui le portent, la plus ressemblante à l'image d'abord.
      if (hit) detected(byImage(hit.candidates), 5, 'confirmed');
      else if (result.number) pill.textContent = `Lu ${result.number}${result.official ? `/${result.official}` : ''}… je vérifie`;
    } catch (err) {
      // Moteur de lecture indisponible (hors connexion…) : la reconnaissance par l'image continue seule.
      if (!index) pill.textContent = `Lecture impossible : ${err.message}`;
      return wait(5000);
    }
    wait(700); // la lecture du texte laisse la main à la reconnaissance par l'image, plus rapide
  }

  // Image : rapide, plusieurs fois par seconde.
  async function imageLoop() {
    if (!alive) return;
    const wait = (ms) => { imageTimer = setTimeout(imageLoop, ms); };
    await indexReady;
    if (!index) return; // empreintes pas encore publiées : le texte seul
    if (paused || document.hidden || !stream || video.readyState < 2) return wait(300);
    try {
      const t0 = performance.now();
      const { hash, top, glare } = lookImage(index, video, CROPS);
      lastHash = hash;
      if (diag) showDiag(top, performance.now() - t0, glare);
      // Grand reflet sur la carte : en l'inclinant un peu, le reflet se déplace et l'image suivante passe.
      else if (!paused) pill.textContent = glare > GLARE_HINT ? 'Reflet sur la carte : inclinez-la un peu' : lastNumber ? pill.textContent : 'Recherche d’une carte…';
      // Numéro déjà lu : l'image n'a plus qu'à choisir parmi les cartes qui le portent, avec un seuil plus souple.
      const ranked = lastRead.length ? rankByImage(index, hash, lastRead) : [];
      if (ranked[0] && ranked[0].distance <= SCAN_MAX_DISTANCE_WITH_NUMBER) {
        const ids = [...ranked.map((r) => r.id), ...top.map((r) => r.id)];
        detected(cardsOf([...new Set(ids)]), ALTERNATIVES, 'confirmed');
      } else {
        const hit = imageTracker.push(top);
        if (hit) { detected(cardsOf(hit.ids)); confirmNumber(); }
      }
    } catch (err) {
      console.warn('Reconnaissance par l’image :', err);
      return wait(2000);
    }
    wait(150);
  }

  // Mode diagnostic : distance de la carte la plus proche, écart avec la 5e, durée d'analyse et cadence.
  let frames = [];
  function showDiag(top, ms, glare = 0) {
    const now = performance.now();
    frames = [...frames.filter((t) => now - t < 2000), now];
    const d = top[0]?.distance ?? '—';
    const gap = top.length > 4 ? top[4].distance - top[0].distance : '—';
    const ok = acceptMatch(top, RULE) ? '✓' : '✗';
    const card = top[0] ? catalog.byId.get(top[0].id) : null;
    pill.textContent = `${ok} d ${d}/${SCAN_MAX_DISTANCE} · écart ${gap}/${SCAN_MIN_GAP} · ${Math.round(ms)} ms · ${(frames.length / 2).toFixed(1)} img/s · reflet ${Math.round(glare * 100)} %${card ? ` · ${card.s} ${card.n}` : ''}`;
  }

  const cardsOf = (ids) => ids.map((id) => catalog.byId.get(id)).filter(Boolean);

  /** Cartes classées par ressemblance avec la dernière image (ordre d'origine sans empreintes). */
  function byImage(cards) {
    if (!index || !lastHash) return cards;
    const ranked = rankByImage(index, lastHash, cards).map((r) => r.id);
    return [...cardsOf(ranked), ...cards.filter((c) => !ranked.includes(c.id))];
  }

  /**
   * Après une reconnaissance par l'image : lecture du numéro sur l'image figée, qui confirme la carte ou la corrige
   * (réédition à l'illustration identique). La carte s'affiche tout de suite ; la vérification suit (1 à 2 s).
   */
  async function confirmNumber(source = video) {
    const shown = current;
    shown.check = 'checking';
    drawResult();
    const result = await read(source, source === video ? { rect: GUIDE } : {}).catch(() => null);
    if (current !== shown || shown.picked) return; // autre carte entre-temps, ou choix fait à la main
    const ids = [shown.card, ...shown.others].map((c) => c.id);
    const readCards = result?.candidates ?? [];
    const ranked = index && lastHash && readCards.length ? rankByImage(index, lastHash, readCards) : [];
    const out = checkWithNumber(ids, readCards.map((c) => c.id), ranked, { maxDistance: SCAN_MAX_DISTANCE_WITH_NUMBER });
    const [card, ...others] = cardsOf(out.ids);
    current = { card, others: others.slice(0, ALTERNATIVES), check: out.status, read: result };
    drawResult();
  }

  /** Une carte vient d'être reconnue : on fige l'image et on affiche la carte, avec les autres possibilités. */
  function detected(cards, alternatives = ALTERNATIVES, check = null) {
    if (!cards.length || paused) return;
    navigator.vibrate?.(60);
    paused = true;
    video.pause();
    frame.classList.add('hit');
    toast.hidden = true;
    const [card, ...others] = cards;
    current = { card, others: others.slice(0, alternatives), check, read: check ? { ...lastNumber } : null };
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
    lastNumber = null;
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
    const pad = (n) => (/^\d+$/.test(n) ? n.padStart(3, '0') : n); // comme imprimé : 079/096
    const num = current.read?.number ? `${pad(current.read.number)}${current.read.official ? `/${pad(current.read.official)}` : ''}` : '';
    const check = {
      checking: '<div class="muted">Lecture du numéro…</div>',
      confirmed: num ? `<div class="up">✓ Numéro ${esc(num)} lu sur la carte</div>` : '<div class="up">✓ Numéro lu sur la carte</div>',
      corrected: `<div class="up">✓ Corrigée grâce au numéro lu${num ? ` (${esc(num)})` : ''}</div>`,
    }[current.check] ?? '';
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
          <div class="muted">${have ? `Dans ma collection ×${have}` : connected ? 'Pas encore dans ma collection' : ''}</div>${check}</div>
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
        current = { card, others: [current.card, ...current.others.filter((c) => c !== card)], picked: true };
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
      const look = index ? lookImage(index, image, [{ x: 0, y: 0, w: 1, h: 1 }]) : { hash: null, top: [] };
      lastHash = look.hash;
      // Image et numéro lus ensemble : le numéro confirme ou corrige ce que l'image propose.
      const result = await read(image).catch(() => ({ number: null, candidates: [] }));
      if (result.number) lastNumber = { number: result.number, official: result.official };
      if (acceptMatch(look.top, RULE)) {
        const ranked = look.hash && result.candidates.length ? rankByImage(index, look.hash, result.candidates) : [];
        const out = checkWithNumber(look.top.map((r) => r.id), result.candidates.map((c) => c.id), ranked, { maxDistance: SCAN_MAX_DISTANCE_WITH_NUMBER });
        return detected(cardsOf(out.ids), ALTERNATIVES, out.status === 'unread' ? null : out.status);
      }
      if (result.candidates.length) return detected(byImage(result.candidates), 5, 'confirmed');
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
