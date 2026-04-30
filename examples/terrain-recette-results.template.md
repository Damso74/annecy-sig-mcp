# Recette terrain — résultats

Copier ce template avant chaque release et remplir au fur et à mesure de la
recette. Conserver le fichier rempli avec le tag (ex.
`recette-v1.0.0-rc.1.md`).

- **Version testée** :
- **Date** :
- **Opérateur** :
- **Environnement Cursor** : Windows / macOS / Linux — _préciser_
- **`SERVER_VERSION` réelle observée** : _ex. `1.0.0-rc.1`_

## Prompt 1 — `list_services` public

| Champ                              | Valeur                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| Prompt                             | « Appelle `list_services` en mode public et résume… »           |
| Résultat attendu                   | Services `equipements` + `mobilite` ; `travaux` peut apparaître mais avec `layersCount: 0` |
| OK / KO                            |                                                                 |
| Temps de réponse                   |                                                                 |
| Commentaire                        |                                                                 |
| Export créé                        | _N/A_                                                           |
| Champs sensibles absents (Y/N)     |                                                                 |

## Prompt 2 — `describe_layer` WC publics public

| Champ                              | Valeur                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| Prompt                             | « `describe_layer` pour `equipements` couche 5 en public. »     |
| Résultat attendu                   | `ignoredFieldsPreview` propre, `supportsQuery` présent          |
| OK / KO                            |                                                                 |
| Temps de réponse                   |                                                                 |
| Commentaire                        |                                                                 |
| Export créé                        | _N/A_                                                           |
| Champs sensibles absents (Y/N)     |                                                                 |

## Prompt 3 — `generate_chatbot_readiness_report` public json

| Champ                              | Valeur                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| Prompt                             | « `generate_chatbot_readiness_report` mode public, json. »      |
| Résultat attendu                   | `schemaVersion === "chatbot_readiness.v1"`, `safeAnswerRules`   |
|                                    | non vide, aucun marqueur sensible                               |
| OK / KO                            |                                                                 |
| Temps de réponse                   |                                                                 |
| Commentaire                        |                                                                 |
| Export créé                        | _ex. `outputs/chatbot-readiness-public-…json`_                  |
| Champs sensibles absents (Y/N)     |                                                                 |

## Prompt 4 — `generate_open_data_brief` public markdown

| Champ                              | Valeur                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| Prompt                             | « `generate_open_data_brief` mode public, markdown. »           |
| Résultat attendu                   | Aucun `travaux` en VERT (verrou juridique), pas de `url_pj`     |
|                                    | dans le markdown, `schemaVersion === "open_data.v1"`            |
| OK / KO                            |                                                                 |
| Temps de réponse                   |                                                                 |
| Commentaire                        |                                                                 |
| Export créé                        | _ex. `outputs/open-data-brief-public-…md`_                      |
| Champs sensibles absents (Y/N)     |                                                                 |

## Prompt 5 — `inventory_all_layers` internal ciblé

| Champ                              | Valeur                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| Prompt                             | « `inventory_all_layers` internal, `targets=[…]`, `sampleLimit=10`. » |
| Résultat attendu                   | 1 ligne, `targetsFilter` présent, `serviceKeysFilter=null`,    |
|                                    | `diagnostics` agrégé présent                                    |
| OK / KO                            |                                                                 |
| Temps de réponse                   |                                                                 |
| Commentaire                        |                                                                 |
| Export créé                        | _N/A_                                                           |
| Champs sensibles absents (Y/N)     |                                                                 |

## Prompt 6 — `generate_internal_dashboard_brief`

| Champ                              | Valeur                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| Prompt                             | « `generate_internal_dashboard_brief` internal markdown. »      |
| Résultat attendu                   | `executiveSummary` non vide, échantillon sans `url_pj`,         |
|                                    | `schemaVersion === "internal_dashboard.v1"`                     |
| OK / KO                            |                                                                 |
| Temps de réponse                   |                                                                 |
| Commentaire                        |                                                                 |
| Export créé                        | _ex. `outputs/internal-dashboard-…md`_                          |
| Champs sensibles absents (Y/N)     |                                                                 |

## Synthèse

- **Résultat global** : OK / KO
- **Tag à poser** : _ex. `v1.0.0-rc.1`_
- **Régressions à corriger avant release stable** :
- **Validations métier complémentaires demandées** :
