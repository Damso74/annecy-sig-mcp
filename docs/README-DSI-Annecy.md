# Onboarding DSI — annecy-sig-mcp

> Public visé : **Direction des Systèmes d'Information de la Ville d'Annecy**.
> Objectif : être opérationnel sur le MCP SIG Annecy en **moins de 15 minutes**,
> que ce soit en consommation publique distante ou en usage interne local.

---

## Synthèse en une page

| Aspect | Valeur |
| --- | --- |
| Nature | Serveur MCP (Model Context Protocol) lecture seule sur ArcGIS REST |
| Source SIG | `portailsig.annecy.fr/server/rest/services` (allowlist) |
| Couches couvertes | **28** (équipements 11 · mobilité 16 · travaux 1 vue citoyenne) |
| Outils MCP | **16 publics** + **3 internal** (DSI uniquement, jamais en HTTP) |
| Transport public | HTTPS · Vercel · `https://mcp.leadalpes.fr/api/mcp` (Bearer requis) |
| Transport interne DSI | stdio local · `node dist/index.js` · `DEFAULT_MODE=internal` |
| Sécurité | Allowlist + Bearer + sanitation + jamais d'écriture vers ArcGIS |
| Code source | <https://github.com/Damso74/annecy-sig-mcp> · MIT |
| Healthcheck | <https://mcp.leadalpes.fr/api/health> |

---

## 1. Choisir son mode d'accès

| Profil utilisateur DSI | Mode recommandé | Transport | Champ d'usage |
| --- | --- | --- | --- |
| Agent métier qui demande à un assistant IA des infos publiques | **Remote public** | HTTPS Bearer | Recherche citoyenne, support, communication |
| Agent SIG / DSI qui doit voir tous les champs ArcGIS non sensibles | **Local internal** | stdio | Reporting interne, qualité de la donnée, gouvernance |
| Pipeline CI / script automatisé (lecture catalogue) | Remote public | HTTPS Bearer | Inventaire, monitoring couches |

> Le mode `internal` est **techniquement refusé** sur le transport HTTP public. Il
> n'est accessible qu'en stdio local sur poste DSI configuré.

---

## 2. Profil A — Cursor branché sur le serveur public distant (5 min)

C'est la voie la plus rapide. Aucune installation locale, aucun build.

### Étape 1 — récupérer le jeton Bearer public

Demander à l'opérateur du serveur (`<contact ops>`) le jeton
`MCP_PUBLIC_READ_TOKEN`. Le stocker dans un gestionnaire de secrets DSI ou en
variable d'environnement utilisateur. **Ne jamais committer.**

### Étape 2 — éditer `~/.cursor/mcp.json` (ou `.cursor/mcp.json` au projet)

```json
{
  "mcpServers": {
    "annecy-sig-remote": {
      "url": "https://mcp.leadalpes.fr/api/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_PUBLIC_READ_TOKEN}"
      }
    }
  }
}
```

### Étape 3 — activer dans Cursor

`Cursor → Settings → MCP` : activer `annecy-sig-remote`. La pastille doit
passer au vert et indiquer **16 outils** disponibles.

### Étape 4 — tester

Demander à l'assistant :

```
Liste les bornes de recharge véhicules électriques d'Annecy.
```

L'assistant doit appeler `query_layer` ou `search_nearby` sur la couche
`mobilite/9` et retourner une liste géolocalisée.

---

## 3. Profil B — Mode interne local DSI (10 min)

À utiliser pour exposer **tous les champs internes** non sensibles (champs
ArcGIS additionnels exposés en plus du `publicFields`) — par exemple pour des
travaux de qualité de la donnée, reporting interne ou audit.

### Pré-requis

- Node.js ≥ 20.
- Accès en lecture au dépôt GitHub (clone HTTPS suffit).
- Réseau autorisant les appels sortants vers `portailsig.annecy.fr`.

### Étape 1 — installation

```bash
git clone https://github.com/Damso74/annecy-sig-mcp.git
cd annecy-sig-mcp
npm ci
npm run build
```

### Étape 2 — configurer Cursor en stdio internal

Éditer `~/.cursor/mcp.json` (Windows : `%USERPROFILE%\.cursor\mcp.json`) :

```json
{
  "mcpServers": {
    "annecy-sig": {
      "command": "node",
      "args": [
        "C:/chemin/absolu/vers/annecy-sig-mcp/dist/index.js"
      ],
      "env": {
        "ANNECY_SIG_BASE_URL": "https://portailsig.annecy.fr/server/rest/services",
        "DEFAULT_MODE": "internal",
        "CONTRACT_POLICY": "warn"
      }
    }
  }
}
```

> ⚠️ Adapter le chemin vers `dist/index.js` (séparateur `/` accepté sous
> Windows). En cas de modif du code source, refaire `npm run build` et
> reconnecter le MCP dans Cursor (toggle off/on dans Settings → MCP).

### Étape 3 — vérifier le mode actif

Dans Cursor, demander :

```
Liste les services SIG Annecy disponibles.
```

L'outil `list_services` doit retourner `mode: "internal"` dans le champ
`source.runtime.mode`. Si vous voyez `"public"`, le `DEFAULT_MODE=internal`
n'a pas été pris en compte (binaire mal rebuild ou Cursor mal reconnecté —
voir section 6 *Dépannage*).

### Étape 4 — tester un outil internal-only

```
Liste les travaux en cours sur Annecy via list_current_works.
```

Cet outil n'est **pas** exposé en HTTP public ; il ne fonctionne que dans ce
profil local.

---

## 4. Surface MCP exposée

| Catégorie | Outils publics (HTTP + stdio) | Outils internal (stdio uniquement) |
| --- | --- | --- |
| Catalogue | `list_services`, `list_layers`, `describe_layer`, `recommend_layers_for_intent` | — |
| Requêtes | `query_layer`, `search_nearby`, `count_layer`, `detect_data_quality_issues` | — |
| Travaux | `list_public_works`, `search_public_works_nearby` | `list_current_works`, `list_late_works` |
| Inventaires & rapports | `inventory_all_layers`, `recommend_open_data_candidates`, `generate_inventory_report`, `generate_open_data_brief`, `generate_chatbot_readiness_report`, `generate_layer_action_plan` | `generate_internal_dashboard_brief` |

Schémas Zod stables (`schemaVersion: "*.v1"`) pour tous les outils
`generate_*` — exportables via `npm run schemas` puis `dist/contracts/*.json`.

---

## 5. Couches du registre

| Service | ID | Couches couvertes |
| --- | --- | --- |
| `equipements` | 0–10 | Administration, scolaires, crèches, séniors, cimetière, WC, culture, jardins, vergers, sport, salles |
| `mobilite` | 1–16 | Horodateurs, parkings (relais, hôtel, livraison, moto, PMR), vélonecy, BRVE, parking convoyeurs, parkings ouvrage, zones bleues |
| `travaux` | 3 | Vue **public-light** uniquement — IDs opaques, géométrie réduite |

Contenu détaillé : [`docs/DATA_CATALOG_PUBLIC_REMOTE.md`](DATA_CATALOG_PUBLIC_REMOTE.md).

---

## 6. Dépannage opérationnel

### « Cursor ne montre que 16 outils alors que je suis en local internal »

C'est attendu : le filtre internal n'expose que les **3 outils internal** en
plus, soit **19 outils** au total. Si vous en voyez **16**, le `DEFAULT_MODE`
n'a pas été appliqué :

1. Tuer tous les processus `node` zombies (Cursor laisse parfois des MCP en vie) :
   ```powershell
   Get-Process node | Stop-Process -Force
   ```
2. Vérifier que `dist/index.js` a bien été rebuild après pull (`npm run build`).
3. Reconnecter le MCP : `Cursor → Settings → MCP` → toggle `annecy-sig` off
   puis on.

### « `query_layer` retourne `ARCGIS_ERROR` 400 »

Causes typiques :

- Champ `outFields` non présent dans le schéma ArcGIS : depuis V1.0 ce cas
  est filtré automatiquement (`resolveArcgisOutFields`). Si vous le voyez,
  ouvrir une issue.
- `where` invalide côté ArcGIS : tester d'abord avec `where: "1=1"`.
- Service indisponible côté SIG : vérifier `https://portailsig.annecy.fr/`.

### « Le jeton Bearer est refusé sur le remote »

Vérifier :

```bash
curl -H "Authorization: Bearer $TOKEN" https://mcp.leadalpes.fr/api/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2024-11-05" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Si 401 → jeton expiré ou faux. Si 403 → vous tentez `mode: "internal"` sur
HTTP, ce qui est interdit par design.

### Maintenance du registre (drift ArcGIS)

Le registre des couches et de leurs champs est synchronisé chaque jour
automatiquement par GitHub Actions (cron `check:registry`). En cas de drift
(le SIG ajoute un champ, change un nom), la CI échoue et notifie. Pour
régénérer manuellement :

```bash
npm run sync:registry
git diff src/registry.fields.generated.ts
git commit -am "chore: sync registry from ArcGIS"
```

---

## 7. Procédure de divulgation responsable

Tout problème de sécurité (fuite de données, élévation de privilèges,
contournement de l'allowlist) doit être signalé via le canal défini dans
[`docs/SECURITY.md`](SECURITY.md). **Ne pas ouvrir d'issue publique.**

---

## 8. Contacts & ressources

- **Page d'accueil publique** : <https://mcp.leadalpes.fr/>
- **Healthcheck** : <https://mcp.leadalpes.fr/api/health>
- **Code source** : <https://github.com/Damso74/annecy-sig-mcp>
- **Documentation complète** : [`README.md`](../README.md)
- **Catalogue de données** : [`docs/DATA_CATALOG_PUBLIC_REMOTE.md`](DATA_CATALOG_PUBLIC_REMOTE.md)
- **Sécurité** : [`docs/SECURITY.md`](SECURITY.md)
- **Contrats techniques** : [`docs/TECHNICAL_CONTRACTS.md`](TECHNICAL_CONTRACTS.md)
- **Recette terrain** : [`docs/RECETTE_TERRAIN.md`](RECETTE_TERRAIN.md)

---

*Document maintenu par l'équipe annecy-sig-mcp · MIT · usage DSI Annecy.*
