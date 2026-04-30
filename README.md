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
| `[docs/RECETTE_TERRAIN.md](docs/RECETTE_TERRAIN.md)`                                           | Six prompts détaillés + check-lists                                  |
| `[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)`                                       | Pré-vol, build/tests, smoke, recette, tag Git                        |
| `[examples/cursor-mcp-config.json](examples/cursor-mcp-config.json)`                           | Configuration MCP prête à coller (Windows + macOS/Linux)             |
| `[examples/prompts.md](examples/prompts.md)`                                                   | Catalogue de prompts copier-coller (public, internal, chatbot, …)    |
| `[examples/terrain-recette-results.template.md](examples/terrain-recette-results.template.md)` | Template à remplir pendant la recette terrain                        |
| `[CHANGELOG.md](CHANGELOG.md)`                                                                 | Historique des versions                                              |


## 7. Outils MCP exposés

`list_services`, `list_layers`, `describe_layer`, `query_layer`, `search_nearby`,
`count_layer`, `list_current_works`, `list_late_works`,
`detect_data_quality_issues`, `inventory_all_layers`,
`recommend_open_data_candidates`, `generate_inventory_report`,
`generate_open_data_brief`, `generate_chatbot_readiness_report`,
`generate_internal_dashboard_brief`, `generate_layer_action_plan`.

Détails de chaque outil et de leurs structured outputs :
`[docs/TECHNICAL_CONTRACTS.md](docs/TECHNICAL_CONTRACTS.md)`.

## 8. Tests

```bash
npx vitest run                    # 100 % offline, fixtures sous tests/fixtures/arcgis/
RUN_NETWORK_TESTS=true npm test   # active les tests qui touchent le portail réel
npm run smoke:mcp                 # démarre dist/index.js, vérifie tools + stdout silencieux
```

Sur Windows (PowerShell) : `$env:RUN_NETWORK_TESTS="true"; npm test`.

## Licence

MIT — voir `package.json`.