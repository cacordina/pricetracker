// Scanner automatique : la caméra lit en continu la série et le numéro imprimés en bas à gauche de la carte.
// Chaque carte reconnue rejoint une liste, qu'on ajoute ensuite à la collection en une fois.
import { parseScan, mergeScans, createTracker, createEvidence } from '../lib/scan.js';
import { prepare, readCardPasses } from '../lib/ocr.js';
import { COL, displayName, formatEuro } from '../lib/metrics.js';
import { cardImg, esc } from '../lib/ui.js';

const CARD_RATIO = 63 / 88;

// La liste survit à un aller-retour vers une fiche carte.
// Entrée : { key, card, qty } pour une carte reconnue, { key, choices } quand plusieurs cartes sont possibles.
let session = [];
let nextKey = 1;

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
    <div class="muted" style="text-align:center">Présentez la carte entière dans le cadre : elle est reconnue toute seule, puis passez à la suivante.</div>
    <div class="toolbar" style="margin-top:6px">
      <button type="button" class="link" id="pause">Mettre en pause</button>
      <label class="link" style="cursor:pointer">Choisir une photo<input type="file" id="file" accept="image/*" hidden></label>
    </div>
    <div id="list"></div>`;

  const frame = root.querySelector('#frame');
  const video = root.querySelector('#video');
  const pill = root.querySelector('#pill');
  const toast = root.querySelector('#toast');
  const torch = root.querySelector('#torch');
  const pauseButton = root.querySelector('#pause');
  const list = root.querySelector('#list');

  const tracker = createTracker();
  const evidence = createEvidence(catalog); // cumule ce qui est lu d'une image à l'autre
  let stream = null;
  let alive = true;
  let paused = false;
  let timer = null;
  let toastTimer = null;
  let owned = new Map();
  let connected = false;
  let notice = '';

  store.listHoldings()
    .then((rows) => { owned = new Map(rows.map((r) => [r.id_product, r.qty])); connected = true; drawList(); })
    .catch(() => { drawList(); });

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
      else if (result.candidates.length) pill.textContent = 'Carte reconnue — présentez la suivante';
      else pill.textContent = result.number ? `Lu ${result.number}${result.official ? `/${result.official}` : ''}… je vérifie` : 'Recherche d’une carte…';
    } catch (err) {
      pill.textContent = `Lecture impossible : ${err.message}`;
      return wait(3000);
    }
    wait(200);
  }

  function detected(candidates) {
    navigator.vibrate?.(60);
    frame.classList.add('hit');
    setTimeout(() => frame.classList.remove('hit'), 500);
    if (candidates.length === 1) {
      addCard(candidates[0]);
      const card = candidates[0];
      showToast(`✓ ${displayName(card)} · ${card.s} ${card.n} · ${formatEuro(price(card))}`);
      pill.textContent = 'Carte reconnue — présentez la suivante';
    } else {
      session.unshift({ key: nextKey++, choices: candidates });
      showToast(`${candidates.length} cartes possibles : choisissez dans la liste`);
      pill.textContent = 'Plusieurs cartes possibles — choisissez dans la liste';
    }
    notice = '';
    drawList();
  }

  function addCard(card) {
    const existing = session.find((e) => e.card?.id === card.id);
    if (existing) existing.qty += 1;
    else session.unshift({ key: nextKey++, card, qty: 1 });
  }

  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  // ---------- Liste des cartes scannées ----------
  function drawList() {
    const cards = session.filter((e) => e.card);
    const count = cards.reduce((n, e) => n + e.qty, 0);
    const total = cards.reduce((n, e) => n + (price(e.card) ?? 0) * e.qty, 0);
    if (!session.length) {
      list.innerHTML = notice ? `<div class="banner">${esc(notice)}</div>` : '';
      return;
    }
    const pending = session.some((e) => e.choices);
    list.innerHTML = `
      ${notice ? `<div class="banner">${esc(notice)}</div>` : ''}
      <div class="toolbar"><h2>Cartes scannées · ${count}</h2><span class="muted">${formatEuro(total)}</span></div>
      ${session.map(entry).join('')}
      ${connected
        ? `<button type="button" class="btn" id="save" ${count ? '' : 'disabled'}>Ajouter ${count > 1 ? `ces ${count} cartes` : 'cette carte'} à ma collection</button>
           ${pending ? '<div class="muted" style="text-align:center;margin-top:4px">Les cartes à choisir ne sont pas comptées.</div>' : ''}`
        : '<a class="btn sec" href="#/connexion">Se connecter pour les ajouter à ma collection</a>'}
      <p style="text-align:center"><button type="button" class="link" id="clear">Vider la liste</button></p>`;
  }

  function entry(e) {
    if (e.choices) {
      return `<div class="box" data-key="${e.key}">
        <div class="line"><b>Laquelle est-ce ?</b><button type="button" class="link" data-act="drop">Ignorer</button></div>
        <div class="grid" style="margin-top:8px">${e.choices.map((card) => `
          <button type="button" class="tile choice" data-act="pick" data-id="${card.id}">
            ${cardImg(card, catalog.sets)}<div class="muted">${esc(card.s)} ${esc(card.n)}</div></button>`).join('')}</div>
      </div>`;
    }
    const have = owned.get(e.card.id) ?? 0;
    return `<div class="row" data-key="${e.key}">
      <a href="#/carte/${e.card.id}">${cardImg(e.card, catalog.sets)}</a>
      <div class="name"><b>${esc(displayName(e.card))}</b>
        <div class="muted">${esc(e.card.s)} · ${esc(e.card.n)} · ${formatEuro(price(e.card))}${have ? ` · déjà ×${have}` : ''}</div></div>
      <span class="stepper"><button type="button" data-act="minus" aria-label="Retirer un exemplaire">−</button>
        <b>${e.qty}</b><button type="button" data-act="plus" aria-label="Ajouter un exemplaire">+</button></span>
    </div>`;
  }

  list.addEventListener('click', async (event) => {
    if (event.target.closest('#clear')) { session = []; notice = ''; tracker.reset(); evidence.clear(); return drawList(); }
    if (event.target.closest('#save')) return saveAll(event.target.closest('#save'));
    const button = event.target.closest('[data-act]');
    const key = Number(button?.closest('[data-key]')?.dataset.key);
    const index = session.findIndex((e) => e.key === key);
    if (!button || index < 0) return;
    const item = session[index];
    const act = button.dataset.act;
    if (act === 'plus') item.qty += 1;
    else if (act === 'minus') { item.qty -= 1; if (item.qty <= 0) session.splice(index, 1); }
    else if (act === 'drop') session.splice(index, 1);
    else if (act === 'pick') {
      const card = item.choices.find((c) => c.id === Number(button.dataset.id));
      session.splice(index, 1);
      if (card) addCard(card);
    }
    drawList();
  });

  async function saveAll(button) {
    button.disabled = true;
    button.textContent = 'Enregistrement…';
    const cards = session.filter((e) => e.card);
    let done = 0;
    try {
      for (const e of cards) {
        const next = (owned.get(e.card.id) ?? 0) + e.qty;
        await store.setHolding(e.card.id, next);
        owned.set(e.card.id, next);
        session = session.filter((x) => x !== e); // une carte enregistrée quitte la liste : pas de double ajout si la suite échoue
        done += e.qty;
      }
      notice = `${done} carte${done > 1 ? 's ajoutées' : ' ajoutée'} à votre collection.`;
    } catch (err) {
      notice = `${done ? `${done} carte${done > 1 ? 's ajoutées' : ' ajoutée'}, puis ` : ''}échec : ${err.message} Les cartes restantes sont toujours dans la liste.`;
    }
    drawList();
  }

  // ---------- Pause et photo ----------
  pauseButton.onclick = () => {
    paused = !paused;
    pauseButton.textContent = paused ? 'Reprendre le scan' : 'Mettre en pause';
    pill.textContent = paused ? 'En pause' : 'Recherche d’une carte…';
    frame.classList.toggle('paused', paused);
  };

  root.querySelector('#file').onchange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const image = new Image();
    image.src = URL.createObjectURL(file);
    pill.textContent = 'Lecture de la photo…';
    try {
      await image.decode();
      const result = await read(image);
      if (result.candidates.length) detected(result.candidates);
      else { notice = `Photo non reconnue${result.number ? ` (lu ${result.number}${result.official ? `/${result.official}` : ''})` : ''}. Cadrez la carte entière, sans reflet en bas à gauche.`; drawList(); }
    } catch {
      notice = 'Cette photo n’a pas pu être lue.';
      drawList();
    } finally {
      URL.revokeObjectURL(image.src);
      pill.textContent = paused ? 'En pause' : 'Recherche d’une carte…';
    }
  };

  drawList();
  root._start = () => { prepare().catch(() => {}); startCamera(); };
}

export function mounted(root) {
  root._start?.();
}
