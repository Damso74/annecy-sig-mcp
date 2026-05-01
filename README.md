# annecy-sig-mcp

Serveur **MCP** (Model Context Protocol) en **TypeScript**, **lecture seule**,
pour interroger les couches **ArcGIS REST** du portail SIG de la Ville
d’Annecy (`portailsig.annecy.fr`) depuis Cursor.

- Allowlist stricte de services et couches.
- Modes `public` (champs réduits) / `internal` (champs étendus, jamais de
secrets).
- Réponses JSON normalisées (jamais le JSON ArcGIS brut).
- Contrats Zod stables pour tous les rapports `generate_`* (`schemaVersion` `*.v1`).
- Tests offline avec fixtures HTTP — `npx vitest run` ne fait aucun appel
réseau par défaut.

**Version : 1.0.0-rc.1** — release candidate prête pour recette terrain.

## 1. Installation

```bash
git clone <repo>
cd annecy-sig-mcp
npm ci
cp .env.example .env   # ajuster ANNECY_SIG_BASE_URL et DEFAULT_MODE si besoin
npm run build
```

Pré-requis : Node.js ≥ 20.

## 2. Configuration Cursor

Voir le modèle prêt à coller : `[examples/cursor-mcp-config.json](examples/cursor-mcp-config.json)`.
Il contient un bloc Windows et un bloc macOS/Linux ; remplacer le chemin
absolu vers `dist/index.js`. Aucun secret n’est requis.

Variables d’environnement minimales :

```
ANNECY_SIG_BASE_URL=https://portailsig.annecy.fr/server/rest/services
DEFAULT_MODE=public
CONTRACT_POLICY=warn   # strict en CI/dev, silent pour les benchs
```

Le serveur communique en stdio. **Ne pas brancher d’autre logger sur stdout** :
le transport MCP s’en sert pour le protocole.

## 3. Cinq commandes utiles

```bash
npm run build           # tsc → dist/
npm run start           # lance dist/index.js (stdio MCP)
npx vitest run          # tests offline (fixtures, 0 appel réseau)
npm run schemas         # régénère schemas/*.schema.json
npm run schemas:check   # vérifie que les schemas versionnés sont à jour
```

Optionnel : `npm run smoke:mcp` (smoke test stdio sans réseau, voir §6) ;
`RUN_NETWORK_TESTS=true npm test` pour activer les tests qui touchent le
portail réel.

## 4. Recette terrain — 6 prompts

À exécuter dans Cursor avant chaque tag, dans l’ordre. Les résultats se notent
dans une copie de `[examples/terrain-recette-results.template.md](examples/terrain-recette-results.template.md)`.

1. « Appelle `list_services` en mode public et résume les services disponibles. »
2. « `describe_layer` pour `equipements` couche 5 en public. »
3. « `generate_chatbot_readiness_report` mode public, format json. »
4. « `generate_open_data_brief` mode public, format markdown. »
5. « `inventory_all_layers` en mode internal,
  `targets=[{serviceKey:"equipements",layerId:5}]`, `sampleLimit=10`. »
6. « `generate_internal_dashboard_brief` mode internal, format markdown,
  `date=2026-04-30`. »

Détails (résultat attendu, points à vérifier, marqueurs sensibles à exclure) :
`[docs/RECETTE_TERRAIN.md](docs/RECETTE_TERRAIN.md)`.

Plus de prompts (découverte, qualité données, open data) :
`[examples/prompts.md](examples/prompts.md)`.

## 5. Sécurité — 8 points

1. **Lecture seule** : aucun `POST` / `applyEdits` / token dans ce dépôt.
2. **Allowlist d’hôte** : seules les URLs sous `ANNECY_SIG_BASE_URL`
  (`portailsig.annecy.fr`) sont acceptées.
3. **Allowlist de couches** : tout service ou couche non déclaré dans
  `src/registry.ts` est refusé.
4. **Sanitation des sorties** : `created_user`, `last_edited_`*, `url_pj`,
  `url_piece_jointe`, `attachment`, `token`, `password`, `secret`, `bearer`
   filtrés sur les cinq rapports en JSON et Markdown
   (`tests/v0.9.sanitation.test.ts`).
5. **Mode `public` strict** : couches `internal` invisibles et
  ininterrogeables ; `generate_internal_dashboard_brief` refuse tout mode
   autre que `internal`.
6. `**WHERE` sécurisé** : longueur max 500, motifs SQL dangereux refusés
  (`assertSafeWhere`).
7. **Limites** : `MAX_RESULT_LIMIT=1000`, `MAX_SEARCH_RADIUS_METERS=5000`,
  `ARCGIS_TIMEOUT_MS=10000`, comptage via `count_layer` `returnCountOnly`.
8. **Stdio MCP propre** : aucun message ne fuit sur stdout depuis le code
  serveur (logs sur stderr uniquement, validé par `scripts/smoke-mcp.ts`).

Détails et règles d’ajout d’une couche :
`[docs/SECURITY.md](docs/SECURITY.md)`.

## 6. Documents techniques


| Document                                                                                       | Contenu                                                              |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `[docs/TECHNICAL_CONTRACTS.md](docs/TECHNICAL_CONTRACTS.md)`                                   | Contrats Zod, `schemaVersion`, `usageProfiles`, architecture du code |
| `[docs/SECURITY.md](docs/SECURITY.md)`                                                         | Lecture seule, allowlist, sanitation, mode public/internal           |
| `[docs/PUBLIC_REMOTE_USAGE.md](docs/PUBLIC_REMOTE_USAGE.md)`                                   | Mode d’emploi détaillé du serveur MCP distant public                 |
| `[docs/DATA_CATALOG_PUBLIC_REMOTE.md](docs/DATA_CATALOG_PUBLIC_REMOTE.md)`                     | Catalogue des données publiques (services, couches, champs)          |
| `[docs/RECETTE_TERRAIN.md](docs/RECETTE_TERRAIN.md)`                                           | Six prompts détaillés + check-lists                                  |
| `[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)`                                       | Pré-vol, build/tests, smoke, recette, tag Git                        |
| `[examples/cursor-mcp-config.json](examples/cursor-mcp-config.json)`                           | Configuration MCP prête à coller (Windows + macOS/Linux)             |
| `[examples/copilot-studio-instructions.md](examples/copilot-studio-instructions.md)`           | Modèle d’instructions Copilot Studio (assistant SIG public)          |
| `[examples/prompts.md](examples/prompts.md)`                                                   | Catalogue de prompts copier-coller (public, internal, chatbot, …)    |
| `[examples/terrain-recette-results.template.md](examples/terrain-recette-results.template.md)` | Template à remplir pendant la recette terrain                        |
| `[CHANGELOG.md](CHANGELOG.md)`                                                                 | Historique des versions                                              |


## 7. Outils MCP exposés

`list_services`, `list_layers`, `describe_layer`, `query_layer`, `search_nearby`,
`count_layer`, `list_current_works`, `list_late_works`,
`detect_data_quality_issues`, `inventory_all_layers`,
`recommend_open_data_candidates`, `generate_inventory_report`,
`generate_open_data_brief`, `generate_chatbot_readiness_report`,
`generate_internal_dashboard_brief`, `generate_layer_action_plan`,
`list_public_works`, `search_public_works_nearby`.

Détails de chaque outil et de leurs structured outputs :
`[docs/TECHNICAL_CONTRACTS.md](docs/TECHNICAL_CONTRACTS.md)`.

### 7.1 Travaux publics filtrés (V1.0)

Deux outils dédiés exposent une vue **public-light** des travaux, utilisable
en stdio local **et** sur le remote HTTP public :

- `list_public_works` : liste filtrée (titre simplifié, statut, dates,
secteur, commune). Aucun champ technique, jamais de pièce jointe, jamais
de numéro complet d’arrêté, jamais de description libre.
- `search_public_works_nearby` : travaux public-light autour d’un point
(lat/lon + rayon plafonné par `MAX_SEARCH_RADIUS_METERS`).

> Ces outils ne donnent **jamais** accès à la couche travaux brute. La couche
> brute reste réservée au mode internal (MCP local stdio) via
> `list_current_works` / `list_late_works`.

Détails métier et liste exhaustive des champs autorisés / interdits :
`[docs/DATA_CATALOG_PUBLIC_REMOTE.md](docs/DATA_CATALOG_PUBLIC_REMOTE.md)`.

## 8. Tests

```bash
npx vitest run                    # 100 % offline, fixtures sous tests/fixtures/arcgis/
RUN_NETWORK_TESTS=true npm test   # active les tests qui touchent le portail réel
npm run smoke:mcp                 # démarre dist/index.js, vérifie tools + stdout silencieux
npm run smoke:http                # smoke local du handler HTTP (auth, refus internal, périmètre)
npm run typecheck:api             # typecheck du dossier api/ (handlers Vercel)
```

Sur Windows (PowerShell) : `$env:RUN_NETWORK_TESTS="true"; npm test`.

## 9. Déploiement distant Vercel (transport HTTP)

En complément du MCP local stdio, le serveur peut être déployé sur Vercel
pour être consommé en remote depuis Cursor / Copilot / autre client MCP via
une URL HTTPS. Le transport HTTP est **public-only par défaut** et ne donne
jamais accès aux outils internal.

### 9.1 URL cible

URL recommandée (à configurer dans Vercel → Domains) :

```
https://mcp.leadalpes.fr/api/mcp
```

URL de fallback (sous-domaine Vercel) :

```
https://<projet>.vercel.app/api/mcp
```

Endpoint de diagnostic (sans appel ArcGIS) :

```
https://mcp.leadalpes.fr/api/health
```

### 9.2 Variables d'environnement Vercel

À renseigner dans **Project → Settings → Environment Variables** :


| Variable                      | Valeur recommandée                                        | Remarque                                    |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------------- |
| `ANNECY_SIG_BASE_URL`         | `https://portailsig.annecy.fr/server/rest/services`       | Allowlist d'hôte                            |
| `DEFAULT_MODE`                | `public`                                                  | Mode par défaut                             |
| `CONTRACT_POLICY`             | `warn`                                                    | `strict` casserait les rapports en prod     |
| `REMOTE_PUBLIC_ONLY`          | `true`                                                    | **Ne jamais désactiver** sur l'URL publique |
| `REMOTE_ALLOW_INTERNAL_TOOLS` | `false`                                                   | Garde les outils travaux invisibles         |
| `MCP_PUBLIC_READ_TOKEN`       | (générer un secret aléatoire, ex. `openssl rand -hex 32`) | Sans valeur → auth désactivée               |
| `PUBLIC_WORK_ID_SALT`         | (générer un secret aléatoire, ex. `openssl rand -hex 32`) | **Obligatoire en prod** : sel SHA-256 pour `id_public` opaque (vue travaux public-light) |
| `MAX_RESULT_LIMIT`            | `1000`                                                    | Plafond résultats                           |
| `MAX_SEARCH_RADIUS_METERS`    | `5000`                                                    | Plafond rayon search_nearby                 |
| `ARCGIS_TIMEOUT_MS`           | `10000`                                                   | Timeout ArcGIS                              |
| `ARCGIS_CACHE_TTL_MS`         | `300000`                                                  | Cache GET en mémoire (5 min)                |


Aucun token portail SIG n'est requis (lecture seule).

### 9.3 Configuration Cursor remote

Voir le modèle prêt à coller : `[examples/cursor-mcp-remote-config.json](examples/cursor-mcp-remote-config.json)`.

```json
{
  "mcpServers": {
    "annecy-sig-remote": {
      "url": "https://mcp.leadalpes.fr/api/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_PUBLIC_READ_TOKEN>"
      }
    }
  }
}
```

Si `MCP_PUBLIC_READ_TOKEN` n'est pas défini côté serveur, supprimer le bloc
`headers`.

### 9.4 Étapes de déploiement

1. Créer un projet Vercel et le lier à ce dépôt
  (`vercel link`, ou via le dashboard Vercel).
2. Renseigner les variables d'environnement (§9.2).
3. Déployer (`vercel --prod` ou via la CI Vercel).
4. **Domaine custom** `mcp.leadalpes.fr` :
  - Vercel → Project → Settings → Domains → *Add Domain* `mcp.leadalpes.fr`.
  - Suivre l'instruction Vercel (CNAME `cname.vercel-dns.com` ou ALIAS).
  - Ajouter l'enregistrement DNS chez votre registrar / fournisseur DNS
  (cette étape sort du scope du repo).
5. Vérifier `https://mcp.leadalpes.fr/api/health` → `{ "status": "ok" }`.
6. Brancher Cursor avec `examples/cursor-mcp-remote-config.json`.

### 9.5 Avertissement

- Le transport HTTP distant est **public-only**. Tout appel d'outil avec
`mode=internal` est explicitement refusé avec un message clair invitant à
utiliser le MCP local stdio.
- Les outils internal-only (`generate_internal_dashboard_brief`,
`list_current_works`, `list_late_works`) **ne sont pas exposés** par défaut.
- Pour ces outils, garder le bootstrap stdio local (`examples/cursor-mcp-config.json`).

## Licence

MIT — voir `package.json`.