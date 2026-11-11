# Carnet JP — suivi de prix des cartes Pokémon japonaises (Cardmarket)

Site personnel qui suit chaque jour les prix Cardmarket des cartes Pokémon japonaises à l'unité : marché (hausses, baisses, bonnes affaires), fiche carte avec courbe, collection et liste d'envies privées.

## Comment ça marche

```
Chaque jour (GitHub Actions)                 Chaque lundi
  télécharge l'export de prix Cardmarket       reconstruit le catalogue japonais
  ne garde que les cartes japonaises           depuis TCGdex (images, raretés,
  ajoute le jour à l'historique                identifiants Cardmarket)
  publie le site sur GitHub Pages
```

- **Bibliothèques** : uPlot 1.6.31 et supabase-js 2.45.4 sont copiées dans `site/vendor/`, le site ne dépend d’aucun CDN.
- **Sources** : les exports publics de Cardmarket (`price_guide_6.json`, `products_singles_6.json`) et l'API TCGdex. Aucune page Cardmarket n'est consultée.
- **Cartes que TCGdex ne relie pas à Cardmarket** : elles sont rattachées par recoupement des noms anglais entre le catalogue TCGplayer Japon et l'export Cardmarket (`scripts/lib/fill.mjs`). Quand Cardmarket a plusieurs versions d'une extension (une par langue), elle n'est pas complétée tant que `overrides/expansions.json` ne dit pas laquelle prendre ; la reconstruction du catalogue les liste.
- **Sources de secours** : le catalogue TCGplayer « Pokémon Japan » (via tcgcsv.com) fournit l'image et la rareté quand TCGdex ne les a pas ; les noms français des Pokémon viennent de la table d'espèces PokeAPI (`scripts/data/species-fr.json`). Les cartes Dresseur gardent leur nom anglais.
- **Filtre japonais** : une carte est suivie si TCGdex la connaît en japonais avec un identifiant Cardmarket. Tout le reste de l'export est ignoré.
- **Données** : branche `data` du dépôt — `catalog.json`, `snapshot.json` (prix du jour et variations) et un fichier d'historique par extension (`history/`), prix en centimes.
- **Collection et envies** : dans Supabase, derrière une connexion. Rien de personnel n'est dans ce dépôt.

## Au quotidien

Rien à faire. Les prix arrivent chaque matin ; un second passage à la mi-journée rattrape une publication tardive.

Les premières semaines, les variations 7 j et 30 j sont estimées à partir des moyennes Cardmarket (un bandeau le signale), puis calculées sur l'historique propre du site.

## Si une mise à jour échoue

GitHub envoie un e-mail. Le site reste en ligne avec les dernières données valides, l'historique n'est jamais modifié par une exécution en échec.

- Onglet **Actions** du dépôt → *Mise à jour quotidienne* → ouvrir l'exécution en rouge : la ligne `ÉCHEC : …` dit pourquoi.
- Causes prévues : fichier Cardmarket pas encore publié ou incomplet (moins de 80 % des cartes cotées par rapport à la veille), date du fichier antérieure au dernier jour enregistré.
- Pour relancer : *Run workflow*. Rejouer est sans risque, un jour déjà enregistré est simplement sauté.
- Un jour réellement manqué reste un trou dans les courbes ; aucune valeur n'est inventée.

## Corriger une rareté

Quand ni TCGdex ni la source de secours ne donnent la rareté d'une carte, elle apparaît comme « Secrète » (hors numérotation officielle) et non AR ou SAR. Pour corriger, ajouter l'identifiant Cardmarket de la carte (visible dans l'adresse de sa fiche sur le site, `#/carte/803325`) dans `overrides/rarity.json` :

```json
{ "803325": "SAR", "803303": "AR" }
```

Valeurs acceptées : `AR`, `SAR`, `secret`, `regular`. La correction s'applique à la reconstruction suivante du catalogue (lundi, ou *Run workflow* sur *Catalogue japonais*).

## Travailler en local

```bash
node --test
```

```bash
node scripts/build-catalog.mjs --out data --only SV8a,M2
```

```bash
node scripts/ingest.mjs --data data
```

```bash
ln -sfn ../data site/data && python3 -m http.server 8791 --directory site
```

Node 22 ou plus, aucune dépendance à installer.

## Réglages

- `site/config.js` : adresse des données, adresse et clé publique du projet Supabase.
- Variables du dépôt GitHub `SUPABASE_URL` et `SUPABASE_KEY` (facultatives) : la tâche quotidienne s'en sert pour garder le projet Supabase gratuit actif.
- `supabase/migrations/0001_init.sql` : tables `holdings` et `wishes` et leurs règles d'accès.

## Scanner de cartes (expérimental)

Écran `#/scan`, accessible depuis la recherche. Dès l'ouverture, sans appui, la caméra cherche la série et le numéro imprimés en bas à gauche de la carte (« sv8a 212/187 ») avec Tesseract.js, chargé depuis jsDelivr au premier usage (environ 6 Mo). Trois passes de lecture par image, cumulées d'une image à l'autre ; une carte est retenue quand son numéro concorde avec la série ou le total officiel. À la première carte reconnue, l'image se fige et le résultat s'affiche (prix, ajout à la collection, fiche) ; « Scanner une autre carte » relance. Les cartes à fond sombre et chargé sont les plus difficiles à lire.

## Limites connues

- eBay : la fiche carte ouvre la recherche des ventes conclues sur ebay.fr (nom anglais, numéro, « japanese »). Les prix ne sont pas importés : eBay ne donne accès à l'historique des ventes qu'à des partenaires agréés (API Marketplace Insights), et la lecture automatique de ses pages est interdite par ses conditions.
- Les prix sont globaux par carte : ni l'état, ni la langue du vendeur. Le « plus bas » peut être un exemplaire abîmé.
- L'historique commence à la mise en service.
- La valeur passée de la collection applique les cartes possédées aujourd'hui aux prix d'hier ; les dates d'achat ne sont pas suivies.
- Les alertes de prix cible sont visibles dans le site (pastille sur l'onglet Envies), sans notification.
