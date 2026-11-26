// Mise en forme des montants et pourcentages, à la française (espaces fines, virgule décimale).

const NBSP = ' ';
const THIN = ' ';

export function formatEuro(cents) {
  if (cents === null || cents === undefined) return '—';
  const [int, dec] = (Math.abs(cents) / 100).toFixed(2).split('.');
  return `${cents < 0 ? '−' : ''}${int.replace(/\B(?=(\d{3})+$)/g, THIN)},${dec}${NBSP}€`;
}

/** Centimes de dollar → « 85,20 $ ». */
export const formatUsd = (cents) => formatEuro(cents).replace('€', '$');

export function formatPct(value) {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(1).replace('.', ',')}${NBSP}%`;
}
