# MCP `annecy-sig-remote` — Mode d’emploi public

Ce document s’adresse à tout intégrateur (Cursor, Copilot Studio, DSI Annecy,
agence d’IA tierce) qui souhaite consommer le serveur MCP **distant**
`annecy-sig-mcp` exposé sur Vercel.

> Toutes les informations ci-dessous concernent **uniquement** le transport
> HTTP public. Le MCP local stdio (`examples/cursor-mcp-config.json`) reste
> la voie unique pour les outils internal (travaux bruts, dashboard interne).

## 1. Endpoints et auth


| Élément         | Valeur                                     |
| --------------- | ------------------------------------------ |
| URL MCP         | `https://mcp.leadalpes.fr/api/mcp`         |
| URL Health      | `https://mcp.leadalpes.fr/api/health`      |
| Méthode         | HTTP POST JSON-RPC 2.0 (Streamable HTTP)   |
| Auth            | Bearer optionnel (`MCP_PUBLIC_READ_TOKEN`) |
| CORS            | `*` (sans cookies)                         |
| Mode applicatif | `public` **forcé** (verrou serveur)        |
| Outils internal | **non exposés** (verrou serveur)           |


L’endpoint `/api/health` ne fait aucun appel ArcGIS — il sert uniquement à
vérifier que la function Vercel répond, et à connaître la configuration
runtime (`publicOnly`, `internalToolsAllowed`, `bearerRequired`).

```bash
curl https://mcp.leadalpes.fr/api/health
# {
#   "status": "ok",
#   "server": "annecy-sig-mcp",
#   "mode": "public",
#   "transport": "http",
#   "serverVersion": "1.0.0-rc.1",
#   "publicOnly": true,
#   "internalToolsAllowed": false,
#   "bearerRequired": true
# }
```

## 2. Périmètre exposé

Le MCP distant expose **15 outils publics** (V1.0). Aucun outil ne consomme
de donnée nominative ni n’ouvre la couche travaux brute.

### 2.1 Découverte / catalogue


| Outil            | Rôle                                                         |
| ---------------- | ------------------------------------------------------------ |
| `list_services`  | Liste les services SIG autorisés (équipements, mobilité, …). |
| `list_layers`    | Liste les couches publiques d’un service.                    |
| `describe_layer` | Schéma allowlisté d’une couche (champs publics seulement).   |


### 2.2 Interrogation


| Outil                        | Rôle                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| `query_layer`                | Lecture allowlistée (WHERE simple, plafond résultats, géométrie WGS84). |
| `search_nearby`              | Recherche autour d’un point (filtre spatial ArcGIS + Haversine).        |
| `count_layer`                | Comptage `returnCountOnly` côté ArcGIS.                                 |
| `detect_data_quality_issues` | Échantillon + rapport qualité (nulls, géométrie, dates).                |


### 2.3 Inventaire / arbitrages


| Outil                               | Rôle                                                               |
| ----------------------------------- | ------------------------------------------------------------------ |
| `inventory_all_layers`              | Inventaire visible (counts, échantillons, score préliminaire).     |
| `recommend_open_data_candidates`    | Tiering open data (VERT / ORANGE / ROUGE).                         |
| `generate_inventory_report`         | Rapport synthétique d’inventaire (JSON ou Markdown).               |
| `generate_open_data_brief`          | Note open data (réutilise les recommandations).                    |
| `generate_chatbot_readiness_report` | Maturité « chatbot citoyen » (WC, sport, culture, mobilité, etc.). |
| `generate_layer_action_plan`        | Plan d’action ciblé pour une couche.                               |


### 2.4 Travaux **public-light** (V1.0)


| Outil                        | Rôle                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `list_public_works`          | Travaux filtrés (titre simplifié, statut, dates, secteur). Aucun champ technique. |
| `search_public_works_nearby` | Travaux public-light autour d’un point (lat/lon + rayon, distance Haversine).     |


> Voir `docs/DATA_CATALOG_PUBLIC_REMOTE.md` pour la liste exhaustive des
> champs autorisés / interdits.

### 2.5 Outils explicitement **non exposés** sur le remote public


| Outil                               | Pourquoi ?                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `list_current_works`                | Travaux **bruts** internes (numéro d’arrêté complet, pièces jointes possibles).      |
| `list_late_works`                   | Idem.                                                                                |
| `generate_internal_dashboard_brief` | Brief dashboard interne — destiné à la coordination DSI/voirie, pas au grand public. |


Pour ces outils, garder le MCP local stdio.

## 3. Différence MCP local stdio / MCP remote HTTP


| Aspect                        | Stdio local                         | Remote HTTP (Vercel)                             |
| ----------------------------- | ----------------------------------- | ------------------------------------------------ |
| Mode `internal`               | Autorisé (selon `DEFAULT_MODE`)     | **Refusé explicitement** (`publicOnly`)          |
| Outils `*_works` / dashboard  | Enregistrés                         | **Non enregistrés** (`allowInternalTools=false`) |
| `list_public_works`           | Disponible (filtré identique)       | Disponible (filtré identique)                    |
| `search_public_works_nearby`  | Disponible (filtré identique)       | Disponible (filtré identique)                    |
| Auth                          | Aucune (process child)              | Bearer optionnel via `MCP_PUBLIC_READ_TOKEN`     |
| Volume de données accessibles | Plus large (mode internal possible) | Strict public                                    |


## 4. Données accessibles côté remote public

### 4.1 Service `equipements` (11 couches publiques)

Chatbot citoyen : équipements municipaux et services de proximité.

- Administration / équipements (0)
- Établissements scolaires (1)
- Accueils petite enfance (2)
- Équipements sénior (3)
- Cimetière (4)
- **WC publics (5)** — couche la plus mature
- Équipements culturels (6)
- Jardins partagés (7)
- Vergers communaux (8)
- Équipements sport (9)
- Salles municipales (10)

Champs typiques exposés (selon couche) : `denomination`, `adresse`, `commune`,
`ouvert`, `pmr`, `horaire`, `telephone`, `categorie`, `sous_categorie`,
`accessibilite`, `geometry` (point WGS84).

### 4.2 Service `mobilite` (15 couches publiques)

Stationnement, vélos, bornes de recharge, zones réglementées.

Voir le détail dans `docs/DATA_CATALOG_PUBLIC_REMOTE.md`.

### 4.3 Service `travaux` — **vue public-light uniquement**

La couche brute n’est **jamais** exposée sur le remote. Les outils
`list_public_works` et `search_public_works_nearby` retournent une vue
filtrée :

- titre simplifié,
- statut simplifié (« En cours », « À venir », « En retard », …),
- dates ISO,
- secteur (adresse ou commune),
- géométrie optionnelle.

Champs **interdits** : `url_pj`, `url_piece_jointe`, `attachment`,
`ac_odp_ref`, numéro complet d’arrêté, description libre brute,
`created_user`, `last_edited_user`, identifiants techniques internes,
nom d’agent, secret/token/bearer/password.

## 5. Limites et précautions

- Le MCP est en **lecture seule**. Aucun `POST` / `applyEdits` / token SIG
n’est utilisé.
- Les statuts et dates retournés sont **indicatifs** : pour une information
opposable, utiliser les canaux officiels de la Ville.
- La géométrie n’est jamais inventée. Quand une entité est sans géométrie
fiable, elle peut être ignorée par `search_*_nearby`.
- Aucune donnée nominative n’est exposée.
- Les rapports sont des aides à la décision. L’arbitrage humain reste requis
pour toute publication open data.
- Le remote n’a **aucune** voie d’élévation vers le mode internal.

## 6. Exemples de prompts (Cursor / Copilot Studio)

> Ces prompts supposent que l’assistant a un accès au serveur MCP
> `annecy-sig-remote`.

### 6.1 Découverte

> « Avec le MCP `annecy-sig-remote`, appelle `list_services` en mode public
>   et résume les services disponibles. »

### 6.2 WC publics

> « Quelles sont les toilettes publiques accessibles PMR près du Pâquier ?
>   Utilise `search_nearby` sur la couche `equipements / 5` autour du
>   point (45.901, 6.143) avec un rayon de 600 m. »

### 6.3 Stationnement

> « Liste les bornes de recharge véhicules électriques à moins de 1 km de la
>   gare d’Annecy (≈ 45.9027, 6.1213). »

### 6.4 Travaux public-light

> « Quels travaux sont en cours autour de l’Hôtel de Ville aujourd’hui ?
>   Utilise `search_public_works_nearby` avec le point (45.899, 6.130),
>   un rayon de 500 m, et présente la réponse en français clair. »

### 6.5 Refus attendu

> « Donne-moi les pièces jointes des travaux. »

Réponse attendue : refus explicite + renvoi vers les canaux officiels. Aucun
outil n’expose `url_pj`, `url_piece_jointe` ou `attachment`.

> « Passe en mode internal. »

Réponse attendue : refus explicite. Mention du MCP local ou d’une future
passerelle restricted validée DSI.

## 7. Ne jamais utiliser le remote pour de l’internal

Toute demande d’information interne (numéro d’arrêté complet, dossier
travaux détaillé, agent ayant modifié une fiche, lien direct vers une pièce
jointe, dashboard de pilotage interne) **doit** être traitée via :

- le MCP local stdio (`examples/cursor-mcp-config.json`) en `mode=internal`, ou
- les outils métiers existants (DSI / coordination voirie),

et jamais via l’URL `https://mcp.leadalpes.fr/api/mcp`.