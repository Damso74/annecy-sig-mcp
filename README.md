# annecy-sig-mcp

> **Prototype MCP open source pour interroger les données SIG publiques d'Annecy en langage naturel.**

> ⚠️ **Service expérimental.** Données publiques **indicatives, non opposables**.
> Pour toute démarche officielle, se référer aux canaux de la Ville d'Annecy.

Serveur **MCP** (Model Context Protocol) en TypeScript, **lecture seule**, qui
expose les couches ArcGIS REST du portail SIG de la Ville d'Annecy
(`portailsig.annecy.fr`) à un assistant IA — Cursor, Claude Desktop, Continue,
n8n, ChatGPT MCP, agent custom…

- **28 couches** allowlistées : équipements (11), mobilité (16), travaux (1 vue citoyenne)
- **17 outils MCP publics** + 3 outils internal réservés DSI (V1.2 : ajout de `citizen_query`)
- **Allowlist stricte** d'hôtes et de couches, sanitation systématique des champs sensibles
- **Lecture seule absolue** : pas une seule route POST/PUT/DELETE vers ArcGIS dans ce code
- **Endpoint de démonstration** sur <https://mcp.leadalpes.fr> (HTTPS, Bearer, public-only, rate-limité)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)]()
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-0b5fff)](https://modelcontextprotocol.io/)

---

## Vous voulez juste **utiliser** le MCP ?

C'est par ici, pas besoin de cloner le dépôt :

| Profil | Où aller |
| --- | --- |
| **Citoyen, développeur, autre collectivité** qui veut interroger le SIG depuis son IA | [**mcp.leadalpes.fr**](https://mcp.leadalpes.fr/) — landing publique avec démarrage en 3 étapes |
| **DSI / agent Ville d'Annecy** qui veut le mode internal local | [**docs/README-DSI-Annecy.md**](docs/README-DSI-Annecy.md) — onboarding 15 min |
| **Développeurs** qui veulent comprendre le code, contribuer ou héberger une instance | Suite de ce README |

---

## 1. Architecture en 60 secondes

```
┌──────────────────┐     MCP HTTP/stdio     ┌────────────────────┐     HTTPS     ┌─────────────────────┐
│  Client MCP      │ ─────────────────────▶ │  annecy-sig-mcp    │ ───────────▶  │  portailsig.annecy   │
│  (Cursor, etc.)  │ ◀───────────────────── │  (ce serveur)      │ ◀───────────  │  ArcGIS REST         │
└──────────────────┘    JSON structuré      └────────────────────┘   f=pjson     └─────────────────────┘
                                                    │
                                                    ▼
                                            ┌────────────────────┐
                                            │  Allowlist + Zod   │
                                            │  + sanitation      │
                                            └────────────────────┘
```

- **Transport HTTP** (`api/mcp.ts`, `api/health.ts`) : runtime Vercel, public-only, Bearer obligatoire.
- **Transport stdio** (`src/index.ts`) : usage local DSI avec mode `internal` activable.
- **Cœur partagé** (`src/server.ts`, `src/tools/*`, `src/registry.ts`) : 100 % du code métier.

Le registre (`src/registry.ts`) est **autoritaire** sur ce qui est exposé. Il
est tenu à jour par le script `scripts/sync-registry-from-arcgis.ts`
(synchronisation des champs depuis `f=pjson` ArcGIS) et vérifié quotidiennement
en CI (cron `check:registry`).

## 2. Installation locale

```bash
git clone https://github.com/Damso74/annecy-sig-mcp.git
cd annecy-sig-mcp
npm ci
cp .env.example .env   # ajuster ANNECY_SIG_BASE_URL et DEFAULT_MODE si besoin
npm run build
```

Pré-requis : **Node.js ≥ 20**.

## 3. Configuration MCP (stdio local)

Voir le modèle prêt à coller : [`examples/cursor-mcp-config.json`](examples/cursor-mcp-config.json) (Windows + macOS/Linux).

Variables d'environnement minimales :

```env
ANNECY_SIG_BASE_URL=https://portailsig.annecy.fr/server/rest/services
DEFAULT_MODE=public         # ou "internal" pour DSI
CONTRACT_POLICY=warn        # "strict" en CI/dev, "silent" pour les benchs
```

> **Attention.** Le serveur communique en **stdio**. **Ne pas brancher d'autre logger sur stdout** :
> le transport MCP s'en sert pour le protocole. Tous les logs vont sur **stderr**
> au format NDJSON.

## 4. Commandes utiles

```bash
npm run build           # tsc → dist/
npm run start           # lance dist/index.js (stdio MCP)
npm test                # vitest (offline, fixtures sous tests/fixtures/arcgis/)
npm run smoke:mcp       # smoke stdio : démarre dist/index.js, vérifie tools + stdout silencieux
npm run smoke:http      # smoke HTTP local : auth, refus internal, périmètre 16 outils
npm run sync:registry   # régénère registry.fields.generated.ts depuis ArcGIS LIVE
npm run check:registry  # vérifie le drift registre ↔ ArcGIS LIVE (CI cron quotidien)
npm run schemas         # régénère schemas/*.schema.json
npm run schemas:check   # vérifie que les schemas versionnés sont à jour
```

Sur Windows (PowerShell) : `$env:RUN_NETWORK_TESTS="true"; npm test` pour
activer les tests réseau (désactivés par défaut).

## 5. Sécurité — les 8 garde-fous

1. **Lecture seule** : aucun `POST` / `applyEdits` / token éditeur dans ce dépôt.
2. **Allowlist d'hôte** : seules les URLs sous `ANNECY_SIG_BASE_URL` sont acceptées.
3. **Allowlist de couches** : tout service ou couche absent de `src/registry.ts` est refusé.
4. **Sanitation des sorties** : `created_user`, `last_edited_*`, `url_pj`, `url_piece_jointe`, `attachment`, `token`, `password`, `secret`, `bearer`, `GLOBALID` filtrés.
5. **Mode `public` strict** : couches `internal` invisibles, `generate_internal_dashboard_brief` refuse tout autre mode.
6. **`WHERE` sécurisé** : longueur max 500, motifs SQL dangereux refusés (`assertSafeWhere`).
7. **Limites configurables** : `MAX_RESULT_LIMIT=1000`, `MAX_SEARCH_RADIUS_METERS=5000`, `ARCGIS_TIMEOUT_MS=10000`.
8. **Stdio MCP propre** : aucun message ne fuit sur stdout depuis le code (validé par `scripts/smoke-mcp.ts`).

Détail complet, modèle de menace et procédure de divulgation responsable :
[`SECURITY.md`](SECURITY.md).

## 6. Documentation

| Document | Contenu |
| --- | --- |
| [`docs/README-DSI-Annecy.md`](docs/README-DSI-Annecy.md) | Onboarding 1 page DSI Annecy (15 min, profils remote/local) |
| [`SECURITY.md`](SECURITY.md) | Modèle de menace, allowlist, sanitation, rotation des secrets, divulgation |
| [`docs/TECHNICAL_CONTRACTS.md`](docs/TECHNICAL_CONTRACTS.md) | Contrats Zod, `schemaVersion`, `usageProfiles`, architecture |
| [`docs/PUBLIC_REMOTE_USAGE.md`](docs/PUBLIC_REMOTE_USAGE.md) | Mode d'emploi détaillé du serveur HTTP distant public |
| [`docs/DATA_CATALOG_PUBLIC_REMOTE.md`](docs/DATA_CATALOG_PUBLIC_REMOTE.md) | Catalogue détaillé : services, couches, champs publics |
| [`docs/RECETTE_TERRAIN.md`](docs/RECETTE_TERRAIN.md) | Six prompts détaillés + check-lists pour valider une release |
| [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) | Pré-vol, build/tests, smoke, recette, tag Git |
| [`examples/cursor-mcp-config.json`](examples/cursor-mcp-config.json) | Config Cursor stdio prête à coller (Windows + macOS/Linux) |
| [`examples/cursor-mcp-remote-config.json`](examples/cursor-mcp-remote-config.json) | Config Cursor remote HTTPS prête à coller |
| [`examples/copilot-studio-instructions.md`](examples/copilot-studio-instructions.md) | Instructions Copilot Studio |
| [`examples/prompts.md`](examples/prompts.md) | Catalogue de prompts (public, internal, chatbot, open data, qualité) |
| [`CHANGELOG.md`](CHANGELOG.md) | Historique des versions |

## 7. Outils MCP exposés (résumé)

**Public (17, exposés HTTP + stdio)** :
`list_services`, `list_layers`, `describe_layer`, `recommend_layers_for_intent`,
`citizen_query`,
`query_layer`, `search_nearby`, `count_layer`, `detect_data_quality_issues`,
`list_public_works`, `search_public_works_nearby`,
`inventory_all_layers`, `recommend_open_data_candidates`,
`generate_inventory_report`, `generate_open_data_brief`,
`generate_chatbot_readiness_report`, `generate_layer_action_plan`.

**Internal (3, stdio uniquement)** :
`list_current_works`, `list_late_works`, `generate_internal_dashboard_brief`.

Détails des structured outputs : [`docs/TECHNICAL_CONTRACTS.md`](docs/TECHNICAL_CONTRACTS.md).

### `citizen_query` (V1.2)

Outil haut-niveau pour les assistants citoyens (Copilot Studio, Claude, etc.).
Reçoit une question en français libre, choisit la couche pertinente et
exécute l'outil sous-jacent (`search_nearby`, `list_public_works`, etc.).

- Toujours en **mode public**.
- **Jamais d'invention** d'horaires, disponibilités ou règles opposables.
- Si la localisation manque, l'outil renvoie `status: "needs_location"` et
  demande **un lieu** (pas un `serviceKey` / `layerId`).
- Retourne toujours un disclaimer : *« Données indicatives issues du SIG
  public d'Annecy, à vérifier via les canaux officiels pour une démarche
  administrative. »*

## 8. Déploiement Vercel (transport HTTP public)

Le repo est prêt pour Vercel sans configuration supplémentaire.

```bash
vercel link
vercel --prod
```

Variables d'environnement à configurer dans **Project → Settings → Environment Variables** :

| Variable | Valeur recommandée | Remarque |
| --- | --- | --- |
| `ANNECY_SIG_BASE_URL` | `https://portailsig.annecy.fr/server/rest/services` | Allowlist d'hôte |
| `DEFAULT_MODE` | `public` | Mode par défaut HTTP |
| `CONTRACT_POLICY` | `warn` | `strict` casserait les rapports en prod |
| `REMOTE_PUBLIC_ONLY` | `true` | **Ne jamais désactiver** sur l'URL publique |
| `REMOTE_ALLOW_INTERNAL_TOOLS` | `false` | Garde les outils travaux internal invisibles |
| `MCP_PUBLIC_READ_TOKEN` | `openssl rand -hex 32` | Sans valeur → auth désactivée |
| `MCP_ADMIN_TOKEN` | `openssl rand -hex 32` | Optionnel — protège `/api/health/internal`. Fallback : `MCP_PUBLIC_READ_TOKEN`. |
| `PUBLIC_WORK_ID_SALT` | `openssl rand -hex 32` | **Obligatoire en prod** : sel SHA-256 pour ID opaque |
| `MAX_RESULT_LIMIT` | `1000` | Plafond résultats |
| `MAX_SEARCH_RADIUS_METERS` | `5000` | Plafond rayon `search_nearby` |
| `ARCGIS_TIMEOUT_MS` | `10000` | Timeout ArcGIS |
| `ARCGIS_CACHE_TTL_MS` | `300000` | Cache GET en mémoire (5 min) |
| `MCP_REQUEST_TIMEOUT_MS` | `25000` | Timeout global d'une requête `/api/mcp` (V1.2) |
| `MCP_HEAVY_TOOL_TIMEOUT_MS` | `20000` | Timeout des outils lourds (V1.2) |
| `MCP_RATE_LIMIT_ENABLED` | `true` | Active le rate limiting (V1.2) |
| `MCP_RATE_LIMIT_IP_PER_MINUTE` | `60` | Limite par IP / minute |
| `MCP_RATE_LIMIT_GLOBAL_PER_MINUTE` | `300` | Limite globale / minute |
| `MCP_RATE_LIMIT_HEAVY_TOOL_PER_HOUR` | `30` | Limite outils lourds / IP / heure |
| `MCP_CORS_ALLOWED_ORIGINS` | `*` | CSV d'origines CORS — voir `.env.example` |
| `UPSTASH_REDIS_REST_URL` | _(optionnel)_ | Active le store Upstash pour le rate limiting (sinon mémoire locale) |
| `UPSTASH_REDIS_REST_TOKEN` | _(optionnel)_ | Token associé à Upstash REST |

Aucun token portail SIG n'est requis (lecture seule).

Healthcheck **public minimal** (sans appel ArcGIS) : `GET /api/health` retourne
seulement `status`, `serverVersion`, `mode`, `publicOnly`, `bearerRequired`.

Healthcheck **internal détaillé** (uptime, stats cache, compteurs outils,
config opérationnelle) : `GET /api/health/internal`, **protégé par Bearer**
(`MCP_ADMIN_TOKEN`, fallback `MCP_PUBLIC_READ_TOKEN`).

## 8.1 Données et responsabilité

- **Source** : portail SIG d'Annecy (`portailsig.annecy.fr`), uniquement.
- **Lecture seule** : aucune écriture ArcGIS, aucun proxy arbitraire.
- **Données indicatives** : non opposables, non temps réel sauf flux dédié
  documenté.
- **Pas de décision administrative automatisée** : ce service ne remplace
  aucun guichet, aucun arrêté, aucune réglementation.
- **Pas d'information opposable** : pour toute démarche officielle, se
  référer aux canaux de la Ville d'Annecy.

## 8.2 Sécurité — au-delà des 8 garde-fous historiques

V1.2 ajoute :

- **Auth Bearer mono-token** via `MCP_PUBLIC_READ_TOKEN` (rotation centralisée
  côté Vercel — voir `SECURITY.md`).
- **Rate limiting** simple et configurable (par IP, global, outils lourds).
  Backend mémoire par défaut, Upstash Redis optionnel.
- **Logs sanitisés** sur stderr uniquement (token, Authorization, séquences
  ressemblant à des secrets toujours redacted).
- **Healthcheck public minimal** (pas d'uptime, pas de stats), healthcheck
  internal protégé.
- **Outils internal masqués** côté HTTP public. Le verrou `publicOnly`
  refuse explicitement `mode=internal`.
- **CORS configurable** via `MCP_CORS_ALLOWED_ORIGINS`, sans cookies.
- **Timeouts explicites** par requête et par outil lourd.

## 8.3 Rotation du token

1. Régénérer une nouvelle valeur (`openssl rand -hex 32` ou
   `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"`).
2. Mettre à jour `MCP_PUBLIC_READ_TOKEN` côté Vercel (Production).
3. Redéployer.
4. Mettre à jour les clients autorisés (`.cursor/mcp.json`, secrets CI, etc.).
5. **Ne jamais partager** le token dans un document public, un chat ou une
   issue. Tout token affiché est considéré compromis et doit être tourné.

## 8.4 Prompt système recommandé pour Copilot Studio

```text
Tu es un assistant citoyen de la Ville d'Annecy.
- Utilise `citizen_query` en priorité.
- Ne demande JAMAIS `serviceKey`, `layerId` ou `mode` à l'usager.
- Si la localisation manque, demande uniquement une précision de lieu
  (adresse, quartier, point GPS).
- Ne jamais inventer les horaires, les disponibilités temps réel ou les
  informations réglementaires opposables.
- Réponds en langage citoyen simple, neutre, factuel.
- Mentionne les limites des données quand c'est pertinent
  (« Données indicatives, non opposables, à vérifier via les canaux
  officiels de la Ville d'Annecy »).
- En cas de demande hors périmètre, oriente vers les canaux officiels
  plutôt que d'inventer une réponse.
```

## 9. Contribuer

Les contributions sont bienvenues, en particulier :

- **Ajout de nouvelles couches** au registre — toute couche doit être déjà
  publique sur `portailsig.annecy.fr` et passer par une revue d'allowlist
  (sécurité, sanitation des champs).
- **Amélioration des `usageProfiles`** déclaratifs (chatbot, openData, dashboard).
- **Nouveaux outils MCP** d'inventaire ou de rapport (suivre le pattern
  `withToolTracing` + contrat Zod versionné).
- **Documentation** orientée usage (cas d'usage citoyens, recettes Copilot, etc.).

Workflow standard : fork → branche `feat/...` ou `fix/...` → PR avec tests.
La CI exécute build + typecheck + vitest + `schemas:check` + `smoke:mcp` + `audit:check`.
Un cron quotidien `check:registry` vérifie le drift ArcGIS.

## 10. Contact &amp; support

- **Demande de jeton d'accès / aide à l'intégration** :
  [damien.credoz@annecy.fr](mailto:damien.credoz@annecy.fr)
- **Bug, demande de fonctionnalité, nouvelle couche** :
  [GitHub Issues](https://github.com/Damso74/annecy-sig-mcp/issues)
- **Faille de sécurité** : ne pas ouvrir d'issue publique. Voir
  [`SECURITY.md`](SECURITY.md) pour la procédure (GitHub Security Advisory privé ou mail).

## 11. Licence

[MIT](LICENSE) — usage libre, y compris commercial. Les **données** restent
soumises aux conditions d'utilisation du portail SIG d'Annecy.

---

*annecy-sig-mcp · v1.0.0 · transport HTTP via Vercel Functions · landing publique : <https://mcp.leadalpes.fr/>*
