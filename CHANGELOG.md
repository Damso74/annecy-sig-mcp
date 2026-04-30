# Changelog — annecy-sig-mcp

## 1.0.0-rc.1 (2026-04-30)

Release candidate — pas de nouvelle fonctionnalité métier, le MCP est prêt à
tagger.

- **Documentation orientée usage** : `README.md` réécrit (présentation,
installation, configuration Cursor, 5 commandes utiles, 6 prompts de recette,
sécurité en 8 points). Les sections détaillées sont déplacées dans
`docs/TECHNICAL_CONTRACTS.md`, `docs/SECURITY.md`, `docs/RECETTE_TERRAIN.md`
et `docs/RELEASE_CHECKLIST.md`.
- **Smoke test MCP** : `scripts/smoke-mcp.ts` (`npm run smoke:mcp`) démarre
`dist/index.js` en stdio, vérifie que les 9 outils requis sont présents
(`list_services`, `describe_layer`, `query_layer`, `inventory_all_layers`,
  - les 5 `generate_*`) et qu’**aucune ligne** ne fuit sur stdout en dehors
  des trames JSON-RPC. Branché en CI.
- **Examples copier-coller** :
  - `examples/cursor-mcp-config.json` (Windows + macOS/Linux, avec
  `CONTRACT_POLICY=warn` et `DEFAULT_MODE=public`),
  - `examples/prompts.md` (catalogue ré-organisé public / internal / chatbot
  / open data / qualité),
  - `examples/terrain-recette-results.template.md` (à remplir pendant la
  recette terrain, OK/KO + temps de réponse + champs sensibles).
- **CI** : `.github/workflows/ci.yml` intègre `npm run smoke:mcp` après
`schemas:check` ; le workflow manuel `network-tests.yml` reste optionnel.
- **Versionnage** : `package.json` passe en `1.0.0-rc.1` ; `SERVER_VERSION`
est lu depuis `package.json` via `runtime/version.ts`, donc tout
`source.serverVersion` exposé porte la nouvelle valeur sans intervention.
- **Aucune nouvelle feature métier** ; aucune régression contractuelle ;
aucune modification de la logique public/internal, lecture seule, allowlist
ou sanitation.

## 0.9.0 (2026-04-30)

Release hardening : pas de nouvelle fonctionnalité métier, mais le MCP devient
**présentable** (CI, schémas propres, contrats complets, recette terrain).

- **Contrats complets** : ajout des schémas Zod `InventoryReportSchema` et
`InternalDashboardBriefSchema` ; `validateContract` est désormais branché sur
**tous** les rapports `generate_*` (inventory, open data, chatbot, action plan,
internal dashboard).
- **JSON Schemas nettoyés** : `exportJsonSchemas` passe les briques communes
(`ServiceKey`, `LayerId`, `ServerVersion`, `RuntimeMs`, `ReportFormat`,
`VisibilityMode`, `SampleStatus`, `GeometryStatus`, `RiskLevel`, `UsageStatus`,
`SamplingMode`, `SampleFallbackUsed`, `InventoryTarget`, `InventoryDiagnostic`,
`InventoryDiagnosticsCounts`, `InventoryExecutionMeta`, `InventorySourceV1`)
comme `definitions` partagées, ce qui supprime les `$ref` croisés bizarres
(ex. `serverVersion` qui pointait vers `serviceKey` parce que les deux
utilisaient `z.string().min(1)`). Les `description` Zod remontent dans les
JSON Schemas générés.
- **Affinement des schémas Zod** : `SemanticValidationSchema`, `SemanticCoverageSchema`,
`FieldValidationSchema` figent les structures qui étaient encore en `unknown`.
Les blocs restés permissifs (sample features Esri brutes, stats agrégées de
`list_*_works`) portent un commentaire qui justifie le choix.
- `**CONTRACT_POLICY=strict|warn|silent`** : politique de validation configurable.
Par défaut, strict en test/dev, warn en prod MCP. `STRICT_CONTRACTS=true|false`
reste accepté (compat V0.8). Aucun message ne fuit jamais sur stdout.
- `**npm run schemas:check`** : vérifie que les fichiers `schemas/*.schema.json`
versionnés sont exactement ceux régénérés depuis les schémas Zod actuels.
Sortie 1 + message exploitable sinon, sans dépendance à git.
- **GitHub Actions CI** : `.github/workflows/ci.yml` (build + tests offline +
schemas + schemas:check, `CONTRACT_POLICY=strict`). Workflow optionnel
`network-tests.yml` pour `RUN_NETWORK_TESTS=true`.
- **Sanitation exports renforcée** : suite dédiée `tests/v0.9.sanitation.test.ts`
qui vérifie qu’aucun marqueur sensible (`created_user`, `created_date`,
`last_edited_user`, `last_edited_date`, `token`, `password`, `secret`,
`url_piece_jointe`, `url_pj`, `attachment`, `bearer`) ne fuit ni en JSON ni
en Markdown sur les **cinq** rapports — y compris le brief dashboard interne
testé avec une fixture travaux qui injecte ces champs.
- **Recette terrain V0.9** dans `README.md` : 6 prompts Cursor avec la check-list
de ce qu’il faut vérifier (contrat de sortie, sanitation, mode public/internal).
- **Version** : `package.json` et le serveur MCP passent en `0.9.0` (le serveur
utilise désormais `SERVER_VERSION` issu de `runtime/version.ts`).

## 0.8.0 (2026-04-30)

Industrialisation : aucun nouveau rapport métier, mais le serveur passe d’un projet
qui « marche » à un projet **testable hors réseau, contractuel et maintenable**.

- **Client ArcGIS injectable / mockable** : nouvelle abstraction `ArcgisHttpClient`
(`src/arcgis/httpClient.ts`) consommée par `client.ts` ; `setArcgisHttpClient`
permet d’injecter un mock en test sans toucher aux garde-fous (GET only,
allowlist `ANNECY_SIG_BASE_URL`, timeout, cache GET interne).
- **Fixtures ArcGIS offline** : `tests/fixtures/arcgis/` (métadonnées, GeoJSON,
Esri JSON, `error-failed-query`, `empty-sample`, `exceededTransferLimit`,
fixture avec champs sensibles) + helper `tests/helpers/mockArcgisClient.ts`
(`installMockArcgisClient`, `defaultRegistryMatchers`, matchers ciblés).
- **Tests d’intégration offline** : `tests/v0.8.arcgisFixtures.test.ts`
(parsing, fallbacks, inventaire, rapports, sanitation), `tests/v0.8.contracts.test.ts`
(validation Zod + non-régression schemaVersion), `tests/v0.8.usageProfiles.test.ts`
(registre déclaratif). Pas un seul appel réseau réel sous `npx vitest run`.
- `**usageProfiles` déclaratifs** : `LayerRegistryEntry.usageProfiles?` avec
trois sous-profils (`chatbot`, `openData`, `dashboard`). `CHATBOT_CITIZEN_LAYERS`
est désormais **dérivé** du registre via `usageProfiles.chatbot.citizenRelevant`.
`assessOpenDataCandidate` lit `requiresLegalReview` / `blockingReasons` /
`publicationReadinessHint` : une couche flaguée juridique ne peut jamais être
classée VERT automatiquement.
- **Contrats Zod (V0.8)** : `src/contracts/` regroupe les schémas
`InventoryRunResultSchema`, `InventoryLayerRowSchema`, `OpenDataBriefSchema`,
`ChatbotReadinessReportSchema`, `LayerActionPlanSchema`. `validateContract`
(avec `ContractViolationError`) est branché sur les structured outputs
principaux : strict en test/dev (`STRICT_CONTRACTS=true`), warning sur
stderr en prod MCP — jamais de log sur stdout.
- **JSON Schema exportable** : `npm run schemas` génère `schemas/*.schema.json`
via `zod-to-json-schema` (draft-07) pour `inventory-run-result`,
`inventory-layer-row`, `open-data-brief`, `chatbot-readiness`,
`layer-action-plan`.
- **Conservé / non régressé** : aucune clé `v04` / `v05` / `v06` dans les payloads,
schemaVersion `inventory.v1` / `report.v1` / `open_data.v1` / `chatbot_readiness.v1` /
`layer_action_plan.v1` figés via `runtime/version.ts`. Sanitation,
allowlist, lecture seule, `RUN_NETWORK_TESTS=true` : inchangés.

## 0.7.0 (2026-04-30)

- **Schéma stable** : inventaire et rapports utilisent un bloc `source` avec `schemaVersion` (contrat JSON, ex. `inventory.v1`) et `serverVersion` (version npm) — suppression des clés transitoires `v04` / `v05` / `v06`.
- **Diagnostics** : `layers[].diagnostics[]` typés (`code`, `severity`, `message`) en complément des `warnings` ; agrégats `source.diagnostics` (échecs / vides / géométrie inconnue).
- **Ciblage** : option `targets` (`{ serviceKey, layerId? }`) sur inventaire, recommandation open data, rapports associés et chatbot ; **interdit** de combiner `serviceKeys` et `targets`.
- **Échantillonnage** : exposition explicite de `requestedSampleLimit`, `effectiveSampleLimit` (1 en `fast=true`) et méta dans `source.execution`.
- **Refactor** : code inventaire sous `src/inventory/` ; `lowerPropertyKeys` dans `src/utils/properties.ts` ; `getSemanticEssentialKeys` et périmètre chatbot (`CHATBOT_CITIZEN_LAYERS`, `chatbotReportFamily`) dans `registry.ts`.
- **Tests** : `tests/v0.7.test.ts` (hors ligne + 1 test réseau optionnel).

## 0.6.0 (2026-04-30)

- **Sécurité** : `describe_layer` ne renvoie plus de métadonnées ArcGIS brutes par défaut ; option `includeRawMetadata` (toujours sanitisée) ; utilitaire `sanitizeArcgisMetadata`.
- **Performance** : inventaire et rapports associés avec `mapWithConcurrency` (option `concurrency` 1–6, défaut 3) ; cache métadonnées par run (`metadataCache.ts`) ; filtre `serviceKeys` ; mode `fast` avec `samplingMode` / `samplingReliabilityNote`.
- **Scores** : `technicalScore` et `dataQualityScore` sur chaque ligne d’inventaire ; `score` historique conservé.
- **search_nearby** : fallback requête large + Haversine si le filtre spatial échoue ; `MAX_SEARCH_RADIUS_METERS` dans la config.
- **Exports** : `exportMeta` (JSON) ou front-matter YAML (Markdown) ; noms de fichiers horodatés stables.
- **Tests** : suite offline par défaut ; tests portail derrière `RUN_NETWORK_TESTS=true` ; nouveaux tests V0.6 (`v0.6.test.ts`).

## 0.5.0 et antérieur

Voir historique Git / README pour V0.1–V0.5 (semanticMappings, usageStatus, rapports, etc.).