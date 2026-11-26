import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysSince } from '../site/lib/shell.js';

test('prix anciens : jours de calendrier, quelle que soit l’heure', () => {
  const at = (iso) => new Date(iso);
  assert.equal(daysSince('2026-11-13', at('2026-11-15T08:02:00')), 2); // le cas du 15 novembre : bandeau
  assert.equal(daysSince('2026-11-14', at('2026-11-15T23:59:00')), 1); // la veille : pas de bandeau
  assert.equal(daysSince('2026-11-15', at('2026-11-15T00:01:00')), 0);
  assert.equal(daysSince(null), 0);
});

test('ligne de carte : le sous-titre est échappé', async () => {
  globalThis.window ??= {}; // ui.js installe le repli d'image sur window au chargement
  const { cardRow } = await import('../site/lib/ui.js');
  const html = cardRow({ id: 1, s: 'SV8a', n: '212', ja: 'x', fr: 'Nymphali <b>ex</b>' }, {}, { trend: 100, change: null, sub: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('<img src=x'), 'sous-titre non échappé');
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(html.includes('Nymphali &lt;b&gt;ex&lt;/b&gt;'));
});
