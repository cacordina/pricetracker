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
- **Prix TCGplayer (États-Unis)** : chaque jour, après Cardmarket, le prix de marché TCGplayer (calculé sur les ventes récentes, cartes non gradées) de chaque carte reliée au catalogue TCGplayer Japon, via tcgcsv.com, converti en euros au taux de référence de la BCE (`scripts/ingest-us.mjs`). Fichiers à part dans `data/us/` (prix en centimes de dollar et taux du jour) ; une panne de cette étape ne touche pas aux prix Cardmarket. La fiche carte affiche le prix, l'écart avec Cardmarket et la courbe en euros ; le Marché a un onglet « Moins cher qu'aux US ».
- **Données** : branche `data` du dépôt — `catalog.json`, `snapshot.json` (prix du jour et variations) et un fichier d'historique par extension (`history/`), prix en centimes.
- **Collection et envies** : dans Supabase, derrière une connexion. Rien de personnel n'est dans ce dépôt.

## Au quotidien

Rien à faire. Les prix arrivent chaque matin ; un second passage à la mi-journée rattrape une publication tardive.

**Prix suivi** : partout (fiches, marché, collection, alertes), le site retient la moyenne des ventes Cardmarket sur 7 jours, qui ne compte que les états Excellent ou mieux ; à défaut la moyenne 30 jours, puis la tendance. La tendance Cardmarket reste affichée sur la fiche pour information : sur les cartes peu échangées, elle peut tomber sous toutes les ventes récentes et sous l'annonce la moins chère (exemple : Tiplouf M-P 112, tendance 0,75 € pour des ventes autour de 2 €).

Les variations 7 j et 30 j sont calculées sur l'historique propre du site (moyenne 7 j) ; tant qu'il ne remonte pas assez loin, elles ne sont pas affichées plutôt qu'estimées.

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

Valeurs acceptées : `AR`, `SAR`, `promo`, `secret`, `regular`. Les promos (rareté « Promo » ou extension de promos comme `M-P`) sont classées à part automatiquement. La correction s'applique à la reconstruction suivante du catalogue (lundi, ou *Run workflow* sur *Catalogue japonais*). En lançant à la main, cocher « Rapide » recalcule raretés, noms anglais des extensions et images en quelques minutes, sans réinterroger TCGdex.

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
- `supabase/migrations/0002_purchase.sql` : prix (`paid_cents`, par exemplaire) et date d'achat (`bought_on`) des cartes possédées, saisis sur la fiche carte ; la collection en tire la somme payée et la plus-value.

## Parcourir les extensions

Écran `#/extensions` (accueil, recherche) : toutes les extensions du catalogue, rangées par grande série (Méga-Évolution, Écarlate et Violet, Épée et Bouclier, Soleil et Lune, XY, Noir & Blanc, HeartGold SoulSilver), des plus récentes aux plus anciennes, filtrables par série, code ou nom. La série vient du code de l'extension (`seriesOf`, `site/lib/metrics.js`), à défaut de sa date de sortie ; pour chacune, la valeur de l'extension complète (un exemplaire de chaque carte cotée) et la progression de la collection. Une extension (`#/extension/SV8a`, aussi depuis la fiche carte ou l'album) montre toutes ses cartes avec leur prix, par numéro ou par prix, filtrées par rareté et possédées ou manquantes, avec une liste déroulante pour passer à une autre extension. Deux modes : *Parcourir* (toucher ouvre la fiche) et *Ajouter à ma collection* (toucher ajoute un exemplaire, − et + règlent la quantité) ; « Ajouter des cartes » ouvre la dernière extension utilisée dans ce mode. « Toutes les AR » est la même vue appliquée à toutes les extensions. Les noms anglais des extensions et leur image (photo du produit scellé : display, sinon booster ou coffret ; à défaut, la carte la plus chère) viennent du catalogue TCGplayer. Une reconstruction du catalogue republie le site aussitôt. Sur ces écrans, le Marché et la Collection, les filtres sont regroupés derrière un bouton « Filtres » qui résume les choix en cours (`site/lib/cardgrid.js`).

## Application et hors connexion

Le site s'installe comme une application : sur iPhone, Safari → Partager → *Sur l'écran d'accueil* ; sur Android, Chrome propose *Installer l'application*. Il s'ouvre alors en plein écran, avec son icône.

- **Hors connexion**, il s'ouvre avec les derniers prix reçus (un bandeau donne leur date). La collection et les envies affichées sont la dernière copie reçue, gardée sur l'appareil et effacée à la déconnexion ; on ne peut pas les modifier sans réseau. Les images des cartes, les polices et le scanner ont besoin du réseau.
- **Le service worker** (`site/sw.js`) garde une copie complète du code du site. À la publication, `scripts/build-sw.mjs` y inscrit la liste des fichiers et une version calculée sur le code : une publication qui ne change que les données ne réinstalle rien. Quand le code change, la nouvelle version s'installe en arrière-plan et le site se recharge au changement d'écran suivant.
- Les données passent toujours par le réseau d'abord ; la copie gardée ne sert que si le réseau manque ou ne répond pas en 6 secondes.

## Alertes de prix cible

Écran Envies → *Alertes de prix cible* → *Activer* : cet appareil reçoit une notification le matin où une carte de vos envies passe sous son prix cible (ou l'atteint). Une seule par passage sous la cible, pas tous les jours où elle y reste ; plusieurs cartes le même jour font une seule notification. Toucher la notification ouvre la carte, ou les envies.

- Sur iPhone, il faut iOS 16.4 ou plus et le site installé sur l'écran d'accueil ; l'activation se fait depuis l'icône. Sur Android et sur ordinateur, depuis le navigateur.
- La tâche quotidienne envoie les alertes (`scripts/notify.mjs`) juste après avoir enregistré un nouveau jour ; le passage de rattrapage de la mi-journée n'envoie rien deux fois.
- Réglages : table `push_subscriptions` (`supabase/migrations/0003_push.sql`) ; secrets du dépôt `SUPABASE_SERVICE_KEY` (clé secrète Supabase, qui lit les envies de tous les comptes) et `VAPID_PRIVATE_KEY` ; variables `SUPABASE_URL` et `VAPID_SUBJECT` (facultative, `mailto:` d'une adresse de contact pour les services push). La clé publique VAPID est dans `site/config.js`. Sans ces secrets, l'étape dit ce qui manque et n'envoie rien.
- Un appareil désabonné ou désinstallé est retiré de la table au premier envoi refusé. Se déconnecter du site désabonne l'appareil.

## Scanner de cartes (expérimental)

Écran `#/scan`, accessible depuis la recherche. Dès l'ouverture, sans appui, la caméra cherche la série et le numéro imprimés en bas à gauche de la carte (« sv8a 212/187 ») avec Tesseract.js, chargé depuis jsDelivr au premier usage (environ 6 Mo). Trois passes de lecture par image, cumulées d'une image à l'autre ; une carte est retenue quand son numéro concorde avec la série ou le total officiel. À la première carte reconnue, l'image se fige et le résultat s'affiche (prix, ajout à la collection, fiche) ; « Scanner une autre carte » relance. Les cartes à fond sombre et chargé sont les plus difficiles à lire.

## Limites connues

- eBay : la fiche carte ouvre la recherche des ventes conclues sur ebay.fr (nom anglais, numéro, « japanese »). Les prix ne sont pas importés : eBay ne donne accès à l'historique des ventes qu'à des partenaires agréés (API Marketplace Insights), et la lecture automatique de ses pages est interdite par ses conditions.
- Les prix sont globaux par carte, sans distinction de langue du vendeur. Le « plus bas » est l'annonce la moins chère, tous états confondus : il peut s'agir d'un exemplaire abîmé.
- L'historique commence à la mise en service.
- La courbe de la collection ne fait entrer une carte qu'à sa date d'achat quand elle est renseignée ; sans date, la carte compte depuis le début de l'historique. La variation affichée au-dessus ne mesure que l'évolution des prix des cartes possédées aujourd'hui, pas les achats.
- Le prix d'achat est un prix par exemplaire : pour plusieurs exemplaires payés différemment, on saisit la moyenne.
