# Contrats techniques — annecy-sig-mcp

Ce document détaille les **contrats JSON** stables exposés par les outils MCP,
les schémas Zod sous-jacents et les règles de versionnage. Pour la liste des
outils MCP eux-mêmes, voir le `README.md`.

## 1. `serverVersion` vs `schemaVersion`


| Champ           | Source                   | Stabilité                                                          |
| --------------- | ------------------------ | ------------------------------------------------------------------ |
| `serverVersion` | `package.json` (npm)     | Suit les releases applicatives (1.0.0, 1.0.1, …)                   |
| `schemaVersion` | `src/runtime/version.ts` | **Stable** entre releases tant que le contrat métier ne change pas |


Les anciennes clés transitoires `v04`, `v05`, `v06` ont été supprimées en V0.7
et **ne** réapparaîtront **pas**. Tout changement de contrat se fait via un
nouveau `schemaVersion` (ex. `inventory.v1` → `inventory.v2`).

## 2. Schémas Zod par contrat

Tous les schémas vivent sous `src/contracts/` et passent par `validateContract`
avant retour MCP.


| Contrat                         | `schemaVersion`          | Schéma Zod                     | JSON Schema généré                     |
| ------------------------------- | ------------------------ | ------------------------------ | -------------------------------------- |
| Résultat d’inventaire complet   | `inventory.v1`           | `InventoryRunResultSchema`     | `inventory-run-result.schema.json`     |
| Ligne d’inventaire (par couche) | `inventory.v1` (héritée) | `InventoryLayerRowSchema`      | `inventory-layer-row.schema.json`      |
| Rapport d’inventaire (DGS)      | `report.v1`              | `InventoryReportSchema`        | `inventory-report.schema.json`         |
| Brief open data                 | `open_data.v1`           | `OpenDataBriefSchema`          | `open-data-brief.schema.json`          |
| Rapport maturité chatbot        | `chatbot_readiness.v1`   | `ChatbotReadinessReportSchema` | `chatbot-readiness.schema.json`        |
| Plan d’action couche            | `layer_action_plan.v1`   | `LayerActionPlanSchema`        | `layer-action-plan.schema.json`        |
| Brief dashboard interne travaux | `internal_dashboard.v1`  | `InternalDashboardBriefSchema` | `internal-dashboard-brief.schema.json` |


Briques communes nommées (réutilisées dans les `definitions` JSON Schema) :
`ServiceKey`, `LayerId`, `ServerVersion`, `RuntimeMs`, `ReportFormat`,
`VisibilityMode`, `SampleStatus`, `GeometryStatus`, `RiskLevel`, `UsageStatus`,
`SamplingMode`, `SampleFallbackUsed`, `InventoryTarget`, `InventoryDiagnostic`,
`InventoryDiagnosticsCounts`, `InventoryExecutionMeta`, `InventorySourceV1`.

## 3. Politique de validation `CONTRACT_POLICY`


| Valeur   | Comportement                                                                               |
| -------- | ------------------------------------------------------------------------------------------ |
| `strict` | Toute violation lève `ContractViolationError`. Par défaut en test/dev (`NODE_ENV=test`).   |
| `warn`   | Pas de throw — message écrit sur **stderr** uniquement. Par défaut en prod MCP.            |
| `silent` | Pas de throw, pas de log (utile pour les benchs ou pipelines aval qui valident eux-mêmes). |


Compatibilité V0.8 : `STRICT_CONTRACTS=true|false` reste accepté.
**Aucun message ne fuit jamais sur stdout** (transport stdio MCP).

## 4. Bloc `source.execution` (inventaire)

```json
{
  "concurrency": 4,
  "fast": false,
  "requestedSampleLimit": 20,
  "effectiveSampleLimit": 20,
  "serviceKeysFilter": ["equipements"],
  "targetsFilter": null
}
```

- `requestedSampleLimit` = limite demandée (plafonnée par `MAX_RESULT_LIMIT`).
- `effectiveSampleLimit` = limite réellement envoyée à ArcGIS — vaut **1** si `fast=true`.
- `serviceKeysFilter` et `targetsFilter` ne sont jamais positionnés simultanément :
combiner les deux est refusé côté validation avec une erreur explicite.

## 5. Diagnostics structurés

Chaque ligne d’inventaire porte un tableau `diagnostics[]` typé :

```json
{
  "code": "SAMPLE_FAILED",
  "severity": "error",
  "message": "Failed to execute query (ArcGIS).",
  "details": { "fallbackChain": ["registry_valid", "star", "objectid_only"] }
}
```

Les `warnings` texte historiques sont conservés pour compatibilité descendante.
Les compteurs agrégés sont sous `source.diagnostics` :

```json
{ "failedSamples": 2, "emptySamples": 0, "geometryUnknownLayers": 1 }
```

## 6. Statuts métier `usageStatus`


| Statut                       | Lecture                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ready`                      | Champs essentiels / secondaires et signal géométrique suffisamment bons, échantillon OK.                  |
| `usable_now`                 | Exploitable tout de suite avec un niveau de prudence modéré sur le périmètre annoncé.                     |
| `usable_with_caution`        | Exploitable mais champs secondaires ou signaux partiels — documenter les limites.                         |
| `needs_field_mapping`        | Le service répond mais les mappings métier essentiels manquent ou ne correspondent pas aux champs ArcGIS. |
| `needs_data_cleaning`        | Mappings cohérents mais données souvent nulles / géométrie requise absente / qualité data à améliorer.    |
| `to_investigate_technically` | Échantillon en échec ou vide, Query indisponible, ou métadonnées indisponibles — action SIG / technique.  |
| `internal_only`              | Couche réservée au mode internal (pas de diffusion grand public telle quelle).                            |
| `not_usable`                 | Fiabilité insuffisante pour un usage simple même après un mapping léger (ex. risque `red`).               |


## 7. `usageProfiles` dans `registry.ts`

Chaque entrée de `LAYER_REGISTRY` peut porter un bloc `usageProfiles`
déclaratif :

```ts
usageProfiles: {
  chatbot: {
    citizenRelevant: true,
    requiresGeometry: true,
    requiredSemanticKeys: ["labelField"],
    safeAnswerRules: ["…"],
    typicalQuestions: ["…"],
  },
  openData: {
    candidate: false,
    publicationReadinessHint: "requires_legal_review",
    requiresLegalReview: true,
    blockingReasons: ["Pièces jointes (url_pj) à exclure ; arbitrage juridique."],
  },
  dashboard: { relevant: true, kpiHints: ["…"] },
}
```

Effets concrets :

- Le périmètre **chatbot citoyen** est dérivé du registre via
`usageProfiles.chatbot.citizenRelevant` (plus de liste séparée).
- Côté open data, une couche flaguée juridique ne peut **jamais** ressortir VERT
automatiquement (`profileForcesNonGreen`).
- Le profil `dashboard` n’altère **pas** la visibilité métier (`internal` reste
`internal`).

## 8. Génération et vérification des JSON Schemas

```bash
npm run schemas         # régénère schemas/*.schema.json (draft-07)
npm run schemas:check   # vérifie que les fichiers versionnés sont à jour
```

`schemas:check` régénère dans un dossier temporaire et compare octet-par-octet
(sans dépendance à git). Échoue avec un message exploitable si un schéma a
dérivé. La CI (`.github/workflows/ci.yml`) lance ce contrôle systématiquement
avec `CONTRACT_POLICY=strict`.

## 9. Architecture du code


| Élément                               | Rôle                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/inventory/*`                     | Inventaire découpé : résolution des couches, champs, échantillon, scoring, diagnostics, orchestration `runInventory`.  |
| `src/runtime/version.ts`              | `SERVER_VERSION` (lu depuis `package.json`) et constantes `*_SCHEMA_VERSION`.                                          |
| `src/registry.ts`                     | Allowlist services / couches, champs, visibilité, risque, `semanticMappings`, `usageProfiles`, défauts inventaire.     |
| `src/config.ts`                       | Variables d’environnement (`ANNECY_SIG_BASE_URL`, limites, `DEFAULT_MODE`, timeout/cache, `MAX_SEARCH_RADIUS_METERS`). |
| `src/arcgis/httpClient.ts`            | Interface `ArcgisHttpClient` injectable + client réseau par défaut (allowlist hôte, timeout, cache GET).               |
| `src/arcgis/client.ts`                | Délègue les GET au client injectable ; parse les réponses ArcGIS (métadonnées, query, count, échantillons).            |
| `src/arcgis/metadataCache.ts`         | Cache mémoire par passe d’inventaire.                                                                                  |
| `src/utils/sanitizeArcgisMetadata.ts` | Sanitation profonde des métadonnées / champs ArcGIS pour `describe_layer` et exports.                                  |
| `src/utils/concurrency.ts`            | `mapWithConcurrency` — parallélisation bornée à ordre stable.                                                          |
| `src/utils/inventoryScore.ts`         | Score `score`, `technicalScore`, `dataQualityScore`.                                                                   |
| `src/utils/semanticMappings.ts`       | Validation et couverture des `semanticMappings` vs champs ArcGIS réels.                                                |
| `src/utils/inventoryUsage.ts`         | Dérivation `usageStatus` / `usageWarnings`.                                                                            |
| `src/contracts/*`                     | Briques Zod, schémas par rapport, helper `validateContract`, scripts `schemas` et `schemas:check`.                     |
| `src/tools/*.ts`                      | Implémentation des outils MCP (logique métier + normalisation).                                                        |
| `src/server.ts`                       | Enregistrement des outils avec `@modelcontextprotocol/sdk`.                                                            |
| `src/index.ts`                        | Bootstrap stdio (transport).                                                                                           |


## 10. Tests offline

```bash
npx vitest run                  # 0 appel réseau, fixtures sous tests/fixtures/arcgis/
RUN_NETWORK_TESTS=true npm test # active les tests qui touchent réellement le portail
```

Les tests offline couvrent : parsing GeoJSON / Esri JSON, fallbacks
`outFields`, inventaire complet, sanitation des cinq rapports en JSON et
Markdown, `usageProfiles` dérivés du registre, `CONTRACT_POLICY` (strict / warn
/ silent), et la cohérence des JSON Schemas versionnés.