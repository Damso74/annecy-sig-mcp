# Architecture cible — mode `restricted` et SIG authentifié (hypothèse V1.1)

**Contexte** : après authentification sur un **portail SIG** (extranet / agent), des couches, champs ou documents peuvent être visibles **hors** périmètre **public** du site citoyen. Ce document décrit une **hypothèse d’architecture** pour une **V1.1** — **sans** engagement de mise en œuvre immédiate, **sans** OAuth direct vers un LLM et **sans** exposition globale du SIG.

## Vocabulaire (rappel)

- **public** : canal citoyen / open data après validation.  
- **internal** : agents / DSI / DGS.  
- **restricted** : accès authentifié, **désactivé par défaut**, allowlist **dédiée** (hors RC actuelle).  
- **do_not_publish** : jamais publié en brut sur les canaux open data.

---

## 1. Données potentiellement concernées après authentification SIG

- Couches **non publiées** sur le site grand public (travaux détaillés, dossiers, annotations de service).
- Champs métier : identifiants de dossier, statuts de workflow, **commentaires de service**, traces d’édition, **références vers documents** (plans, courriers) — **à traiter hors canal LLM** ou via flux GED dédiés.
- Vues filtrées par **rôle** (urbanisme, voirie, environnement).

*Liste **non exhaustive**, dépendante du paramétrage du portail.*

---

## 2. Risques nouveaux

| Risque | Description |
|--------|-------------|
| **Fuite par le LLM** | Reformulation qui **réinjecte** noms, adresses, **personnes**, ou **inférences** (« probablement le même demandeur … »). |
| **Exfiltration par outil** | Connecteur qui renvoie des champs **non prévus** ou des **URL signées** vers des documents. |
| **Corrélations** | Croisement SIG + autres sources → **ré-identification**. |
| **Absence de traçabilité** | Pas de journal : **impossibilité** d’auditer les accès. |

---

## 3. Pourquoi ne pas brancher un compte SIG « complet » sur un LLM

- Les LLM **ne garantissent pas** la confidentialité des entrées ; les journaux tiers peuvent échapper au contrôle territorial.
- Accès **non borné** en langage naturel = **surface d’attaque** (injection de prompt, exfiltration progressive).
- Les **documents de dossier** et champs de **traçabilité éditeur** ne relèvent pas d’un **chat générique** : ils passent par la **GED** et des workflows **humains**.

---

## 4. Architecture recommandée (progressive, auditable)

| Composant | Rôle |
|-----------|------|
| **public** | Données déjà sur le site / flux autorisés en allowlist actuelle. |
| **internal** | Réseau agents — pas de canal grand public ; journaux côté serveur MCP. |
| **restricted** | **Désactivé par défaut** ; activation **DSI** + bilan **DPIA** ciblé si un jour activé. |
| **Allowlist `restricted` dédiée** | Liste **explicite** `(serviceKey, layerId, champs autorisés, plafond d’enregistrements)` — **pas de wildcard**, **pas** de requête SQL libre. |
| **Scopes** | Rôles métier mappés vers des **vues** ou endpoints **pré-filtrés**. |
| **Redaction** | Couche travaux : masquer tout **lien vers document**, **personnes physiques**, **noms de service** si non nécessaires, champs de **traçabilité éditeur** ; **ne pas** suivre de redirection vers stockage brut. |
| **Audit logs** | Qui, quand, quel outil, empreinte de requête, volume retourné, refus. |
| **Approbation** | Nouvelle entrée d’allowlist **restricted** : **quatre-yeux** (métier + DSI). |
| **Rate limits** | Par utilisateur et par organisation ; plafond d’entités par appel. |
| **Identifiants d’accès** | **Aucun** identifiant portail dans le dépôt ni dans l’IDE ; coffre dédié, rotation, comptes techniques **par périmètre** si possible. |

**Flux cible** : agent **humain** authentifié → **passerelle interne** qui projette uniquement les champs allowlistés → MCP **restricted** en **lecture seule** → LLM **sans** écriture vers le SIG.

---

## 5. Outils MCP `restricted` potentiellement acceptables

- `describe_layer` sur une couche **inscrite** en allowlist **restricted**, avec schéma **redacté**.
- `count_layer` / statistiques **agrégées** (histogrammes par statut, sans géométrie fine).
- `generate_internal_dashboard_brief` — principe **sans documents joints** en sortie, modèle pour d’autres briefs à faible cardinalité.

---

## 6. Outils ou capacités à refuser pour un LLM

- `query_layer` **sans** liste blanche de filtres prédéfinis.
- Export **géométrie + identité** sans **anonymisation**.
- Écriture, **upload**, **lien de partage** vers l’extérieur.
- **Résolution** ou **suivi** de liens vers des **documents** non scannés.

---

## 7. Exigences anti-fuite

| Menace | Mesure |
|--------|--------|
| **Documents** | Ne **jamais** renvoyer d’URL ; indicateur « document présent » **uniquement** côté back-office si besoin. |
| **Noms de personnes ou d’agents** | Liste de champs **interdits** par défaut ; refus si champ non allowlisté. |
| **Demandeurs / tiers** | Champs **personnes** exclus par défaut ; DPIA si usage métier avéré. |
| **Traçabilité éditeur** | Champs type **création / dernière modification par** — **hors** schéma MCP **restricted** (à filtrer en amont). |
| **Inférence** | Ne pas exposer plusieurs jeux corrélables dans la **même** session sans traitement **hors** LLM (ex. k-anonymat). |
| **Export massif** | Pagination stricte ; alerte et blocage au-delà d’un seuil. |

---

## 8. Pistes V1.1 (préparation **sans** connexion SIG utilisateur dans le MCP)

1. Documenter le mode **restricted** et une variable du type `RESTRICTED_ENABLED` — **false** par défaut.  
2. **Registre** ou fichier d’allowlist **restricted** **séparé** du registre public / internal, versionné, revu juridiquement.  
3. **Proxy** de **redaction** + schéma fixe avant réponse MCP (futur).  
4. **Tests** de non-régression sur payloads (futur).  
5. Atelier métier : **peu** de cas **restricted** à forte valeur (ex. agrégats travaux), **sans** documents joints.

---

## Ce qui est interdit (rappel)

- OAuth « grand public » puis **tout** le catalogue SIG.
- Wildcard sur couches ou champs.
- Requête **libre** sur le SIG authentifié.
- Téléchargement ou **proxy** de **documents de dossier** vers le LLM.
- Champ texte **libre** non passé par **redaction** et validation de schéma.

---

## Backlog V1.1 recommandé

- `RESTRICTED_ENABLED=false` (ou équivalent) **par défaut**.  
- **Registre** `restricted` **séparé** de l’allowlist actuelle.  
- **Contrats** (ex. schémas **Zod**) **spécifiques** au périmètre **restricted**, distincts du **public**.  
- **Audit logs** (qui / quoi / quand / volume / refus).  
- **Quotas** et plafonds d’enregistrements.  
- **Tests anti-fuite** sur les réponses JSON.  
- **Proxy de redaction** en amont du modèle.  
- **Zéro** document joint dans le flux LLM.  
- **Validation DSI + avis juridique** avant toute activation du mode **restricted**.

---

*Document d’intention — hypothèse V1.1 ; la RC actuelle ne met pas en œuvre ce mode.*
