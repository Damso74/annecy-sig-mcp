# Recette terrain — annecy-sig-mcp

Six prompts Cursor à exécuter dans l’ordre pour valider une release. Pour
chacun, la check-list de ce qu’il faut vérifier dans la réponse.

> Avant de commencer : `npm run build` puis configurer Cursor selon
> `examples/cursor-mcp-config.json`. Capturer les résultats dans
> `examples/terrain-recette-results.template.md`.

## Prompt 1 — `list_services` public

> « Appelle `list_services` en mode public et résume les services disponibles. »

À vérifier :

- La liste contient `equipements` et `mobilite`.
- Le service `travaux` peut apparaître en mode public, **mais avec
  `layersCount: 0`** : aucune couche travaux n’est interrogeable en mode
  public (verrou registry / allowlist).
- Aucun champ sensible visible (`url_pj`, `created_user`, `token`, …).
- Réponse Cursor en moins de 5 s.

## Prompt 2 — `describe_layer` WC publics

> « `describe_layer` pour `equipements` couche 5 en public. »

À vérifier :

- `fieldAlignment.ignoredFieldsPreview` n’expose ni `created_user`, ni
`last_edited_`*, ni `url_pj`, ni `attachment`.
- `supportsQuery` est présent (booléen).
- `geometryType` est cohérent (point pour les WC).
- Aucun JSON ArcGIS brut dans la réponse par défaut.

## Prompt 3 — `generate_chatbot_readiness_report` public

> « `generate_chatbot_readiness_report` mode public, format json. »

À vérifier :

- `source.schemaVersion === "chatbot_readiness.v1"`.
- `source.serverVersion` présent (ex. `1.0.0-rc.1`).
- `perLayer[].safeAnswerRules` non vide pour les couches citoyennes.
- Aucun marqueur sensible (`created_user`, `url_pj`, `token`, …) dans le
  payload.
- Le rapport classe correctement chaque couche entre `ready`, `usableNow`,
  `usableWithCaution`, `notReady` et `unknownRequiresCheck`, avec raisons
  explicites. **`ready=0` est acceptable** si la classification couvre
  l’ensemble des couches du périmètre et si les raisons sont fournies.

## Prompt 4 — `generate_open_data_brief` public

> « `generate_open_data_brief` mode public, format markdown. »

À vérifier :

- Aucune couche `travaux` en VERT (verrou juridique du registre).
- Dans la réponse structurée, `source.schemaVersion === "open_data.v1"`.
- Dans le Markdown, absence de marqueurs sensibles (`url_pj`,
  `created_user`, `attachment`, …).
- Présence de recommandations actionnables dans **au moins une** des sections
  suivantes du payload structuré : `quickWins`, `plan30Days`,
  `validationsNeeded`, ou `operationalSynthesis` (`quickWins7Days`,
  `plan30Days`, `arbitragesNecessaires`, `questionsSigMetier`).

## Prompt 5 — `inventory_all_layers` ciblé

> « `inventory_all_layers` en mode internal, `targets=[{serviceKey:"equipements",layerId:5}]`, `sampleLimit=10`. »

À vérifier :

- Exactement **1** ligne dans `layers`.
- `source.schemaVersion === "inventory.v1"`.
- `source.execution.targetsFilter` reflète l’input ;
`source.execution.serviceKeysFilter` est `null`.
- `source.diagnostics` agrégé est présent (`failedSamples`, `emptySamples`,
`geometryUnknownLayers`).

## Prompt 6 — `generate_internal_dashboard_brief`

> « `generate_internal_dashboard_brief` mode internal, format markdown,
> `date=2026-04-30`. »

À vérifier :

- `executiveSummary` non vide.
- `qualityAlerts` présent (peut être `[]`).
- `travauxEnCoursEchantillon` ne contient ni `url_pj`, ni `url_piece_jointe`,
ni `created_user`, ni `last_edited_`*.
- `source.schemaVersion === "internal_dashboard.v1"`.
- L’outil **refuse** d’être exécuté en `mode=public` (test alternatif).

> Si l’un de ces points casse en local, `**npx vitest run` doit l’avoir
> détecté avant** : la suite offline couvre le contrat, la sanitation et le
> verrouillage juridique.

## Méthode — rapport d’inventaire data

1. Lancer `inventory_all_layers` avec `mode=internal` pour un panorama complet.
2. Pour un service ciblé, croiser avec `list_layers` / `describe_layer`.
3. Approfondir les couches à risque avec `detect_data_quality_issues`.
4. Exporter la réponse JSON depuis Cursor vers une fiche ou un tableur.

## Méthode — préparer une note open data

1. `recommend_open_data_candidates` en `mode=public` pour les jeux exposables.
2. Refaire en `mode=internal` pour voir les jeux à traiter (ROUGE / ORANGE).
3. Ajuster `OPEN_DATA_TRAVAUX_TIER=red` si la note doit classer
  systématiquement les travaux en exclusion stricte.
4. Joindre validation métier / juridique pour tout candidat ORANGE.

