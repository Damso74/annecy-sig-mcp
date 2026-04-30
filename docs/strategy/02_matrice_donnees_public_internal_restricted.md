# Matrice de décision — familles de données (Annecy / Grand Annecy)

## Vocabulaire harmonisé

- **public** : canal citoyen et/ou open data **après validation** (métadonnées, licence, champs).
- **internal** : usage **agents / DSI / DGS**, réseau maîtrisé, hors canal grand public.
- **restricted** : hypothèse V1.1 — accès **authentifié**, **désactivé par défaut**, **allowlist dédiée** (hors périmètre de la RC actuelle).
- **do_not_publish** : **jamais** publié en open data **brut** tel quel.

Les références **SIG** désignent le périmètre exposé par le **MCP annecy-sig** (allowlist portail).

---

**Sources MCP** (mesure 2026, `serverVersion` **1.0.0-rc.1**, mode **standard**, `sampleLimit` **50**) : `generate_open_data_brief` (public), `generate_chatbot_readiness_report` (public), `inventory_all_layers` (internal), `generate_layer_action_plan` (couches cibles), `generate_internal_dashboard_brief` (date 2026-04-30). Les résultats sont des **diagnostics sur échantillon** (jusqu’à 50 entités par couche), **non** une certification exhaustive de toute la base.

**Sources data.gouv** : fiches `get_dataset_info` / recherche ciblée (pages `data.gouv.fr`). **Complément officiel** au SIG local, **pas** un substitut opérationnel à la donnée municipale fine.

---

| Famille | Source principale | Source complémentaire | Statut recommandé | Chatbot | Open data | Dashboard internal | Risque juridique | Risque réputationnel | Qualité (indicatif, échantillon / brief) | Action prioritaire | Délai réaliste |
|---------|-------------------|------------------------|-------------------|---------|-----------|-------------------|------------------|----------------------|-------------------------------------------|----------------------|----------------|
| WC publics | SIG `equipements/5` | BAN (géocodage) | **public** (après validation) | **oui** (MVP cadré) | **après nettoyage** métadonnées / licence | oui | faible | moyen (horaires / PMR) | **usable_now** sur le brief chatbot ; scores data ~59/100 **sur l’échantillon** | Publier fiche DCAT + règles d’usage | 30 j |
| Équipements publics (hors WC) | SIG équipements | — | **internal** → **public** ciblé | **prudence** | **après nettoyage** | oui | moyen | moyen | ORANGE ; libellés souvent absents **sur l’échantillon** chatbot | Référentiel libellés + complétude | 60–90 j |
| Établissements scolaires | SIG `equipements/1` | — | **internal** / **public** partiel | **prudence** (pas de sectorisation depuis la géoseule) | **après nettoyage** + avis pédagogique | oui | moyen | **élevé** si sectorisation supposée | ORANGE ; caution chatbot | Charte réponses + lien site éducation | 60 j |
| Équipements culturels | SIG `equipements/6` | — | idem équipements | **prudence** | **après nettoyage** | oui | faible | moyen | ORANGE ; catégorie souvent absente **sur l’échantillon** | Compléter catégories | 60 j |
| Équipements sportifs | SIG `equipements/9` | — | idem | **prudence** | **après nettoyage** | oui | faible | moyen | ORANGE | idem | 60 j |
| Bornes de recharge | SIG `mobilite/9` | IRVE tiers / GHO (jeu catalogué) | **public** / **internal** selon producteur | **prudence** | **après nettoyage** + alignement IRVE | oui | moyen (IRVE) | moyen | ORANGE SIG ; tiers licence parfois non précisée sur la fiche | Harmoniser source officielle | 60 j |
| Stationnement vélo | SIG `mobilite/10` | Ville d’Annecy Open Data | **internal** jusqu’à alignement | **non** (not_ready sur le brief) | **après nettoyage** | oui | faible | moyen | **needs_field_mapping** ; couverture sémantique nulle **sur l’échantillon** du plan d’action | Corriger mapping / compléter champs | 30–60 j |
| Annecy Parking | SIG `mobilite/16` | — | **internal** | **non** | **non** (sans géom fiable sur l’échantillon) | oui | faible | **élevé** si « dispo places » | géom **manquante** **sur l’échantillon** ; mapping incomplet | Restaurer géométrie + libellés | 60–90 j |
| Zones bleues / horodateurs | SIG `mobilite` (1, 12–15) | — | **internal** / **public** agrégé | **non** / **prudence** | **après nettoyage** ou **agrégats** | oui | moyen | **élevé** (erreur tarifaire) | ORANGE | Valider règles métier + simplification citoyenne | 90 j |
| Places PMR | SIG `mobilite/8` | — | **internal** | **non** | **non** sans validation accessibilité | oui | moyen | **élevé** | not_ready sur le brief chatbot | Ne pas inférer disponibilité | 90 j |
| Travaux | SIG `travaux/3` (**internal**) | — | **restricted** (hypothèse) / **do_not_publish** brut | **non** | **non** (brut) ; agrégats **après arbitrage** | **oui** (KPI sans documents joints en sortie MCP) | **élevé** | **élevé** | `internal_only` sur plan d’action ; géom manquante **sur l’échantillon** | Process documents + anonymisation + avis juridique | 90 j+ |
| Risques naturels / inondation | DDT74 PPR ; DREAL TRI | SIG urbanisme **internal** | **public** (référentiels déjà diffusés sur data.gouv) | **prudence** (info réglementaire, pas conseil juridique) | déjà sur data.gouv | oui (contexte) | moyen | moyen | **fort** sur source institutionnelle | Citer sources officielles datées | immédiat (réutilisation) |
| Transport Sibra | data.gouv GTFS | SIG mobilité | **public** (producteur Sibra) | **prudence** (horaires à jour) | déjà ouvert | oui | faible | moyen si données obsolètes | MAJ connue sur la fiche jeu | Miroir / lien officiel | immédiat |
| Vélonecy | data.gouv GBFS | SIG `mobilite/3` | **public** (Grand Annecy) | **prudence** | déjà ouvert | oui | faible | moyen | MAJ connue sur la fiche jeu | Cohérence temps réel vs SIG | 30 j |
| BAN / adresses | BAN ; BAL 74 | SIG | **public** (référentiels) | **prudence** (ne pas mélanger BAN et sectorisation scolaire) | déjà ouvert | oui | faible | faible | **fort** BAN ; BAL 74 — vérifier fraîcheur sur la fiche | Utiliser BAN pour géocodage ; plan BAL | continu |
| SIRENE | Insee | — | Référentiel **public** ; usages **internal** / agrégats pour croisement | **non** en conversation grand public **sans** cadre de finalité | **non** grand public conversationnel sans cadre | **oui** filtré et finalisé | **élevé** si ré-identification | moyen | **fort** comme référentiel statistique | Finalité, minimisation, pas de « qui habite ici » | 90 j |
| Qualité de l’air | LCSQA temps réel ; périmètres PAQA 74 | Stations locales | **public** (sélection stations) | **prudence** | oui / veille | oui | faible | moyen | **fort** LCSQA ; lien local à **expliciter** métier | Mapper stations ↔ territoire | 60 j |
| Lac / eau / assainissement | SILA ; pluvial GA | SIG **internal** | **public** (jeux déjà publiés) ; **internal** si croisement nominatif | **non** sauf pédagogie | déjà ouvert (lire mentions d’exhaustivité sur la fiche) | oui | moyen | moyen | **moyen** (qualité déclarée par producteur) | Usage technique / sensibilisation | 60 j |

---

## Synthèse mesures MCP (non sensibles)

| Outil | `schemaVersion` | `serverVersion` | `requestedSampleLimit` | `effectiveSampleLimit` | `runtimeMs` (ordre de grandeur) | Lecture |
|-------|-----------------|-----------------|------------------------|-------------------------|----------------------------------|---------|
| `generate_chatbot_readiness_report` | `chatbot_readiness.v1` | 1.0.0-rc.1 | 50 | 50 | ~828 | **Standard** : meilleure base qu’en `fast` ; reste **échantillonné** |
| `generate_open_data_brief` | `open_data.v1` | 1.0.0-rc.1 | 50 | 50 | ~767 (inventaire imbriqué ~759) | Idem |
| `inventory_all_layers` (**internal**) | `inventory.v1` | 1.0.0-rc.1 | 50 | 50 | ~120 | **28** couches scannées ; **0** échec d’échantillon sur la passe |
| `generate_internal_dashboard_brief` | `internal_dashboard.v1` | 1.0.0-rc.1 | — | — | ~50 | Agrégats **sans** liens vers documents joints ; filtres date explicites |
| `generate_layer_action_plan` | `layer_action_plan.v1` | 1.0.0-rc.1 | 50 | 50 | ~1–2 ms (inventaire ciblé) | **Par couche** ; scores **préliminaires** sur échantillon |

**Points d’attention** : couches mobilité **10** et **16** — incohérences mapping registre / service sur les mesures ; parking **16** — géométrie absente **sur l’échantillon**. **Travaux** — géométrie absente **sur l’échantillon** ; usage réservé **internal** ; revue légale avant toute ouverture.

---

## Top 5 priorités data

1. **WC publics** : cadrer publication open data **et** MVP chatbot (source + limites).  
2. **Stationnement vélo** (`mobilite/10`) : aligner mapping / libellés sur les champs réellement servis par ArcGIS.  
3. **Annecy Parking** (`mobilite/16`) : fiabiliser géométrie et libellés **avant** tout usage « près de moi ».  
4. **Équipements publics** (hors WC) : catégories et libellés **sur la base complète**, au-delà de l’échantillon.  
5. **Travaux** : **uniquement** agrégats et pilotage **internal** ; **jamais** brut ni exposition de contenus de dossier via le MCP grand public.

---

*Aucune donnée travaux brute, aucun lien vers document joint, aucune information confidentielle dans ce document.*
