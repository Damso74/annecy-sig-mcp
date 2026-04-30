# Validation terrain — annecy-sig-mcp `1.0.0-rc.1`

- **Version** : `1.0.0-rc.1`
- **Date de validation** : 30 avril 2026
- **Périmètre** : recette des 6 prompts MCP officiels +
  `scripts/recette-terrain.ts` (harnais CLI hors Cursor) + suite de
  validations standard.

## 1. Résumé

| Item | Statut |
| --- | --- |
| `npm run build` (tsc) | OK |
| Tests offline (`npx vitest run`) | OK — 109 passed, 5 skipped (tests réseau) |
| `npm run schemas:check` | OK — JSON Schemas versionnés à jour |
| `npm run smoke:mcp` | OK — 16 outils détectés, stdout silencieux |
| Tests réseau (`RUN_NETWORK_TESTS=true`) | OK constaté en recette terrain |
| Recette terrain — 6 prompts Cursor | 6 / 6 OK |
| Fuites de champs sensibles | 0 |

## 2. Résultats des 6 prompts

| # | Prompt | Outil principal | Verdict | Points vérifiés |
| --- | --- | --- | --- | --- |
| 1 | `list_services` mode `public` | `list_services` | OK | `equipements` + `mobilite` visibles ; `travaux` exposé avec `layersCount: 0` ; aucun marqueur sensible. |
| 2 | `describe_layer` `equipements/5` mode `public` | `describe_layer` | OK | `exposedFields` sans champ sensible ; `fieldAlignment.ignoredFieldsPreview` présent ; `supportsQuery=true` ; `geometryType` cohérent (point). |
| 3 | `generate_chatbot_readiness_report` mode `public` JSON | `generate_chatbot_readiness_report` | OK | `source.schemaVersion="chatbot_readiness.v1"` ; `serverVersion` présent ; `perLayer[].safeAnswerRules` non vide pour ≥ 1 couche citoyenne ; classification complète `ready` / `usableNow` / `usableWithCaution` / `notReady` / `unknownRequiresCheck`. |
| 4 | `generate_open_data_brief` mode `public` Markdown | `generate_open_data_brief` | OK | `source.schemaVersion="open_data.v1"` ; recommandations actionnables présentes (`quickWins` / `plan30Days` / `validationsNeeded` / `operationalSynthesis`) ; aucune couche `travaux` en VERT ; aucun marqueur sensible dans le Markdown. |
| 5 | `inventory_all_layers` mode `internal` ciblé `equipements/5`, `sampleLimit=10` | `inventory_all_layers` | OK | `layers.length = 1` ; `source.schemaVersion="inventory.v1"` ; `execution.targetsFilter` reflète l’input ; `execution.serviceKeysFilter=null` ; `source.diagnostics` agrégé présent. |
| 6 | `generate_internal_dashboard_brief` mode `internal` Markdown `date=2026-04-30` | `generate_internal_dashboard_brief` | OK | `source.schemaVersion="internal_dashboard.v1"` ; `executiveSummary` non vide ; `qualityAlerts` présent ; `travauxEnCoursEchantillon` sans marqueur sensible ; refus en `mode=public` confirmé. |

## 3. Limites restantes

- **Cursor** : si la configuration MCP est modifiée
  (`examples/cursor-mcp-config.json`), il faut **recharger Cursor** pour
  que la fenêtre détecte la nouvelle commande / les nouvelles variables
  d’environnement.
- **CI GitHub** : le passage du tag `v1.0.0-rc.1` n’a pas été observé
  automatiquement dans cette session (pas d’authentification `gh` confirmée
  ici). La CI doit être vérifiée manuellement avant de poser un tag stable.
- **Tag `v1.0.0` stable** : à poser **uniquement après** vérification de
  la CI verte sur `main` + un recul terrain raisonnable (≥ 48 h sans
  régression observée par les utilisateurs Cursor).

## 4. Harnais de recette

`scripts/recette-terrain.ts` (`npx tsx scripts/recette-terrain.ts`)
permet de rejouer les 6 prompts hors Cursor :

- démarre `dist/index.js` via le SDK MCP officiel en stdio (lecture seule) ;
- exécute exactement les 6 appels listés ci-dessus, dans l’ordre ;
- vérifie les invariants (champs sensibles, `schemaVersion`, recommandations,
  classification chatbot, refus public sur dashboard interne) ;
- écrit les résultats dans `outputs/recette-terrain-<timestamp>/`
  (gitignored).

Pas de secret ni de token en dur, logs sur **stderr uniquement**, ne modifie
pas la logique du serveur MCP.

## 5. Décisions opérationnelles

- **Conserver la RC `1.0.0-rc.1`** : aucune régression bloquante détectée.
- **Ne pas tagger `v1.0.0` stable maintenant** : attendre CI verte
  confirmée + recul terrain.
- **Aucune nouvelle fonctionnalité métier** ni modification d’allowlist,
  contrats Zod, sanitation ou comportement public/internal n’a été
  introduite dans cette passe de polish.
