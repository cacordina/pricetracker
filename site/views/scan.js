// Scanner : lit la série et le numéro imprimés en bas à gauche d'une carte, puis propose les cartes correspondantes.
import { parseScan, mergeScans } from '../lib/scan.js';
import { prepare, readCardPasses } from '../lib/ocr.js';
import { COL } from '../lib/metrics.js';
import { cardRow, chips, onChip, esc, loadPrefs, savePrefs } from '../lib/ui.js';

const CARD_RATIO = 63 / 88;
// Deux cadrages : gros plan sur le quart inférieur de la carte (chiffres plus grands, plus fiable) ou carte entière.
const MODES = {
  close: { label: 'Bas de la carte', ratio: 63 / 22, cardTop: 0.75, hint: 'Approchez-vous : le quart inférieur de la carte doit remplir le cadre, bord bas de la carte sur le bord bas du cadre.' },
  full: { label: 'Carte entière', ratio: CARD_RATIO, cardTop: 0, hint: 'Cadrez la carte entière dans le cadre, bien à plat.' },
};
const MODE_CHIPS = Object.entries(MODES).map(([value, m]) => ({ value, label: m.label }));

/** Recadre la source aux proportions du cadre affiché (comme l'aperçu à l'écran) et renvoie un canvas. */
function frameCanvas(source, ratio) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  let w = sw;
  let h = Math.round(sw / ratio);
  if (h > sh) { h = sh; w = Math.round(sh * ratio); }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(source, Math.round((sw - w) / 2), Math.round((sh - h) / 2), w, h, 0, 0, w, h);
  return canvas;
}

export async function render(root, { catalog, snapshot, store }) {
  const prefs = loadPrefs('scan', { mode: 'close' });
  if (!MODES[prefs.mode]) prefs.mode = 'close';
  root.innerHTML = `
    <div class="toolbar"><h1>Scanner une carte</h1><a class="link" href="#/recherche">← Recherche</a></div>
    ${chips('mode', MODE_CHIPS, prefs.mode)}
    <div class="muted" id="hint"></div>
    <div class="scan-frame" id="frame"><video id="video" playsinline muted></video><div class="scan-zone"></div>
      <p class="state" id="cam-msg">Démarrage de la caméra…</p></div>
    <div class="muted" style="text-align:center">La série et le numéro sont en bas à gauche de la carte (zone en pointillés). Évitez les reflets dessus.</div>
    <button type="button" class="btn" id="shoot" disabled>Scanner</button>
    <label class="btn sec" style="cursor:pointer">Choisir une photo de la carte entière<input type="file" id="file" accept="image/*" hidden></label>
    <div id="status" class="muted" style="margin-top:10px;min-height:1.4em" aria-live="polite"></div>
    <div id="results"></div>`;

  const frame = root.querySelector('#frame');
  function applyMode() {
    const mode = MODES[prefs.mode];
    frame.style.aspectRatio = String(mode.ratio);
    frame.classList.toggle('close', prefs.mode === 'close');
    root.querySelector('#hint').textContent = mode.hint;
    for (const chip of root.querySelectorAll('[data-group=mode] .chip')) chip.classList.toggle('on', chip.dataset.value === prefs.mode);
  }
  onChip(root, (group, value) => {
    if (group !== 'mode') return;
    prefs.mode = value;
    savePrefs('scan', prefs);
    applyMode();
  });
  applyMode();

  const video = root.querySelector('#video');
  const shoot = root.querySelector('#shoot');
  const status = root.querySelector('#status');
  const results = root.querySelector('#results');
  const camMsg = root.querySelector('#cam-msg');
  let stream = null;
  let owned = new Map();
  let connected = false;
  store.listHoldings().then((rows) => { owned = new Map(rows.map((r) => [r.id_product, r.qty])); connected = true; }).catch(() => {});

  const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  window.addEventListener('hashchange', stop, { once: true });

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      camMsg.textContent = 'Caméra indisponible dans ce navigateur. Utilisez « Choisir une photo ».';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
      video.srcObject = stream;
      await video.play();
      camMsg.hidden = true;
      shoot.disabled = false;
    } catch {
      camMsg.textContent = 'Caméra refusée ou indisponible. Autorisez-la pour ce site, ou utilisez « Choisir une photo ».';
    }
  }

  async function scan(source, mode) {
    shoot.disabled = true;
    results.innerHTML = '';
    status.textContent = 'Lecture en cours… (le premier scan télécharge le moteur de lecture, environ 6 Mo)';
    try {
      const texts = await readCardPasses(frameCanvas(source, mode.ratio), { cardTop: mode.cardTop });
      show(mergeScans(texts.map((text) => parseScan(text, catalog))), texts.join(' | '));
    } catch (err) {
      status.textContent = `Lecture impossible : ${err.message}`;
    } finally {
      shoot.disabled = !stream;
    }
  }

  function show(found, text) {
    const read = found.number
      ? `Lu : ${found.sets.length ? `série ${found.sets.join(', ')}, ` : ''}numéro ${found.number}${found.official ? `/${found.official}` : ''}`
      : 'Numéro non lu';
    if (!found.candidates.length) {
      status.innerHTML = `${esc(read)}. Aucune carte trouvée : rapprochez la carte, évitez les reflets, puis réessayez.
        <br><span style="opacity:.7">Texte brut : ${esc(text.slice(0, 120)) || '(rien)'}</span>`;
      return;
    }
    status.textContent = `${read}. ${found.candidates.length > 1 ? 'Plusieurs cartes possibles, choisissez la bonne :' : 'Carte trouvée :'}`;
    results.innerHTML = found.candidates.map((card) => {
      const row = snapshot.cards[card.id];
      const qty = owned.get(card.id) ?? 0;
      return `${cardRow(card, catalog.sets, { trend: row?.[COL.trend] ?? null, change: row?.[COL.d7] ?? null })}
        ${connected ? `<button type="button" class="btn sec" data-add="${card.id}" style="margin:0 0 10px">${qty ? `Dans ma collection (×${qty}) — en ajouter une` : '+ Ajouter à ma collection'}</button>` : ''}`;
    }).join('');
  }

  results.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-add]');
    if (!button) return;
    const id = Number(button.dataset.add);
    button.disabled = true;
    try {
      const next = (owned.get(id) ?? 0) + 1;
      await store.setHolding(id, next);
      owned.set(id, next);
      button.textContent = `✓ Ajoutée — dans ma collection (×${next})`;
    } catch (err) {
      button.textContent = `Non enregistré : ${err.message}`;
    } finally {
      button.disabled = false;
    }
  });

  shoot.onclick = () => scan(video, MODES[prefs.mode]);
  root.querySelector('#file').onchange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const image = new Image();
    image.src = URL.createObjectURL(file);
    try {
      await image.decode();
      await scan(image, MODES.full);
    } catch {
      status.textContent = 'Cette photo n’a pas pu être ouverte.';
    } finally {
      URL.revokeObjectURL(image.src);
    }
  };

  root._start = () => { startCamera(); prepare().catch(() => {}); };
}

export function mounted(root) {
  root._start?.();
}
