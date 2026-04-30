# Plan chatbot citoyen — périmètre MVP (Annecy)

**Base factuelle** : `generate_chatbot_readiness_report` (mode **public**, `fast: false`, `sampleLimit: 50`, `serverVersion` **1.0.0-rc.1**). Sur les **12** couches ciblées par cet outil : **0** « ready », **1** `usableNow`, **6** `usableWithCaution`, **5** `notReady` — résultat **indicatif** sur le périmètre et l’échantillon du brief, **non** une garantie sur l’ensemble des enregistrements.

---

## Périmètre MVP recommandé

- **Inclus** : **WC publics** (`equipements/5`) uniquement, avec réponses **strictement** fondées sur les champs renvoyés et **renvoi** vers le site officiel pour toute donnée à fort impact (PMR, horaires).
- **Hors MVP** : mobilité « près de moi » dans le SIG (parking, PMR, vélos, stations Vélonecy) — **not_ready** ou **needs_field_mapping** **sur les mesures** — sauf **redirection** vers **data.gouv** (GTFS / GBFS) en rappelant qu’il s’agit de **sources producteurs** distinctes du chatbot municipal si besoin.

---

## Questions autorisées (MVP)

| Type | Exemple | Règle |
|------|---------|--------|
| Localisation sanitaires | « Où sont les toilettes publics près de [lieu] ? » | Réponse à partir du **SIG** (carte ou liste) ; **ne pas** garantir l’état « ouvert » sans information **présente et explicite** dans la réponse. |
| Accessibilité | « Y a-t-il des WC avec mention PMR dans les données ? » | Utiliser uniquement le champ concerné s’il est renseigné ; sinon **« donnée non renseignée »**. |

---

## Questions refusées ou détournées (MVP)

| Type | Exemple | Motif |
|------|---------|--------|
| Stationnement / disponibilité | « Où me garer maintenant ? » | Couches **non prêtes** sur le brief ; risque d’**hallucination** et réputationnel. |
| Sectorisation scolaire | « Dans quelle école inscrire mon enfant selon mon adresse ? » | **Ne pas inférer** depuis la géolocalisation seule — renvoi **service instruction**. |
| Travaux / dossiers | « Que contient le dossier de l’autorisation X ? » | Données **internal** ; **pas** de documents joints via le chatbot ; pas de canal grand public. |
| SIRENE / adresse | « Qui habite ou travaille à cette adresse ? » | Répertoire public, mais **croisement conversationnel** hors périmètre sans cadre juridique et de finalité. |

---

## Règles de réponse prudente (à intégrer au prompt système)

1. **Qualifier la source** : « Selon les données publiées par la Ville d’Annecy (SIG), à la date de … ».
2. **Absence de donnée** : répondre explicitement que l’information **n’est pas disponible dans les données utilisées** — **ne pas** combler par inférence.
3. **Horaires** : si le champ est vide ou ambigu — **ne pas** inventer ; proposer le **site municipal** ou un **contact public** lorsque la donnée l’autorise.
4. **Transport** : pour horaires à jour, **orienter** vers les flux **officiels** (ex. jeux **data.gouv** producteurs) en indiquant la **date de mise à jour** lorsqu’elle est connue.
5. **Jamais** de lien vers espace **internal** ni de document joint non validé pour le canal grand public.

---

## Données utilisables **maintenant** (MVP)

- **SIG public** : couche **WC publics** (meilleure maturité **relative** parmi les couches analysées par le brief chatbot).
- **data.gouv** : **GTFS Sibra**, **GBFS Vélonecy** pour information voyageur **générique**, avec distinction claire producteur / municipal si utile.

---

## Données à **nettoyer** avant élargissement du chatbot

| Couche / sujet | Problème observé **sur les mesures MCP** | Action |
|----------------|------------------------------------------|--------|
| `mobilite/10` Stationnement vélos | `needs_field_mapping` ; alignement registre / service | Aligner registre / ArcGIS ; compléter libellés |
| `mobilite/16` Annecy Parking | Géométrie manquante **sur l’échantillon** ; mapping incomplet | Corriger export / géom + champs affichage |
| Écoles, culture, sport | Libellés / catégories souvent absents **sur l’échantillon** | Complétude + glossaire (hors échantillon) |
| Bornes recharge | Catégorie souvent absente **sur l’échantillon** | Compléter attributs « usager » |

---

## Prompt système minimal du chatbot citoyen

- **Ne jamais inventer** une donnée absente des champs renvoyés par le connecteur ou de la réponse autorisée.  
- **Toujours qualifier la source** (SIG municipal vs flux national / producteur) et rappeler que la réponse est **indicative**, non contractuelle.  
- **Ne jamais garantir** un horaire, une disponibilité de place ou une sectorisation si le champ ou le service compétent **ne le permettent** pas.  
- **Refuser** les questions sur les **travaux détaillés**, les **documents de dossier**, les **identifiants internes** ou tout contenu **internal**.  
- **Rediriger** vers les **canaux officiels** (site, numéros publics, services) lorsque la donnée n’est pas disponible ou hors périmètre.

---

*Document stratégique — aucune donnée personnelle ni information confidentielle.*
