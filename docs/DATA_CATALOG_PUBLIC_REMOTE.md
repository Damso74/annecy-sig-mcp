# Catalogue de données — MCP `annecy-sig-remote` (public)

Ce document décrit, service par service et couche par couche, ce qui est
exposable depuis le serveur MCP **distant public** (`mcp.leadalpes.fr`),
ainsi que les limites de fiabilité connues.

> Public **techniquement** ≠ publiable brut ≠ utilisable sans cadrage par
> une IA grand public. Toutes les valeurs ci-dessous sont des bornes
> contractuelles vérifiées par la suite de tests V0.9 / V1.0.

## A. Services visibles en mode public

### 1. Service `equipements`


| Élément          | Valeur                                                                 |
| ---------------- | ---------------------------------------------------------------------- |
| Visibilité       | `public`                                                               |
| Risque           | `green`                                                                |
| Couches visibles | 11                                                                     |
| Usages           | Chatbot citoyen, carte équipements, open data après validation métier. |


#### Couches connues


| `layerId` | Nom                          |
| --------- | ---------------------------- |
| 0         | Administration / équipements |
| 1         | Établissements scolaires     |
| 2         | Accueils petite enfance      |
| 3         | Équipements sénior           |
| 4         | Cimetière                    |
| 5         | **WC publics**               |
| 6         | Équipements culturels        |
| 7         | Jardins partagés             |
| 8         | Vergers communaux            |
| 9         | Équipements sport            |
| 10        | Salles municipales           |


#### Champs typiques disponibles selon couche

`objectid`, `denomination`, `adresse`, `commune`, `ouvert`, `pmr`, `horaire`,
`telephone`, `categorie`, `sous_categorie`, `accessibilite`, `geometry`
(point WGS84) si disponible.

#### Cas le plus mature : `equipements / 5` — WC publics

Champs exposés :

- `objectid`
- `denomination`
- `ouvert`
- `adresse`
- `commune`
- `pmr`
- `horaire`
- `telephone`
- `categorie`
- `sous_categorie`
- `accessibilite`
- `geometry` (point WGS84)

Usages recommandés :

- « toilettes proches de moi »
- « toilettes PMR »
- « sanitaires autour d’un lieu »

Limites :

- Ne pas inventer les horaires si `horaire` est vide.
- Ne pas garantir « ouvert maintenant » sauf si la donnée le permet
explicitement.
- Ne pas inventer le détail d’accessibilité au-delà du champ `pmr`.

### 2. Service `mobilite`


| Élément          | Valeur                                                 |
| ---------------- | ------------------------------------------------------ |
| Visibilité       | `public`                                               |
| Risque           | `green`                                                |
| Couches visibles | 15                                                     |
| Usages           | Carte mobilité, diagnostic, open data après nettoyage. |


#### Couches connues (extrait registre)

- Annecy Parking
- Parking relais
- Stations Vélonecy
- Places hôtel
- Places livraison
- Parking moto
- Places PMR
- Bornes de recharge véhicules électriques
- Stationnement vélos
- Stationnements hors parking en ouvrage
- Horodateurs
- Stationnement zone bleue
- Stationnement horodateurs zones longue durée
- Stationnement horodateurs zones courte durée
- Stationnement horodateurs bords de lac été

#### Champs typiques attendus (selon couche)

`objectid`, `denomination`, `nom`, `adresse`, `commune`, `categorie`,
`sous_categorie`, `description`, `capacite`, `observations`, `statut`,
`type_stationnement`, `zone`, `numero`, `geometry` si présente.

#### Limites connues

- Certaines couches mobilité ont des mappings incomplets (cf.
`inventory_all_layers` en mode public).
- Certaines géométries ou libellés peuvent manquer.
- Ne pas répondre à « places disponibles maintenant » sauf flux temps réel
dédié.
- Ne pas extrapoler les règles tarifaires ou réglementaires.

### 3. Service `travaux`


| Élément                             | Valeur                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Visibilité registre                 | `internal` / risque `orange`                                                     |
| Mode public — interrogation brute   | **0 couche interrogeable** (verrou registre)                                     |
| Mode public — interrogation filtrée | **vue public-light V1.0** via `list_public_works` / `search_public_works_nearby` |
| Mode internal (MCP local stdio)     | Couche complète, outils `list_current_works`, `list_late_works`                  |


La couche brute travaux **n’est jamais exposée** sur le remote public.
Toute interrogation passe par la vue **public-light** décrite ci-dessous.

#### Champs présents côté source ArcGIS (pour information uniquement)

- `OBJECTID` / `objectid`
- `ac_num`
- `ac_odp_ref`
- `ac_date_debut`
- `ac_date_fin`
- `controle_resultat`
- `titre`
- `adresse`
- `commune_deleguee`
- `description`
- `geometry`
- `url_pj`
- `url_piece_jointe`
- `created_user`, `created_date`
- `last_edited_user`, `last_edited_date`
- … et autres champs techniques selon ArcGIS.

#### Champs **autorisés** dans la vue travaux public-light

- `id_public` — **hash opaque préfixé `pw_`** (12 caractères hex SHA-256
  calculés à partir de `serviceKey:layerId:objectid:salt`). Jamais
  l’`OBJECTID` brut, jamais réversible sans le salt
  `PUBLIC_WORK_ID_SALT` (cf. `docs/SECURITY.md` §10.5).
- `titre_public` — titre simplifié.
- `statut_public` — statut simplifié (« En cours », « À venir », « En
retard », « Réfection provisoire », « Réfection définitive », « Statut
non renseigné »).
- `date_debut_iso` — ISO 8601 ou null.
- `date_fin_iso` — ISO 8601 ou null.
- `secteur_public` — adresse ou commune simplifiée si fiable.
- `commune_deleguee` — si présente et non sensible.
- `geometry` simplifiée — uniquement si `includeGeometry=true` ET donnée
utile.
- `qualityFlags` publics : `missingGeometry`, `missingAddress`,
`missingTitle`, `dateIncoherence` (booléens uniquement).
- `distance_m` (search nearby uniquement).
- `source` :
  - `type`, `schemaVersion=public_works.v1`, `serverVersion`, `mode=public`,
  `filtered=true`, `rawLayerExposed=false`, `consultedAt`, `disclaimer`.

Disclaimer renvoyé en sortie :

> *Information indicative issue d’un flux public filtré. Pour une
> information opposable, consulter les canaux officiels de la Ville.*

#### Champs **interdits** dans la vue travaux public-light

- `url_pj`
- `url_piece_jointe`
- `attachment`
- `ac_odp_ref`
- numéro complet d’arrêté brut
- description libre brute
- `created_user`, `created_date`
- `last_edited_user`, `last_edited_date`
- `token`, `password`, `secret`, `bearer`
- nom d’agent, données nominatives
- lien vers document, identifiant technique interne, référence brute
- tout champ non explicitement allowlisté

Garde-fou serveur : `assertNoSensitivePublicWorkKeys` (cf.
`src/tools/publicWorks.ts`) lève une erreur immédiate si une clé contenant
l’une de ces sous-chaînes apparaît dans la sortie. La suite de tests
`tests/v1.0.publicWorks.test.ts` rejoue cette assertion avec une fixture
contenant volontairement les marqueurs sensibles.

## B. Limites globales

- Aucun outil ne consomme de donnée nominative.
- Aucune donnée n’est inventée. En l’absence d’information, le champ est
`null` et un `qualityFlags.missing`* ou un message dans `warnings` le
signale.
- Le mode internal est **strictement** réservé au MCP local stdio.
- Les rapports de maturité (chatbot, open data) restent **indicatifs** ;
l’arbitrage humain est requis pour toute publication open data.
- Le verrou `requiresLegalReview` interdit le classement automatique en
VERT pour la couche travaux dans `generate_open_data_brief`.

