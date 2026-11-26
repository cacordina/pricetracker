#!/usr/bin/env node
// Test des écrans : chaque écran du site s'ouvre sans erreur sur des données réelles, et les parcours sensibles
// (ajout de cartes, bouton retour, retour au même endroit d'une liste) fonctionnent.
// Usage : node tests/e2e/smoke.mjs <dossier du site assemblé, avec data/>
// Demande Playwright et Chromium ; aucun accès extérieur (Supabase est remplacé par tests/e2e/fake-store.js).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = process.argv[2];
if (!siteDir) { console.error('Usage : node tests/e2e/smoke.mjs <dossier du site>'); process.exit(2); }
const fakeStore = fileURLToPath(new URL('./fake-store.js', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// Petit serveur de fichiers statiques.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const file = path.endsWith('/') ? `${path}index.html` : path;
    const body = await readFile(join(siteDir, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 400, height: 860 }, serviceWorkers: 'block' });
await context.route('**/lib/store.js', (route) => route.fulfill({ path: fakeStore, contentType: 'text/javascript' }));
await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort()); // rien ne sort
const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));

const failures = [];
async function check(label, fn) {
  errors.length = 0;
  try {
    await fn();
    if (errors.length) throw new Error(`erreur JavaScript : ${errors.join(' | ')}`);
    const text = await page.locator('#view').innerText();
    if (/Impossible de charger|undefined|NaN/.test(text)) throw new Error(`texte suspect à l'écran : ${text.match(/.{0,40}(Impossible de charger|undefined|NaN).{0,40}/)[0]}`);
    console.log(`ok   ${label}`);
  } catch (err) {
    failures.push(label);
    console.log(`ÉCHEC ${label} : ${err.message}`);
  }
}
const go = async (hash) => { await page.goto(base + hash); await page.locator('#view > div:not(.skeleton)').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(300); };
const hash = () => new URL(page.url()).hash;
const expect = (cond, message) => { if (!cond) throw new Error(message); };

const catalog = JSON.parse(await readFile(join(siteDir, 'data/catalog.json'), 'utf8'));
const someSet = Object.keys(catalog.sets).find((s) => catalog.cards.some((c) => c.s === s && c.r === 'AR'));
const someCard = catalog.cards.find((c) => c.s === someSet && c.r === 'AR');

await check('accueil', async () => {
  await go('#/accueil');
  expect(await page.locator('.quick a').count() === 4, 'tuiles de l’accueil');
  expect(await page.locator('#to-moves').count() === 1, 'section « Ma collection sur 7 jours » absente');
});
await check('polices hébergées avec le site, chargées', async () => {
  await go('#/accueil');
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      barlow: document.fonts.check('600 16px "Barlow Semi Condensed"'),
      zen: document.fonts.check('700 16px "Zen Kaku Gothic New"'),
      external: [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href).filter((h) => !h.startsWith(location.origin)),
    };
  });
  expect(!fonts.external.length, `feuille de style externe : ${fonts.external.join(', ')}`);
  expect(fonts.barlow && fonts.zen, `polices non chargées : ${JSON.stringify(fonts)}`);
});
for (const tab of ['up', 'down', 'deals']) {
  await check(`marché, onglet ${tab}`, async () => { await go('#/marche'); await page.click(`[data-group=tab] [data-value=${tab}]`); await page.waitForTimeout(200); });
}
await check('recherche', async () => {
  await go('#/recherche'); await page.fill('#q', someSet); await page.waitForTimeout(200);
  expect(await page.locator('#results .row').count() > 0, 'aucun résultat pour une extension existante');
});
await check('liste des extensions (onglet Explorer)', async () => {
  await go('#/extensions');
  expect(await page.locator('#list .row').count() > 5, 'liste trop courte');
  expect(await page.locator('#back').isHidden(), 'bouton retour sur une page d’onglet');
  expect(await page.locator('.tabs a.on').getAttribute('data-tab') === 'explorer', 'onglet Explorer non allumé');
  await page.click('[data-group=series] [data-value=all]'); await page.waitForTimeout(200);
  expect(await page.locator('#list .row').count() > 50, 'toutes les séries : liste trop courte');
});
await check('Explorer : passer du marché aux extensions', async () => {
  await go('#/marche'); await page.click('.seg a[href="#/extensions"]'); await page.waitForTimeout(800);
  expect(hash() === '#/extensions', `onglet du haut vers ${hash()}`);
});
await check('page d’une extension', async () => { await go(`#/extension/${encodeURIComponent(someSet)}`); expect(await page.locator('.grid .tile').count() > 0, 'pas de vignettes'); });
await check('toutes les AR : extensions repliables', async () => {
  await go('#/album');
  const groups = page.locator('details.setgroup');
  expect(await groups.count() > 5, 'pas d’extensions');
  expect(await page.locator('details.setgroup[open]').count() === 0, 'extensions dépliées par défaut');
  await groups.first().locator('summary').click(); await page.waitForTimeout(200);
  expect(await groups.first().locator('.tile').first().isVisible(), 'cartes invisibles après dépliage');
});
await check('fiche carte', async () => { await go(`#/carte/${someCard.id}`); expect(await page.locator('.card-head .big, .card-head p').count() > 0, 'pas de prix'); });
await check('collection', async () => { await go('#/collection'); expect(await page.locator('.grid .tile').count() === 3, 'les 3 cartes possédées'); });
await check('envies', async () => { await go('#/envies'); expect(await page.locator('#view .row').count() === 1, 'l’envie'); });
await check('connexion', async () => { await go('#/connexion'); });

await check('ajouter des cartes : page d’extension en mode ajout, ajout en un geste', async () => {
  await go('#/accueil'); await page.click('.quick a[href="#/ajout"]'); await page.waitForTimeout(1500);
  expect(hash().startsWith('#/extension/'), `redirigé vers ${hash()}`);
  expect((await page.locator('[data-group=mode] .chip.on').innerText()).startsWith('Ajouter'), 'mode ajout');
  const before = await page.evaluate(() => window.__store.holdings.size);
  await page.locator('.grid .tile.pick:not(.owned)').first().click(); await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__store.holdings.size) === before + 1, 'carte non ajoutée');
  const sizes = await page.locator('.grid .tile.owned .stepper button').evaluateAll((bs) => bs.map((b) => [Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)]));
  expect(sizes.length && sizes.every(([w, h]) => w >= 40 && h >= 44), `boutons − et + trop petits : ${JSON.stringify(sizes.slice(0, 2))}`);
  await page.click('[data-group=mode] [data-value=browse]'); // remettre le mode Parcourir pour la suite
});

await check('retour arrière au même endroit de la liste, puis bouton retour', async () => {
  await go('#/accueil'); await page.click('.quick a[href="#/extensions"]'); await page.waitForTimeout(800);
  await page.click('#list .row >> nth=0'); await page.waitForTimeout(1200);
  await page.mouse.wheel(0, 1500);
  // Le défilement à la molette est amorti : attendre qu'il soit fini.
  let y = -1;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const now = await page.evaluate(() => Math.round(scrollY));
    if (now === y) break;
    y = now;
  }
  expect(y > 0, 'la liste n’a pas défilé');
  // Ce que voit l'utilisateur : la carte au milieu de l'écran. Au retour, ce doit être la même.
  const middle = () => page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('a.tile')?.getAttribute('href') ?? null);
  const seen = await middle();
  expect(seen, 'aucune vignette au milieu de l’écran');
  // Toucher une vignette visible, sans que le test fasse défiler la page.
  const boxes = await page.locator('.grid a.tile').evaluateAll((tiles) => tiles.map((t) => t.getBoundingClientRect().toJSON()));
  const target = boxes.find((b) => b.top > 120 && b.bottom < 700);
  expect(target, 'aucune vignette visible');
  await page.mouse.click(target.left + target.width / 2, target.top + target.height / 2); await page.waitForTimeout(1000);
  expect(hash().startsWith('#/carte/'), 'fiche non ouverte');
  await page.click('#back'); await page.waitForTimeout(1200);
  expect(hash().startsWith('#/extension/'), `retour vers ${hash()}`);
  const after = await middle();
  expect(after === seen, `pas au même endroit de la liste (avant : ${seen} au milieu de l’écran, au retour : ${after})`);
  await page.click('#back'); await page.waitForTimeout(800);
  expect(hash() === '#/extensions', `second retour vers ${hash()}`);
});

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} écran(s) en échec : ${failures.join(', ')}` : '\nTous les écrans s’ouvrent sans erreur.');
process.exit(failures.length ? 1 : 0);
