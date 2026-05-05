# Prompts Cursor — annecy-sig-mcp

Catalogue de prompts copier-coller pour explorer le SIG Annecy via le serveur
MCP. Pour la **recette terrain** officielle (6 prompts à dérouler avant un
tag), voir `docs/RECETTE_TERRAIN.md`.

## Assistant citoyen V1.2 — `citizen_query` (recommandé)

Outil haut-niveau qui choisit la couche tout seul, refuse les questions hors
périmètre (RGPD, données nominatives) et répond en français sans jamais
demander `serviceKey`/`layerId`. **Premier réflexe** pour toute question
citoyenne.

```txt
citizen_query : Quelles sont les toilettes publiques les plus proches de
l'Hôtel de Ville d'Annecy ?
```

```txt
citizen_query : Où puis-je charger ma voiture électrique près du centre-ville
d'Annecy ?
```

```txt
citizen_query : Je cherche une place PMR près du Pâquier, tu peux m'aider ?
```

```txt
citizen_query : Y a-t-il des travaux près de Bonlieu ?
```

```txt
citizen_query : Où garer mon vélo près de la gare d'Annecy ?
```

```txt
citizen_query : Peux-tu me donner les coordonnées personnelles des agents
municipaux liés aux travaux ?
```

> Le dernier prompt doit retourner `status: "out_of_scope"` avec un message
> sobre renvoyant vers les canaux officiels — c'est le test RGPD du patch
> V1.2.1.

## Public — découverte

```txt
Liste les couches SIG publiques disponibles et dis-moi lesquelles sont les
plus utiles pour un chatbot citoyen.
```

```txt
describe_layer pour equipements couche 5 en public : champs exposés et
alignement registre.
```

```txt
query_layer : WC publics ouverts dans la limite de 20 résultats, mode public.
```

```txt
Trouve les WC publics ouverts et accessibles PMR dans un rayon de 500 mètres
autour de l'Hôtel de Ville d'Annecy.
```

```txt
count_layer pour la couche WC publics avec le filtre ouvert = 'Oui'.
```

## Internal — pilotage

```txt
inventory_all_layers en mode internal, sampleLimit=15, concurrency=4.
```

```txt
list_late_works avec limite 50 et résume les retards sans pièces jointes.
```

```txt
generate_internal_dashboard_brief en mode=internal pour la date du jour,
format markdown.
```

```txt
Liste les travaux en cours au 30 avril 2026 et signale ceux sans adresse ou
sans géométrie.
```

## Chatbot citoyen

```txt
generate_chatbot_readiness_report public, markdown : quelles couches sont
ready ?
```

```txt
Compare chatbot equipements/5 et mobilite/10 via generate_layer_action_plan
en public.
```

```txt
Liste les règles prudentes du rapport chatbot pour les réponses citoyennes.
```

## Open data / DGS

```txt
recommend_open_data_candidates en public puis synthèse des VERT.
```

```txt
generate_open_data_brief public json avec writeOutput=true.
```

```txt
generate_inventory_report internal markdown pour réunion DGS, fast=true pour
un aperçu rapide.
```

```txt
Quels jeux de données seraient les meilleurs candidats pour une publication
open data rapide ?
```

```txt
Génère un brief open data public et liste les candidats publiables rapidement.
```

```txt
Utilise generate_layer_action_plan sur travaux/3 en internal et explique
pourquoi ce n'est pas une couche open data brute.
```

## Qualité données

```txt
Analyse la qualité de la couche stationnement vélos et indique les champs
trop souvent vides.
```

```txt
detect_data_quality_issues sur equipements/5 en public, sample 20.
```

```txt
Lance inventory_all_layers en mode internal et résume les 5 couches avec le
score le plus bas.
```

## Règles de prudence

- Le MCP **ne remplace pas** l'arbitrage métier ou juridique sur l'open data.
- **Open data ORANGE** = à valider humainement avant diffusion.
- **Travaux en internal** : ne pas republier brutalement vers le grand
  public ; pas de pièces jointes dans les briefs.
- **Absence d'un champ** dans l'échantillon **ne prouve pas** l'absence de la
  donnée métier en base.
- **Échantillon ≠ vérité exhaustive** ; les scores sont indicatifs (surtout
  en `fast=true`).
