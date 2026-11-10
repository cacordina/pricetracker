# Suivi de prix Cardmarket — cartes Pokémon japonaises

Conception du 10 novembre 2026. Les points marqués **(choix Claude)** sont des décisions prises par défaut, non discutées avec l'utilisateur ; tout le reste vient de la conversation.

## Intention

Un outil personnel pour :

1. **suivre ma collection** (environ 300 cartes japonaises, aujourd'hui saisies sur Pokécardex) : ce qu'elle vaut et comment sa valeur évolue ;
2. **voir l'évolution du marché** des cartes japonaises ;
3. **m'aider à acheter** : repérer quoi acheter et quand, surtout sur les raretés **AR et SAR**.

L'outil doit être visuel (images des cartes, courbes), consultable sur Mac **et sur téléphone**, se mettre à jour **tous les jours** sans intervention, et ne stocker que ce qui concerne le japonais.

## Objectifs

- Historique quotidien des prix de toutes les cartes japonaises à l'unité connues, à partir de la mise en service.
- Quatre écrans (maquette validée : `.superpowers/brainstorm/15481-1794322269/content/ecrans.html`) :
  - **Collection** : valeur totale, variation, courbe (7 j / 30 j / 90 j / tout), mosaïque des cartes possédées, filtres Toutes / AR / SAR / par extension.
  - **Marché** : AR et SAR sélectionnés par défaut ; onglets Hausses, Baisses, Bonnes affaires ; période 7 j ou 30 j ; seuil de prix minimum.
  - **Envies** : cartes convoitées avec prix cible ; celles passées sous la cible en tête ; repères « au plus bas sur 30 j », « en hausse ».
  - **Fiche carte** : image, courbe tendance + prix le plus bas, repères (plus bas, moyenne 30 j), lien vers la fiche Cardmarket, boutons « dans ma collection (quantité) » et « ajouter aux envies (cible) ».
- Recherche d'une carte par nom, extension, numéro.
- Collection et envies **privées** et identiques sur tous les appareils.

## Hors périmètre

- Acheter automatiquement, ou toute action sur le compte Cardmarket.
- Extraire des données des pages Cardmarket (uniquement les deux exports publics).
- Prix par état ou par vendeur (l'export ne les contient pas).
- Notifications push ou e-mail : les alertes sont visibles dans le site seulement.
- Produits scellés, cartes non japonaises.
- Historique antérieur à la mise en service (Cardmarket ne publie que le prix du jour).

## Ce qui ferait échouer le projet

- Un jour manquant ou corrompu qui passe inaperçu dans l'historique.
- Des cartes non japonaises qui polluent les vues, ou des cartes japonaises mal associées (mauvaise image, mauvais prix).
- Une collection visible publiquement.
- Un site lent ou illisible sur téléphone.

## Faits vérifiés le 10 novembre 2026

- Exports Cardmarket (jeu 6 = Pokémon), publics, sans authentification, ~14 Mo chacun :
  - catalogue `https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json` — 75 695 produits, champs `idProduct`, `name`, `idCategory`, `categoryName`, `idExpansion`, `idMetacard`, `dateAdded`. **Aucun champ langue, aucun nom d'extension, aucune rareté, aucun numéro de carte.**
  - prix `https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json` — 80 602 lignes, champs `avg`, `low`, `trend`, `avg1`, `avg7`, `avg30` et leurs variantes `-holo`, plus `createdAt` au niveau du fichier. Beaucoup de valeurs `null`.
- TCGdex (`https://api.tcgdex.net/v2/ja/...`), gratuit, sans clé :
  - 204 extensions japonaises (`/ja/sets`), chacune avec la liste des cartes et `cardCount.official`.
  - chaque carte (`/ja/cards/{id}`) donne `image` (ex. `https://assets.tcgdex.net/ja/SV/SV8a/212/low.webp`, vérifié) et `pricing.cardmarket.idProduct` (ex. SV8a-212 → 803325).
  - **`rarity` vaut `"None"`** sur les cartes japonaises testées.
- Sur ce Mac : `gh` connecté à GitHub, Node 26, Python 3.13, git.

## Architecture (choix Claude, sauf mention)

```
GitHub Actions (cron quotidien)
  ├─ télécharge les 2 exports Cardmarket
  ├─ filtre sur la table des cartes japonaises
  ├─ ajoute le jour à l'historique compact
  └─ publie données + site sur GitHub Pages
GitHub Actions (cron hebdomadaire)
  └─ reconstruit la table des cartes japonaises depuis TCGdex
Site statique (téléphone d'abord)
  ├─ lit les fichiers de données publiés
  └─ lit/écrit collection et envies dans Supabase (connexion requise)
```

### Table des cartes japonaises

- Construite depuis TCGdex : pour chaque extension japonaise, pour chaque carte, on retient `idProduct` Cardmarket, identifiant TCGdex, extension, numéro (`localId`), nom japonais, URL d'image.
- Le nom anglais vient du catalogue Cardmarket (jointure sur `idProduct`), pour une recherche possible dans les deux langues.
- Une carte TCGdex sans `idProduct` Cardmarket est ignorée et comptée dans un rapport de couverture écrit à chaque reconstruction (nombre de cartes par extension avec/sans lien).
- La reconstruction demande une requête par carte : elle doit être polie (débit limité, reprise possible, mise en cache des extensions déjà complètes).
- **Filtre japonais** = « `idProduct` présent dans cette table ». C'est aussi ce qui optimise le stockage : tout le reste de l'export est jeté.

### Rareté AR / SAR — point ouvert

Aucune des deux sources ne donne la rareté. À la charge du constructeur, dans cet ordre :

1. chercher une source fiable de rareté pour les extensions japonaises (autre champ ou autre point d'accès TCGdex, autre jeu de données ouvert) ;
2. à défaut, classer par position : numéro > `cardCount.official` ⇒ carte « secrète », puis règle par plage de numéros selon l'ère de l'extension, **à valider sur trois extensions connues avant de la généraliser** ;
3. dans tous les cas, prévoir un fichier de corrections manuelles (`idProduct` → rareté) prioritaire sur le calcul.

Si la rareté d'une carte reste inconnue, elle est étiquetée « secrète » ou « inconnue », jamais devinée en AR ou SAR. Les filtres AR/SAR ne montrent que les cartes classées avec certitude ; un filtre « secrètes » couvre le reste.

### Ingestion quotidienne

- Script Node sans dépendance.
- La date du jour enregistré est celle de `createdAt` du fichier de prix, pas celle de l'exécution. Si ce jour est déjà dans l'historique, le script ne fait rien (rejouable sans risque).
- Planifié deux fois par jour pour rattraper une publication tardive ou une panne ; la seconde exécution est sans effet si la première a réussi.
- **Garde-fous avant publication** : JSON valide, `createdAt` plus récent que le dernier jour connu, nombre de cartes japonaises avec un prix ≥ 80 % de la veille. Sinon : échec visible du job (GitHub envoie un e-mail), rien n'est publié, l'historique reste intact.
- Un jour réellement manqué reste un trou ; les courbes relient les points connus sans inventer de valeur.

### Stockage

- Par carte et par jour : `trend`, `low`, `avg1`, en **centimes entiers**, `null` conservé.
- `avg7` et `avg30` ne sont gardés que pour le jour courant (ils se déduisent de l'historique ensuite). Les colonnes `-holo` sont abandonnées.
- Un fichier d'historique par extension, en colonnes : une liste de dates partagée, puis un tableau de valeurs par carte. Le site ne charge que l'extension de la carte consultée.
- Un fichier « instantané » unique pour les écrans Marché et Collection : par carte, prix du jour, `avg7`, `avg30`, variations 7 j et 30 j précalculées, rareté, extension.
- Pour afficher la courbe de valeur de la collection sans charger toutes les extensions, le site charge les historiques des seules extensions présentes dans la collection.
- Les données vivent sur une branche dédiée du dépôt, séparée du code, pour que l'historique git du code reste propre.
- Les images ne sont jamais stockées : affichées depuis TCGdex.

### Site

- Statique, hébergé sur GitHub Pages, conçu pour le téléphone d'abord, utilisable sur Mac.
- Dépôt **public** (GitHub Pages gratuit l'exige) : il ne contient que du code et des prix publics. **Aucune donnée personnelle dans le dépôt.**
- Prix de référence affiché partout : `trend`. `low` est montré comme repère, avec la mention qu'il peut s'agir d'un exemplaire abîmé.
- « Bonne affaire » = `trend` du jour inférieur d'au moins 15 % à `avg30`, seuil réglable dans l'interface.
- Bibliothèque de courbes légère, au choix du constructeur.
- Thème sombre comme la maquette.

### Collection et envies (privées — décision utilisateur)

- Stockées dans Supabase, derrière une connexion par e-mail. Deux tables : possessions (`idProduct`, quantité) et envies (`idProduct`, prix cible). Chaque ligne appartient à un utilisateur ; les règles d'accès n'autorisent que son propriétaire.
- Les inscriptions sont fermées une fois le compte de l'utilisateur créé.
- Sans connexion, le site reste consultable (marché, fiches, recherche) ; collection et envies demandent la connexion.
- La courbe de valeur de la collection est calculée avec les possessions **actuelles** appliquées aux prix passés (pas de suivi des dates d'acquisition dans cette version).
- Un projet Supabase gratuit se met en pause après une semaine sans activité : le job quotidien fait une requête de maintien.

### Import Pokécardex — point ouvert

- Vérifier si Pokécardex permet d'exporter une collection. Si oui : import par fichier, association par extension + numéro, avec un écran de revue des cartes non reconnues.
- Sinon : saisie rapide dans le site (choisir une extension, cocher les cartes sur la mosaïque).
- La saisie rapide est construite dans les deux cas.

## Laissé au constructeur

- Outillage du site (avec ou sans étape de build), bibliothèque de courbes, organisation du code.
- Format exact des fichiers de données, dans le respect des principes ci-dessus.
- Heures précises des tâches planifiées.
- Tests : au minimum sur le filtrage japonais, l'idempotence de l'ingestion, les garde-fous, et le calcul des variations.

## Étapes nécessitant l'utilisateur

- Créer le dépôt GitHub public et activer Pages (confirmation avant publication).
- Créer ou désigner le projet Supabase et se connecter une première fois.
- Fournir un export Pokécardex s'il existe.
