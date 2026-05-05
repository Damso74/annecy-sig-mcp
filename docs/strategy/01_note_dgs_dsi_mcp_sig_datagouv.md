# Note DGS / DSI — MCP annecy-sig et complément data.gouv

> **Décision proposée (synthèse)**  
>
> - **GO** pour utiliser le MCP annecy-sig en **diagnostic interne** (qualité, briefs, inventaires).  
> - **GO** pour un **MVP chatbot citoyen** limité aux **WC publics**, avec règles de prudence.  
> - **GO** pour préparer **2 à 3** jeux open data **simples** après **validation métier** (et cadrage juridique **léger** si nécessaire).  
> - **NO GO** pour publier les **travaux bruts** (ni pièces jointes associées en canal grand public).  
> - **NO GO** pour connecter un **compte SIG authentifié** directement à un **LLM**.  
> - **V1.1 recommandée (hypothèse)** : préparer un mode **restricted**, **désactivé par défaut**, **sans** promesse de branchement immédiat au portail SIG nominatif — cf. `04_architecture_restricted_sig_authentifie.md`.

**Objet** : arbitrage pour usages **public** (open data, chatbot citoyen après validation), **internal** (agents, DSI, DGS, tableaux de bord) et perspective **restricted** (hypothèse V1.1, sans implémentation immédiate).

**Référence technique** : mesures MCP annecy-sig **v1.0.0-rc.1** en **mode standard** (`fast: false`, `sampleLimit: 50`) — **diagnostic indicatif** sur échantillon, **non** substitut d’un audit métier exhaustif. Veille **data.gouv** (catalogue officiel, mai 2026).

---

## Décision proposée (détail)

1. **Exploitation immédiate** : MCP en mode **public** pour **priorisation** et **pilotage qualité** ; **chatbot citoyen** limité au périmètre **WC publics**, avec règles de prudence (horaires / PMR **non inventés** si absents sur la réponse SIG).
  **data.gouv** apporte des **sources officielles complémentaires** (transport structuré, risques, adresses, référentiels nationaux) : elles **complètent** le SIG local mais **ne le substituent** pas pour la donnée d’exploitation communale.
2. **Open data** : le brief public indique **0 VERT / 26 ORANGE** — il s’agit d’une **classification prudente** automatique : **aucune** couche n’est étiquetée « publiable immédiatement » **sans** revue. Cela **n’implique pas** qu’« rien » soit publiable : **plusieurs** jeux **ORANGE** peuvent l’être **après validation métier** et, le cas échéant, **cadre juridique léger** (licence, champs, agrégation).
3. **Travaux** : **internal** uniquement pour la donnée détaillée ; **do_not_publish** en **brut** ; indicateurs **agrégés** éventuels **après** revue juridique, **sans** exposition de documents joints ni de données nominatives.
4. **Compte SIG authentifié (futur)** : **ne pas** brancher un LLM sur l’intégralité du SIG. Une **hypothèse V1.1** : mode **restricted**, **désactivé par défaut**, allowlist **sans wildcard**, lecture **contrôlée**, **redaction**, journaux d’audit, quotas — **sans** engagement de calendrier ni de connexion nominative tant que la DSI n’a pas validé l’architecture.

---

## Bénéfices


| Levier           | Bénéfice                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP **public**   | Accès **contrôlé** et **réplicable** au portail SIG (équipements, mobilité) pour inventaires, briefs open data, readiness chatbot.                                                                                  |
| MCP **internal** | Tableaux de bord travaux et inventaire (**28** couches sur la mesure réalisée) sans dépendre d’exports manuels non tracés.                                                                                          |
| **data.gouv**    | **Catalogue national** (transport, risques, adresses, entreprises) **déjà publié** ; utile en **veille** et en **réutilisation** sans solliciter le SIG pour ces référentiels — **en complément** du SIG municipal. |


---

## Risques principaux

- **Heuristique** : scores et tiers reposent sur un **échantillon ArcGIS** (ici jusqu’à **50** entités / couche) — **indicatif de tendance** pour la DSI / DGS ; **pas** suffisant seul pour trancher une ligne sensible ou un contentieux.
- **Mobilité** : sur le brief et les plans d’action exploités, **désalignement** possible registre sémantique ↔ champs réels sur `mobilite/10` et `mobilite/16` ; **géométrie non renvoyée** sur l’échantillon parking — **risque réputationnel** si un chatbot « près de moi » répond sans cadrage.
- **Travaux** : champs sensibles (ex. liens vers documents en base) — **fuite** si exposés hors périmètre sécurisé ; qualité géographique / adresse **à confirmer côté métier** (le brief **internal** au 2026-04-30 signalait des lacunes **sur le périmètre filtré**, pas une vérité exhaustive sur toute la base).
- **SIRENE** : répertoire **public** ; en revanche un **usage conversationnel** ou des **croisements** avec d’autres jeux impliquent **finalité**, **image** et **RGPD** — à cadrer avant tout canal grand public.

---

## Roadmap synthétique


| Horizon  | Actions                                                                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **30 j** | Valider **MVP chatbot** (WC) + glossaire réponses ; lancer **sprint mapping** mobilité (champs réels vs registre) ; cartographier **doublons** SIG ↔ jeux Ville / Grand Annecy sur data.gouv.                           |
| **60 j** | **Packages open data** pour 2–3 familles ORANGE « les plus simples » après validation ; **dashboard** travaux (KPI, pas de documents joints en sortie MCP) ; rattachement **GTFS/GBFS** à l’offre info voyageurs.       |
| **90 j** | **Cadre juridique travaux** (agrégats publics éventuels) ; **spec V1.1** mode **restricted** (allowlist, audit, quotas) — **sans** connexion SIG utilisateur dans le MCP tant que la DSI n’a pas validé l’architecture. |


---

*Document produit à partir des outils MCP annecy-sig et du catalogue data.gouv — aucune donnée nominative ni lien vers document joint.*