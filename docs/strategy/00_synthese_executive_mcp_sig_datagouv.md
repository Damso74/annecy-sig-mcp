# Synthèse exécutive — MCP annecy-sig et complément data.gouv

## Contexte

Le projet **annecy-sig-mcp** (RC **v1.0.0-rc.1**) expose, sous contrôle, des couches du portail SIG d’Annecy en modes **public** et **internal**. Des mesures en **mode standard** (`sampleLimit` 50) ont produit des briefs « open data », « chatbot citoyen », inventaire **internal** et plans d’action par couche. **data.gouv** recense des jeux nationaux et territoriaux (transport, risques, adresses, etc.) **complémentaires** du SIG local.

## Décision proposée

- **GO** : utiliser le **MCP annecy-sig** en **diagnostic interne** (qualité, arbitrage, briefs).
- **GO** : **MVP chatbot citoyen** limité aux **WC publics**, avec règles de prudence et qualification des sources.
- **GO** : préparer **2 à 3** publications open data **simples** après **validation métier** et, si besoin, **cadre juridique léger** — la classification « 0 VERT / N ORANGE » du MCP est **prudente**, pas une interdiction absolue de tout ouvrir.
- **NO GO** : publier les **travaux** en **brut** ou avec pièces jointes exposées.
- **NO GO** : connecter un **compte SIG authentifié** directement à un **LLM** sans passerelle, allowlist et garde-fous.
- **V1.1 (hypothèse)** : documenter un mode **restricted**, **désactivé par défaut**, sans engagement de mise en production immédiate.

## Valeur immédiate

Priorisation data, **diagnostic indicatif** (échantillon 50 entités par couche — **pas** un audit exhaustif ligne à ligne), réutilisation de **référentiels** déjà sur **data.gouv** (ex. transport structuré, adresses nationales) **en parallèle** du SIG — **sans** les confondre avec la donnée municipale opérationnelle.

## Risques

Interprétation trop **large** des scores MCP ; chatbot **mobilité** avant correction mapping / géométrie ; **SIRENE** : données **ouvertes** mais **croisement conversationnel** à **finaliser** (RGPD, image) ; **travaux** : sensibilité et champs à **ne jamais** exposer en public.

## Roadmap 30 / 60 / 90 jours


| 30 j                                                                                   | 60 j                                                                                                                 | 90 j                                                                                                        |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| MVP WC + glossaire ; sprint mapping mobilité prioritaire ; liste cible 2–3 jeux ORANGE | Packages open data validés ; lien GTFS/GBFS dans l’offre info voyageurs ; qualité air / stations si périmètre défini | Travaux : agrégats publics seulement après avis ; **spec** mode restricted (sans branchement SIG nominatif) |


## Message clé en réunion

*Nous utilisons le MCP annecy-sig pour **cadrer** l’open data et le chatbot ; **data.gouv** **complète** le SIG mais ne le **remplace** pas ; nous **n’ouvrons** pas les travaux en brut et nous **ne branchons** pas le SIG authentifié sur un LLM sans architecture V1.1.*