// Scanner : dès l'ouverture, la caméra cherche la série et le numéro imprimés en bas à gauche de la carte.
// À la première carte reconnue, elle s'arrête et affiche le résultat ; on relance pour la carte suivante.
import { parseScan, mergeScans, createTracker, createEvidence } from '../lib/scan.js';
import { prepare, readCardPasses } from '../lib/ocr.js';
import { COL, displayName, formatEuro } from '../lib/metrics.js';
import { cardImg, esc } from '../lib/ui.js';

const CARD_RATIO = 63 / 88;

/** Recadre la source aux proportions d'une carte (comme l'aperçu à l'écran) et renvoie un canvas. */
function frameCanvas(source) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  let w = sw;
  let h = Math.round(sw / CARD_RATIO);
  if (h > sh) { h = sh; w = Math.round(sh * CARD_RATIO); }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(source, Math.round((sw - w) / 2), Math.round((sh - h) / 2), w, h, 0, 0, w, h);
  return canvas;
}

export async function render(root, { catalog, snapshot, store }) {
  root.innerHTML = `
    <div class="toolbar"><h1>Scanner</h1><a class="link" href="#/recherche">← Recherche</a></div>
    <div class="scan-frame" id="frame">
      <video id="video" playsinline muted></video>
      <div class="scan-zone" aria-hidden="true"></div>
      <div class="scan-pill" id="pill" aria-live="polite">Démarrage de la caméra…</div>
      <button type="button" class="scan-torch" id="torch" hidden aria-pressed="false">Lampe</button>
      <div class="scan-toast" id="toast" hidden></div>
    </div>
    <div id="result"><div class="muted" style="text-align:center">Présentez la carte entière dans le cadre : elle est reconnue toute seule, sans appuyer.</div></div>
    <p style="text-align:center"><label class="link" style="cursor:pointer">Choisir une photo<input type="file" id="file" accept="image/*" hidden></label></p>`;

  const frame = root.querySelector('#frame');
  const video = root.querySelector('#video');
  const pill = root.querySelector('#pill');
  const toast = root.querySelector('#toast');
  const torch = root.querySelector('#torch');
  const resultBox = root.querySelector('#result');

  const tracker = createTracker();
  const evidence = createEvidence(catalog); // cumule ce qui est lu d'une image à l'autre
  let stream = null;
  let alive = true;
  let paused = false;
  let timer = null;
  let owned = new Map();
  let connected = false;
  let current = null; // { card } | { choices } : résultat affiché

  store.listHoldings()
    .then((rows) => { owned = new Map(rows.map((r) => [r.id_product, r.qty])); connected = true; if (current) drawResult(); })
    .catch(() => {});

  const price = (card) => snapshot.cards[card.id]?.[COL.trend] ?? null;

  // ---------- Caméra ----------
  function stop() {
    alive = false;
    clearTimeout(timer);
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
      pill.textContent = 'Préparation de la lecture…';
      loop();
    } catch {
      pill.textContent = 'Caméra refusée : autorisez-la pour ce site, ou choisissez une photo';
    }
  }

  // ---------- Lecture en continu ----------
  async function read(source) {
    const texts = await readCardPasses(frameCanvas(source), { cardTop: 0 });
    return mergeScans(texts.map((text) => parseScan(text, catalog)));
  }

  async function loop() {
    if (!alive) return;
    const wait = (ms) => { timer = setTimeout(loop, ms); };
    if (paused || document.hidden || !stream || video.readyState < 2) return wait(400);
    try {
      const result = evidence.add(await read(video));
      if (!alive) return;
      const hit = tracker.push(result);
      if (hit) detected(hit.candidates);
      else pill.textContent = result.number ? `Lu ${result.number}${result.official ? `/${result.official}` : ''}… je vérifie` : 'Recherche d’une carte…';
    } catch (err) {
      pill.textContent = `Lecture impossible : ${err.message}`;
      return wait(3000);
    }
    wait(200);
  }

  /** Une carte vient d'être reconnue : on fige l'image et on affiche le résultat. */
  function detected(candidates) {
    navigator.vibrate?.(60);
    paused = true;
    video.pause();
    frame.classList.add('hit');
    toast.hidden = true;
    current = candidates.length === 1 ? { card: candidates[0] } : { choices: candidates };
    pill.textContent = current.card ? 'Carte reconnue' : 'Plusieurs cartes possibles';
    drawResult();
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Relance la recherche pour une autre carte. */
  function resume() {
    current = null;
    tracker.reset();
    evidence.clear();
    frame.classList.remove('hit');
    paused = false;
    if (stream) video.play().catch(() => {});
    pill.textContent = stream ? 'Recherche d’une carte…' : pill.textContent;
    resultBox.innerHTML = '<div class="muted" style="text-align:center">Présentez la carte entière dans le cadre : elle est reconnue toute seule, sans appuyer.</div>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function drawResult(message = '') {
    const again = '<button type="button" class="btn sec" data-act="again">Scanner une autre carte</button>';
    if (current.choices) {
      resultBox.innerHTML = `<div class="box">
        <b>Laquelle est-ce ?</b>
        <div class="grid" style="margin-top:8px">${current.choices.map((card) => `
          <button type="button" class="tile choice" data-act="pick" data-id="${card.id}">
            ${cardImg(card, catalog.sets)}<div class="muted">${esc(card.s)} ${esc(card.n)}</div></button>`).join('')}</div>
      </div>${again}`;
      return;
    }
    const card = current.card;
    const have = owned.get(card.id) ?? 0;
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
      <a class="btn sec" href="#/carte/${card.id}">Voir la fiche et la courbe</a>`;
  }

  resultBox.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const act = button.dataset.act;
    if (act === 'again') return resume();
    if (act === 'pick') {
      const card = current.choices.find((c) => c.id === Number(button.dataset.id));
      if (card) { current = { card }; pill.textContent = 'Carte reconnue'; drawResult(); }
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
      const result = await read(image);
      if (result.candidates.length) return detected(result.candidates);
      pill.textContent = before;
      resultBox.innerHTML = `<div class="banner">Photo non reconnue${result.number ? ` (lu ${esc(result.number)}${result.official ? `/${esc(result.official)}` : ''})` : ''}. Cadrez la carte entière, sans reflet en bas à gauche.</div>`;
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
