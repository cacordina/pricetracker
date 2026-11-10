// Enveloppe uPlot : courbes de prix en euros, thème sombre.
import { sliceRange, formatEuro } from './metrics.js';

const charts = new WeakMap();

/**
 * @param el      conteneur
 * @param data    { dates: string[], series: [{ label, values (centimes), dash?, color? }] }
 * @param range   "7" | "30" | "90" | "all"
 */
export function renderPriceChart(el, { dates, series }, range = '30', { height = 150 } = {}) {
  charts.get(el)?.destroy();
  charts.delete(el);
  el.replaceChildren();

  const from = sliceRange(dates, range);
  const shown = dates.slice(from);
  const points = series.map((s) => s.values.slice(from));
  const known = points[0]?.filter((v) => v !== null && v !== undefined).length ?? 0;

  if (known < 2 || !window.uPlot) {
    const p = document.createElement('p');
    p.className = 'state';
    p.textContent = !window.uPlot
      ? 'Courbe indisponible (bibliothèque non chargée).'
      : known === 1
        ? `Suivi commencé le ${frDate(shown.at(-1))}. La courbe apparaîtra avec les prochains relevés.`
        : 'Pas encore de prix enregistré pour cette carte.';
    el.append(p);
    return;
  }

  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--text').trim();
  const muted = css.getPropertyValue('--muted').trim();
  const grid = '#ffffff12';
  const x = shown.map((d) => Date.parse(`${d}T12:00:00Z`) / 1000);
  const y = points.map((vals) => vals.map((v) => (v === null || v === undefined ? null : v / 100)));

  const chart = new window.uPlot({
    width: el.clientWidth || 320,
    height,
    padding: [8, 8, 0, 0],
    cursor: { y: false, points: { size: 6 } },
    legend: { show: false },
    scales: { x: { time: true } },
    axes: [
      { stroke: muted, grid: { stroke: grid }, ticks: { show: false }, font: '11px system-ui', space: 60,
        values: (u, ticks) => ticks.map((t) => new Date(t * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })) },
      { stroke: muted, grid: { stroke: grid }, ticks: { show: false }, font: '11px system-ui', size: 52,
        values: (u, ticks) => ticks.map((t) => `${t >= 100 ? Math.round(t) : t.toFixed(t < 10 ? 2 : 1).replace('.', ',')} €`) },
    ],
    series: [
      {},
      ...series.map((s, i) => ({
        label: s.label,
        stroke: s.color ?? (i === 0 ? text : muted),
        width: i === 0 ? 2 : 1.25,
        dash: s.dash ? [4, 4] : undefined,
        spanGaps: false, // un jour sans relevé reste un trou : on n'invente pas de valeur
        points: { show: shown.length <= 15, size: 5 },
      })),
    ],
    hooks: {
      setCursor: [(u) => {
        const i = u.cursor.idx;
        const out = el.nextElementSibling?.classList.contains('readout') ? el.nextElementSibling : null;
        if (!out) return;
        out.textContent = i === null || i === undefined
          ? ''
          : `${frDate(shown[i])} · ` + series.map((s, k) => `${s.label} ${formatEuro(points[k][i])}`).join(' · ');
      }],
    },
  }, [x, ...y], el);
  charts.set(el, chart);

  if (!el.dataset.resize) {
    el.dataset.resize = '1';
    new ResizeObserver(() => charts.get(el)?.setSize({ width: el.clientWidth, height })).observe(el);
  }
}

export function frDate(iso) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
