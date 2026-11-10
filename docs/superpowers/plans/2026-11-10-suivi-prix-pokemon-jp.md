# Suivi de prix Pokémon JP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un site statique, mis à jour chaque jour par GitHub Actions, qui suit les prix Cardmarket des cartes Pokémon japonaises, avec collection et liste d'envies privées.

**Architecture:** Des scripts Node sans dépendance construisent une table des cartes japonaises (TCGdex) et ajoutent chaque jour les prix Cardmarket filtrés à un historique compact par extension, publié sur une branche `data`. Un site en modules ES sans étape de build lit ces fichiers ; collection et envies vivent dans Supabase derrière une connexion.

**Tech Stack:** Node ≥ 22 (`node:test`, `fetch` natif), JavaScript modules ES, uPlot 1.6.31 et `@supabase/supabase-js` 2.x chargés par CDN, GitHub Actions + Pages, Supabase (Postgres + Auth).

**Spec:** `docs/superpowers/specs/2026-11-10-suivi-prix-pokemon-jp-design.md`

## Global Constraints

- Sources de données : uniquement les deux exports `downloads.s3.cardmarket.com` et l'API `api.tcgdex.net/v2/ja`. Aucune requête vers les pages Cardmarket.
- Filtre japonais = `idProduct` présent dans `catalog.json`. Rien d'autre n'est stocké.
- Prix en **centimes entiers** ; `null` conservé, jamais remplacé par 0.
- Prix stockés par jour : `trend`, `low`, `avg1`. `avg7`/`avg30` uniquement dans l'instantané. Colonnes `-holo` ignorées.
- Date d'un jour = les 10 premiers caractères de `createdAt` du fichier de prix.
- Prix de référence affiché : `trend`.
- Rareté : valeurs `"AR" | "SAR" | "secret" | "regular" | "unknown"`. Jamais AR ou SAR sans certitude.
- Aucune donnée personnelle dans le dépôt (public). Aucune image stockée.
- Scripts : zéro dépendance npm. Site : aucun build, téléphone d'abord (largeur 360 px sans défilement horizontal), thème sombre, textes en français.
- Seuil « bonne affaire » par défaut : `trend ≤ avg30 × 0,85`.
- Garde-fou de publication : cartes japonaises avec `trend` non nul ≥ 80 % de la veille.
- Création du dépôt GitHub, activation de Pages, création du projet Supabase : **demander confirmation à l'utilisateur avant d'agir**.

## Review Focus

1. Carte du catalogue absente du fichier de prix ou à prix tous `null` : affichée « pas de prix », exclue du total de la collection, et le total indique combien de cartes sont sans prix. → Tâches 5 et 10.
2. Jour manquant dans l'historique : la variation 7 j / 30 j prend la dernière date connue ≤ J−N, et renvoie `null` si elle est plus vieille que J−N−3 ; la courbe ne relie pas par une valeur inventée. → Tâche 5.
3. Carte ajoutée au catalogue après le début de l'historique : ses séries sont complétées par des `null` pour les dates antérieures, longueurs toujours égales à `dates.length`. → Tâche 4.
4. Supabase injoignable ou session expirée sur téléphone : marché, fiches et recherche restent utilisables ; collection et envies affichent « Connexion requise » ou « Service indisponible, réessayer », sans page blanche. → Tâche 9.
5. Carte possédée dont l'`idProduct` disparaît du catalogue : elle reste listée comme « Carte inconnue (n° idProduct) », jamais supprimée silencieusement. → Tâche 10.

## Structure des fichiers

```
package.json                     type module, script "test": "node --test"
scripts/lib/money.mjs            conversion euros → centimes
scripts/lib/tcgdex.mjs           client TCGdex poli (débit, reprises, cache)
scripts/lib/catalog.mjs          assemblage du catalogue + rapport de couverture
scripts/lib/rarity.mjs           classement de rareté + corrections manuelles
scripts/lib/history.mjs          ajout d'un jour à l'historique d'une extension
scripts/lib/guards.mjs           garde-fous de publication
scripts/lib/snapshot.mjs         instantané du jour + variations
scripts/build-catalog.mjs        CLI hebdomadaire
scripts/ingest.mjs               CLI quotidien
overrides/rarity.json            { "<idProduct>": "AR" | "SAR" | ... }
tests/fixtures/                  extraits réels des exports et de TCGdex
tests/*.test.mjs
site/index.html, site/styles.css, site/app.js (routeur par hash)
site/config.js                   URL des données, URL et clé publique Supabase
site/lib/data.js                 chargement catalogue / instantané / historiques
site/lib/metrics.js              fonctions pures : valeur, tri, bonnes affaires
site/lib/store.js                Supabase : session, possessions, envies
site/lib/chart.js                enveloppe uPlot
site/views/{market,card,search,collection,quickadd,wishlist,login}.js
supabase/migrations/0001_init.sql
.github/workflows/daily.yml, .github/workflows/catalog.yml
```

Fichiers de données (répertoire `data/`, branche `data`) :

- `catalog.json` : `{ builtAt, sets: { [setId]: { name, official, total } }, cards: [{ id, t, s, n, ja, en, r }] }` — `id` = idProduct, `t` = id TCGdex, `s` = setId, `n` = numéro, `r` = rareté. Image = `https://assets.tcgdex.net/ja/{série}/{s}/{n}/low.webp`, stockée comme préfixe `img` par extension dans `sets`.
- `history/{setId}.json` : `{ dates: ["2026-11-09", …], cards: { [id]: { t: [], l: [], a: [] } } }` (trend, low, avg1).
- `snapshot.json` : `{ date, approx: { d7: bool, d30: bool }, cards: { [id]: [trend, low, avg1, avg7, avg30, d7, d30] } }` — `d7`/`d30` en pourcentage à une décimale ou `null`.
- `coverage.json` : `{ [setId]: { total, linked } }`.

---

### Task 1: Socle du projet et conversion des prix

**Files:**
- Create: `package.json`, `.gitignore`, `scripts/lib/money.mjs`, `tests/money.test.mjs`
- Create: `tests/fixtures/products.sample.json`, `tests/fixtures/prices.sample.json`

**Interfaces:**
- Produces: `toCents(value: number | null | undefined): number | null`

- [ ] **Step 1:** `git init`, `.gitignore` contenant `.superpowers/`, `data/`, `node_modules/`, `.cache/`.
- [ ] **Step 2:** Fixtures : télécharger les deux exports, garder dans chaque fichier la même enveloppe (`version`, `createdAt`) et uniquement les lignes d'`idProduct` 803303, 803325, 271439, 698452, 922296.
- [ ] **Step 3: Test**

```js
test('toCents', () => {
  assert.equal(toCents(103.24), 10324);
  assert.equal(toCents(0.1), 10);
  assert.equal(toCents(1.005), 101);   // arrondi au centime, pas de dérive flottante
  assert.equal(toCents(0), 0);
  assert.equal(toCents(null), null);
  assert.equal(toCents(undefined), null);
});
```

- [ ] **Step 4:** `node --test` → échec « toCents is not defined ». Implémenter. `node --test` → succès.
- [ ] **Step 5:** Commit `chore: socle du projet et conversion en centimes`.

### Task 2: Catalogue des cartes japonaises

**Files:**
- Create: `scripts/lib/tcgdex.mjs`, `scripts/lib/catalog.mjs`, `scripts/build-catalog.mjs`
- Create: `tests/catalog.test.mjs`, `tests/fixtures/tcgdex-set-SV8a.json` (tronqué à 3 cartes), `tests/fixtures/tcgdex-card-SV8a-212.json`, `…-190.json`, et une carte sans `pricing.cardmarket`

**Interfaces:**
- Produces: `createClient({ fetchImpl, delayMs = 150, retries = 3, cacheDir })` → `{ listSets(): Promise<SetBrief[]>, getSet(id), getCard(id) }`
- Produces: `buildCatalog({ client, products, previous }): Promise<{ catalog, coverage }>` — `products` = tableau `products` de l'export Cardmarket ; `previous` = catalogue précédent ou `null`.
- Produces: CLI `node scripts/build-catalog.mjs --out data [--only SV8a,M2]`

- [ ] **Step 1: Tests** (client simulé qui sert les fixtures)

```js
test('une carte liée entre dans le catalogue', async () => {
  const { catalog } = await buildCatalog({ client, products, previous: null });
  const c = catalog.cards.find(c => c.id === 803325);
  assert.deepEqual({ t: c.t, s: c.s, n: c.n, ja: c.ja }, { t: 'SV8a-212', s: 'SV8a', n: '212', ja: 'ニンフィアex' });
  assert.equal(typeof c.en, 'string');           // nom venu de l'export Cardmarket
  assert.equal(catalog.sets.SV8a.official, 187);
});
test('une carte sans idProduct est ignorée et comptée', async () => {
  const { catalog, coverage } = await buildCatalog({ client, products, previous: null });
  assert.equal(coverage.SV8a.total, 3);
  assert.equal(coverage.SV8a.linked, 2);
  assert.equal(catalog.cards.length, 2);
});
test('une carte déjà connue n’est pas redemandée', async () => {
  const first = await buildCatalog({ client, products, previous: null });
  client.calls.length = 0;
  await buildCatalog({ client, products, previous: first.catalog });
  assert.equal(client.calls.filter(c => c.startsWith('card:')).length, 1); // seule la carte non liée est retentée
});
test('idProduct absent de l’export Cardmarket : en vaut null, carte gardée', …);
```

- [ ] **Step 2:** Échec, implémentation, succès. Le client attend `delayMs` entre deux requêtes, réessaie sur erreur réseau ou 5xx avec attente doublée, et écrit chaque réponse de carte dans `cacheDir` si fourni.
- [ ] **Step 3:** Vérification réelle : `node scripts/build-catalog.mjs --out data --only SV8a,M2`. Attendu : `data/catalog.json` et `data/coverage.json` écrits, taux de liaison affiché par extension.
- [ ] **Step 4:** Lancer la construction complète en arrière-plan (204 extensions, une requête par carte) et noter le taux de couverture global dans le message de commit. **Si moins de 60 % des cartes sont liées, s'arrêter et le signaler à l'utilisateur** avant de poursuivre.
- [ ] **Step 5:** Commit `feat: catalogue des cartes japonaises depuis TCGdex`.

### Task 3: Rareté AR / SAR

**Files:**
- Create: `scripts/lib/rarity.mjs`, `overrides/rarity.json` (`{}`), `tests/rarity.test.mjs`
- Modify: `scripts/lib/catalog.mjs` (renseigner `r`)

**Interfaces:**
- Produces: `classifyRarity({ card, set, sourceRarity, overrides }): "AR"|"SAR"|"secret"|"regular"|"unknown"`

- [ ] **Step 1: Recherche (30 min au plus).** Chercher une source de rareté pour les extensions japonaises : autres champs ou points d'accès TCGdex (`/v2/ja/rarities`, GraphQL, dépôt `tcgdex/cards-database`), autre jeu de données ouvert. Consigner le résultat en tête de `rarity.mjs`.
- [ ] **Step 2: Tests** — valables quelle que soit l'issue de la recherche :

```js
const set = { official: 187 };
test('correction manuelle prioritaire', () =>
  assert.equal(classifyRarity({ card: { id: 1, n: '005' }, set, sourceRarity: null, overrides: { 1: 'SAR' } }), 'SAR'));
test('rareté source reconnue', () => {
  assert.equal(classifyRarity({ card: { id: 2, n: '190' }, set, sourceRarity: 'Art Rare', overrides: {} }), 'AR');
  assert.equal(classifyRarity({ card: { id: 3, n: '212' }, set, sourceRarity: 'Special Art Rare', overrides: {} }), 'SAR');
});
test('sans source : numéro au-delà du compte officiel = secret, jamais AR/SAR', () =>
  assert.equal(classifyRarity({ card: { id: 4, n: '212' }, set, sourceRarity: null, overrides: {} }), 'secret'));
test('sans source : numéro dans le compte officiel = regular', () =>
  assert.equal(classifyRarity({ card: { id: 5, n: '010' }, set, sourceRarity: null, overrides: {} }), 'regular'));
test('numéro non numérique ou compte officiel absent = unknown', () =>
  assert.equal(classifyRarity({ card: { id: 6, n: 'SV-P' }, set: {}, sourceRarity: null, overrides: {} }), 'unknown'));
```

- [ ] **Step 3:** Implémenter. Si la recherche a trouvé une source, l'alimenter dans `sourceRarity` depuis `buildCatalog` (libellés japonais `AR`/`SAR` et anglais acceptés).
- [ ] **Step 4:** Si aucune source : proposer une règle par plage de numéros **seulement** après l'avoir vérifiée à la main sur SV8a, SV4a et une extension de l'ère M ; sinon laisser `secret` et le dire à l'utilisateur. Dans les deux cas, afficher le décompte par rareté à la fin de `build-catalog`.
- [ ] **Step 5:** Commit `feat: classement de rareté avec corrections manuelles`.

### Task 4: Historique par extension

**Files:**
- Create: `scripts/lib/history.mjs`, `tests/history.test.mjs`

**Interfaces:**
- Produces: `appendDay(history | null, date: string, rows: Map<number, { t, l, a }>, ids: number[]): history` — fonction pure ; `ids` = cartes du catalogue pour cette extension.

- [ ] **Step 1: Tests**

```js
test('premier jour', () => {
  const h = appendDay(null, '2026-11-09', new Map([[1, { t: 100, l: 50, a: 90 }]]), [1]);
  assert.deepEqual(h, { dates: ['2026-11-09'], cards: { 1: { t: [100], l: [50], a: [90] } } });
});
test('même date rejouée : inchangé', () => assert.deepEqual(appendDay(h, '2026-11-09', rows, [1]), h));
test('date antérieure à la dernière : erreur', () => assert.throws(() => appendDay(h, '2026-11-08', rows, [1])));
test('carte nouvelle : dates passées complétées par null', () => {
  const h2 = appendDay(h, '2026-11-10', new Map([[1, {t:110,l:55,a:95}], [2, {t:5,l:1,a:null}]]), [1, 2]);
  assert.deepEqual(h2.cards[2], { t: [null, 5], l: [null, 1], a: [null, null] });
});
test('carte du catalogue sans prix ce jour : null ajouté', …);
test('toutes les séries ont la longueur de dates', …);
```

- [ ] **Step 2:** Échec, implémentation, succès. Commit `feat: historique compact par extension`.

### Task 5: Garde-fous et instantané

**Files:**
- Create: `scripts/lib/guards.mjs`, `scripts/lib/snapshot.mjs`, `tests/guards.test.mjs`, `tests/snapshot.test.mjs`

**Interfaces:**
- Produces: `checkDay({ date, lastDate, pricedCount, lastPricedCount }): { ok: true } | { ok: false, skip: boolean, reason: string }` — `skip: true` quand `date === lastDate` (rien à faire, pas une erreur).
- Produces: `pctChange(history, id, date, days): number | null`
- Produces: `buildSnapshot({ date, prices: Map<id, {t,l,a,a7,a30}>, histories: { [setId]: history }, catalog }): snapshot`

- [ ] **Step 1: Tests garde-fous**

```js
assert.deepEqual(checkDay({ date: '2026-11-10', lastDate: '2026-11-09', pricedCount: 900, lastPricedCount: 1000 }), { ok: true });
assert.equal(checkDay({ date: '2026-11-09', lastDate: '2026-11-09', pricedCount: 1000, lastPricedCount: 1000 }).skip, true);
assert.equal(checkDay({ date: '2026-11-08', lastDate: '2026-11-09', … }).ok, false);   // date en arrière
assert.equal(checkDay({ date: '2026-11-10', lastDate: '2026-11-09', pricedCount: 799, lastPricedCount: 1000 }).ok, false);
assert.equal(checkDay({ date: '2026-11-10', lastDate: null, pricedCount: 5, lastPricedCount: null }).ok, true); // tout premier jour
```

- [ ] **Step 2: Tests variations**

```js
// dates: 11-01 … 11-10 sauf 11-03 manquant ; trend de la carte 1 : 100 le 11-02, 120 le 11-10
assert.equal(pctChange(h, 1, '2026-11-10', 7), 20.0);     // J-7 = 11-03 absent → prend 11-02
assert.equal(pctChange(h, 1, '2026-11-10', 30), null);    // pas assez d'historique
assert.equal(pctChange(hTrou, 1, '2026-11-10', 7), null); // dernière date connue plus vieille que J-10
assert.equal(pctChange(hNull, 1, '2026-11-10', 7), null); // valeur de référence null ou 0
```

- [ ] **Step 3: Tests instantané** — avec moins de 7 jours d'historique : `approx.d7 === true` et `d7 = (trend − avg7) / avg7 × 100` ; avec 30 jours et plus : `approx.d30 === false` et `d30` vient de l'historique ; carte sans aucun prix : absente de `snapshot.cards`.
- [ ] **Step 4:** Échec, implémentation, succès. Commit `feat: garde-fous et instantané quotidien`.

### Task 6: Ingestion quotidienne de bout en bout

**Files:**
- Create: `scripts/ingest.mjs`, `tests/ingest.test.mjs`

**Interfaces:**
- Consumes: `toCents`, `appendDay`, `checkDay`, `buildSnapshot`
- Produces: `ingest({ dataDir, priceGuide, catalog }): Promise<{ status: "written" | "skipped", date }>` (lève une erreur si un garde-fou échoue) ; CLI `node scripts/ingest.mjs --data data [--prices fichier.json]` qui télécharge l'export si `--prices` est absent. Code de sortie 0 pour `written`/`skipped`, 1 sinon.

- [ ] **Step 1: Tests** dans un répertoire temporaire avec les fixtures :

```js
test('écrit historique + instantané', async () => {
  const r = await ingest({ dataDir, priceGuide, catalog });
  assert.deepEqual(r, { status: 'written', date: '2026-11-09' });
  const h = JSON.parse(await readFile(join(dataDir, 'history/SV8a.json')));
  assert.equal(h.cards[803325].t[0], 10324);
  assert.ok(!('271439' in h.cards));                 // hors catalogue japonais : non stocké
});
test('rejoué le même jour : skipped, fichiers identiques octet pour octet', …);
test('garde-fou en échec : erreur, aucun fichier modifié', …);  // écrire dans un dossier temporaire puis renommer
test('JSON invalide ou createdAt absent : erreur explicite', …);
```

- [ ] **Step 2:** Échec, implémentation, succès.
- [ ] **Step 3:** Vérification réelle : `node scripts/ingest.mjs --data data` avec le catalogue complet. Attendu : `written`, un fichier par extension, taille totale de `data/history` affichée. Relancer : `skipped`.
- [ ] **Step 4:** Commit `feat: ingestion quotidienne idempotente`.

### Task 7: Site — socle, recherche et fiche carte

**Files:**
- Create: `site/index.html`, `site/styles.css`, `site/app.js`, `site/config.js`, `site/lib/data.js`, `site/lib/chart.js`, `site/lib/metrics.js`, `site/views/search.js`, `site/views/card.js`, `tests/metrics.test.mjs`

**Interfaces:**
- Produces (`data.js`) : `loadCatalog()`, `loadSnapshot()`, `loadHistory(setId)` (mis en cache en mémoire), `imageUrl(card, quality = "low")`, `cardmarketUrl(card)` = `https://www.cardmarket.com/en/Pokemon/Products?idProduct={id}`
- Produces (`metrics.js`) : `formatEuro(cents)` → `"103,24 €"` / `"—"` pour `null` ; `searchCards(catalog, query)` — insensible à la casse et aux accents, cherche dans `ja`, `en`, `s`, et `"{s} {n}"`
- Produces (`chart.js`) : `renderPriceChart(el, { dates, series: [{ label, values }] }, range: "7"|"30"|"90"|"all")`
- Routes : `#/marche` (défaut), `#/collection`, `#/envies`, `#/recherche`, `#/carte/{id}`, `#/connexion`

- [ ] **Step 1: Tests `metrics`** : `formatEuro(10324) === '103,24 €'`, `formatEuro(null) === '—'`, `searchCards` trouve 803325 avec `"ニンフィア"`, `"sv8a 212"` et le nom anglais en minuscules ; requête vide → `[]`.
- [ ] **Step 2:** Implémenter le socle : barre d'onglets en bas (Collection, Marché, Envies, Recherche), routeur par hash, thème sombre de la maquette.
- [ ] **Step 3:** Fiche carte conforme à la maquette : image, nom, `{s} · {n} · rareté`, prix, variation 7 j, « Plus bas », « Moy. 30 j », courbe tendance (trait plein) + plus bas (pointillé), sélecteur de période, bouton « Voir sur Cardmarket ↗ ». La courbe ne relie pas les `null` (`spanGaps: false`). Carte sans prix : « Pas de prix publié ». Mention sous `low` : « peut correspondre à un exemplaire abîmé ».
- [ ] **Step 4:** Vérifier `cardmarketUrl` sur une carte réelle dans le navigateur ; si la redirection ne mène pas à la fiche, corriger le format et le noter ici.
- [ ] **Step 5:** Vérification : servir `site/` + `data/` en local (`python3 -m http.server`), ouvrir en 375 px de large : recherche « sv8a 212 » → fiche avec image et courbe, aucun défilement horizontal, aucune erreur console.
- [ ] **Step 6:** Commit `feat: site, recherche et fiche carte`.

### Task 8: Écran Marché

**Files:**
- Create: `site/views/market.js` ; Modify: `site/lib/metrics.js`, `tests/metrics.test.mjs`

**Interfaces:**
- Produces: `marketList(catalog, snapshot, { rarities: string[] | null, tab: "up"|"down"|"deals", window: 7|30, minCents: number, dealRatio = 0.85, limit = 100 }): Array<{ card, trend, change }>`

- [ ] **Step 1: Tests** : filtre `rarities: ['AR','SAR']` exclut `secret` et `regular` ; `up` trié par variation décroissante et sans les `null` ; `down` croissant ; `deals` ne garde que `trend ≤ avg30 × 0,85`, trié par écart ; `minCents: 1000` exclut une carte à 9,99 € ; `rarities: null` = tout.
- [ ] **Step 2:** Implémenter la vue : puces AR/SAR actives par défaut + « Secrètes » + « Tout », onglets Hausses / Baisses / Bonnes affaires, 7 j / 30 j, seuil minimum (défaut 10 €), réglage du seuil de bonne affaire. Choix mémorisés dans `localStorage` (lecture sous `try/catch`). Si `snapshot.approx` vaut `true` pour la période : bandeau « Historique encore court : variation estimée par rapport à la moyenne Cardmarket ».
- [ ] **Step 3:** Vérification navigateur en 375 px, puis commit `feat: écran marché`.

### Task 9: Supabase — schéma, connexion, stockage

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `site/lib/store.js`, `site/views/login.js` ; Modify: `site/config.js`

**Interfaces:**
- Produces: `getSession()`, `signIn(email)` (lien magique), `signOut()`, `onAuthChange(cb)`
- Produces: `listHoldings(): Promise<Array<{ id_product, qty }>>`, `setHolding(idProduct, qty)` (qty 0 = suppression), `listWishes(): Promise<Array<{ id_product, target_cents }>>`, `setWish(idProduct, targetCents | null)`, `removeWish(idProduct)`
- Toutes les fonctions de données lèvent `StoreError` avec `code: "auth" | "network"`.

- [ ] **Step 1:** Demander à l'utilisateur quel projet Supabase utiliser (ou d'en créer un) ; le connecteur Supabase doit être autorisé.
- [ ] **Step 2:** Migration : tables `holdings (user_id uuid default auth.uid() references auth.users, id_product int, qty int check (qty > 0), updated_at timestamptz default now(), primary key (user_id, id_product))` et `wishes (user_id …, id_product int, target_cents int null check (target_cents > 0), created_at …, primary key (user_id, id_product))`. RLS activée sur les deux, une politique par opération limitée à `auth.uid() = user_id`, rôle `authenticated` uniquement ; aucun droit pour `anon`.
- [ ] **Step 3:** Appliquer la migration, puis vérifier : requête REST avec la clé publique sans session sur `holdings` → 0 ligne ou 401 ; consulter les avis de sécurité Supabase → aucun avis sur ces tables.
- [ ] **Step 4:** Implémenter `store.js` et l'écran de connexion (e-mail → lien magique). Collection et Envies sans session affichent « Connexion requise » avec un bouton ; erreur réseau → « Service indisponible, réessayer ». Les autres onglets ne dépendent jamais de Supabase.
- [ ] **Step 5:** Après la première connexion de l'utilisateur : lui faire désactiver les inscriptions dans les réglages d'authentification Supabase (action de l'utilisateur), et renseigner l'URL du site dans les URL de redirection autorisées.
- [ ] **Step 6:** Commit `feat: collection et envies privées via Supabase`.

### Task 10: Écran Collection et saisie rapide

**Files:**
- Create: `site/views/collection.js`, `site/views/quickadd.js` ; Modify: `site/views/card.js`, `site/lib/metrics.js`, `tests/metrics.test.mjs`

**Interfaces:**
- Produces: `collectionValue(holdings, snapshot): { totalCents, unpriced: number }`
- Produces: `collectionSeries(holdings, histories): { dates: string[], values: (number | null)[] }` — pour chaque date, somme de `qty × trend` ; une carte sans prix à une date reprend son dernier prix connu, et ne compte pas avant son premier prix.

- [ ] **Step 1: Tests** : total = Σ qty × trend ; carte sans prix → `unpriced: 1` et non comptée ; série sur deux extensions aux dates identiques ; trou d'un jour pour une carte → dernier prix connu repris ; possession dont l'id est absent du catalogue → comptée dans `unpriced`, pas d'exception.
- [ ] **Step 2:** Vue conforme à la maquette : valeur totale, variation sur la période, courbe, périodes, filtres Toutes / AR / SAR / Par extension, mosaïque triable (valeur, variation). Mention « N cartes sans prix » si `unpriced > 0`. Carte hors catalogue : tuile « Carte inconnue (n° …) ». Ne charge que les historiques des extensions possédées.
- [ ] **Step 3:** Fiche carte : bouton « Dans ma collection » avec quantité − / +.
- [ ] **Step 4:** Saisie rapide (`#/collection/ajout`) : choisir une extension, mosaïque de toutes ses cartes, un appui = possédée ×1, appui long ou second contrôle pour la quantité ; enregistrement immédiat.
- [ ] **Step 5:** Vérification navigateur en 375 px avec un compte de test, puis commit `feat: écran collection et saisie rapide`.

### Task 11: Écran Envies

**Files:**
- Create: `site/views/wishlist.js` ; Modify: `site/views/card.js`, `site/lib/metrics.js`, `tests/metrics.test.mjs`

**Interfaces:**
- Produces: `wishStatus(wish, snapshotRow, history): { underTarget: boolean, gapCents: number | null, low30: boolean, rising: boolean }` — `low30` : `trend` du jour ≤ minimum des 30 derniers jours connus ; `rising` : `d7 > 3`.
- Produces: `sortWishes(items)` — sous la cible d'abord, puis par écart croissant ; sans cible à la fin.

- [ ] **Step 1: Tests** de `wishStatus` (sous la cible, au-dessus avec écart exact, sans cible, sans prix) et de l'ordre de `sortWishes`.
- [ ] **Step 2:** Vue conforme à la maquette : compteur « N cartes sous votre prix cible », étiquettes « Sous la cible », « Au plus bas sur 30 j », « En hausse », texte « encore X € au-dessus ». Fiche carte : « Ajouter aux envies · cible : __ € », modifiable et supprimable.
- [ ] **Step 3:** Pastille sur l'onglet Envies quand au moins une carte est sous la cible.
- [ ] **Step 4:** Vérification navigateur, puis commit `feat: liste d'envies avec prix cibles`.

### Task 12: Import Pokécardex

**Files:**
- Create (si un export existe) : `site/lib/pokecardex.js`, `site/views/import.js`, `tests/pokecardex.test.mjs`

**Interfaces:**
- Produces: `parsePokecardex(text): Array<{ set: string, number: string, qty: number }>` ; `matchImport(rows, catalog): { matched: Array<{ id, qty }>, unmatched: rows }`

- [ ] **Step 1:** Demander à l'utilisateur s'il peut exporter sa collection depuis Pokécardex et d'en fournir un fichier. **Sans export : cette tâche s'arrête ici**, la saisie rapide de la tâche 10 la remplace ; le dire à l'utilisateur.
- [ ] **Step 2:** Avec un export : écrire les tests à partir du fichier réel (anonymisé dans les fixtures), dont la table de correspondance des codes d'extension Pokécardex → TCGdex.
- [ ] **Step 3:** Écran d'import : aperçu « N reconnues / M non reconnues », liste des non reconnues, rien n'est enregistré avant confirmation ; l'import additionne aux quantités existantes ou les remplace, au choix affiché.
- [ ] **Step 4:** Commit `feat: import Pokécardex`.

### Task 13: Automatisation et mise en ligne

**Files:**
- Create: `.github/workflows/daily.yml`, `.github/workflows/catalog.yml`, `README.md`

- [ ] **Step 1:** Demander confirmation à l'utilisateur, puis créer le dépôt GitHub public et pousser `main` ; créer la branche orpheline `data` avec les fichiers produits aux tâches 2 et 6.
- [ ] **Step 2:** `daily.yml` : déclencheurs `schedule` à `17 5 * * *` et `17 11 * * *` (UTC) + `workflow_dispatch` ; `concurrency: data` ; étapes : checkout `main`, checkout `data` dans `data/`, `node --test`, `node scripts/ingest.mjs --data data`, commit et push de `data` si changement, assemblage `site/` + `data/` et déploiement Pages (`actions/upload-pages-artifact` + `actions/deploy-pages`), requête de maintien Supabase (`GET {SUPABASE_URL}/auth/v1/health` avec la clé publique, variables de dépôt). Permissions : `contents: write`, `pages: write`, `id-token: write`.
- [ ] **Step 3:** `catalog.yml` : `schedule` à `43 3 * * 1` + `workflow_dispatch` ; même `concurrency` ; reconstruit le catalogue avec cache d'Actions sur `.cache/`, pousse sur `data`. Un push sur `main` touchant `site/**` redéploie Pages.
- [ ] **Step 4:** Activer Pages (source : GitHub Actions). Lancer `daily` à la main : attendu « skipped » ou « written », déploiement vert.
- [ ] **Step 5:** Vérification finale sur l'URL publique, en 375 px puis sur ordinateur : les quatre onglets, une fiche avec courbe, connexion, ajout d'une carte à la collection et d'une envie, lien Cardmarket. Vérifier dans un onglet privé que collection et envies sont inaccessibles sans connexion.
- [ ] **Step 6:** `README.md` : fonctionnement, relance manuelle, que faire si un job échoue, comment corriger une rareté dans `overrides/rarity.json`. Commit `ci: mise à jour quotidienne et déploiement`.
