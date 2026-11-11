// Écran Marché : hausses, baisses et bonnes affaires parmi les cartes japonaises.
import { marketList, cheaperInEurope, formatEuro } from '../lib/metrics.js';
import { loadUsSnapshot } from '../lib/data.js';
import { cardRow, chips, onChip, loadPrefs, savePrefs, esc } from '../lib/ui.js';
import { frDate } from '../lib/chart.js';

const DEFAULTS = { rarities: ['AR', 'SAR'], tab: 'up', window: 7, minEuros: 10, dealPct: 15, usPct: 20 };
const RARITY_CHIPS = [{ value: 'AR', label: 'AR' }, { value: 'SAR', label: 'SAR' }, { value: 'secret', label: 'Secrètes' }, { value: 'all', label: 'Tout' }];
const TAB_CHIPS = [{ value: 'up', label: 'Hausses' }, { value: 'down', label: 'Baisses' }, { value: 'deals', label: 'Bonnes affaires' }, { value: 'us', label: 'Moins cher qu’aux US' }];
const US_CHIPS = [10, 20, 40].map((v) => ({ value: String(v), label: `+${v} % ou plus` }));
const WINDOW_CHIPS = [{ value: '7', label: '7 j' }, { value: '30', label: '30 j' }];
const MIN_CHIPS = [0, 5, 10, 50].map((v) => ({ value: String(v), label: v ? `≥ ${v} €` : 'Tous prix' }));
const DEAL_CHIPS = [10, 15, 25].map((v) => ({ value: String(v), label: `−${v} % ou plus` }));

export async function render(root, { catalog, snapshot }) {
  const prefs = loadPrefs('market', DEFAULTS);
  const us = await loadUsSnapshot();
  if (prefs.tab === 'us' && !us?.rate) prefs.tab = 'up'; // prix TCGplayer pas encore publiés

  function draw() {
    const all = prefs.rarities === null;
    const list = prefs.tab === 'us'
      ? cheaperInEurope(catalog, snapshot, us, { rarities: prefs.rarities, minCents: prefs.minEuros * 100, minGap: prefs.usPct })
      : marketList(catalog, snapshot, {
        rarities: prefs.rarities, tab: prefs.tab, window: prefs.window,
        minCents: prefs.minEuros * 100, dealRatio: 1 - prefs.dealPct / 100,
      });
    const approx = prefs.tab !== 'deals' && prefs.tab !== 'us' && snapshot.approx?.[prefs.window === 30 ? 'd30' : 'd7'];
    const empty = prefs.tab === 'us'
      ? 'Aucune carte avec un tel écart avec ces filtres.'
      : prefs.tab === 'deals'
      ? 'Aucune bonne affaire avec ces filtres.'
      : `Aucune ${prefs.tab === 'up' ? 'hausse' : 'baisse'} avec ces filtres.`;
    root.innerHTML = `
      <h1>Marché japonais</h1>
      <div class="muted">Prix Cardmarket du ${esc(frDate(snapshot.date))}${prefs.tab === 'us' ? ` · TCGplayer du ${esc(frDate(us.date))}` : ''}</div>
      ${chips('rarity', RARITY_CHIPS, all ? 'all' : prefs.rarities)}
      ${chips('tab', us?.rate ? TAB_CHIPS : TAB_CHIPS.filter((c) => c.value !== 'us'), prefs.tab)}
      ${prefs.tab === 'us'
        ? `<div class="muted">Prix TCGplayer (converti en euros) au-dessus du prix Cardmarket d’au moins :</div>${chips('us', US_CHIPS, String(prefs.usPct))}`
        : prefs.tab === 'deals'
        ? `<div class="muted">Prix du jour sous la moyenne 30 jours d’au moins :</div>${chips('deal', DEAL_CHIPS, String(prefs.dealPct))}`
        : chips('window', WINDOW_CHIPS, String(prefs.window))}
      ${chips('min', MIN_CHIPS, String(prefs.minEuros))}
      ${approx ? '<div class="banner">Historique encore court : variation estimée par rapport à la moyenne Cardmarket.</div>' : ''}
      ${list.length
        ? list.map(({ card, trend, change, usEur }) => cardRow(card, catalog.sets, { trend, change, ...(usEur !== undefined ? { sub: `TCGplayer ≈ ${formatEuro(usEur)}` } : {}) })).join('')
        : `<p class="state">${empty}</p>`}
      ${list.length === 100 ? '<p class="muted" style="text-align:center;margin-top:12px">100 premières cartes affichées.</p>' : ''}`;
  }

  onChip(root, (group, value) => {
    if (group === 'rarity') {
      if (value === 'all') prefs.rarities = null;
      else {
        const current = new Set(prefs.rarities ?? []);
        current.has(value) ? current.delete(value) : current.add(value);
        prefs.rarities = current.size ? [...current] : null;
      }
    } else if (group === 'tab') prefs.tab = value;
    else if (group === 'window') prefs.window = Number(value);
    else if (group === 'min') prefs.minEuros = Number(value);
    else if (group === 'deal') prefs.dealPct = Number(value);
    else if (group === 'us') prefs.usPct = Number(value);
    savePrefs('market', prefs);
    draw();
  });
  draw();
}
