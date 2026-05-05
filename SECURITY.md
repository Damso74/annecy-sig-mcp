# Sécurité — annecy-sig-mcp

> Politique de sécurité du serveur MCP `annecy-sig-mcp`.
> Pour signaler une vulnérabilité : voir [§ Signaler une vulnérabilité](#signaler-une-vulnérabilité) en bas de page.

`annecy-sig-mcp` est un serveur MCP **lecture seule** sur l'allowlist
ArcGIS de la Ville d'Annecy. Aucune écriture vers le portail SIG, aucun POST,
aucun proxy arbitraire, aucune donnée personnelle réelle dans le repo.

## Sommaire

- [1. Lecture seule, point.](#1-lecture-seule-point)
- [2. Allowlist d'hôte](#2-allowlist-dhôte)
- [3. Allowlist de couches](#3-allowlist-de-couches)
- [4. Sanitation des sorties](#4-sanitation-des-sorties)
- [5. Mode `public` vs `internal`](#5-mode-public-vs-internal)
- [6. Garde-fous SQL `WHERE`](#6-garde-fous-sql-where)
- [7. Limites quantitatives](#7-limites-quantitatives)
- [8. Transport stdio MCP — silence sur stdout](#8-transport-stdio-mcp--silence-sur-stdout)
- [9. Transport HTTP distant (Vercel) — public-only](#9-transport-http-distant-vercel--public-only)
- [10. Travaux public-light (V1.0)](#10-travaux-public-light-v10)
- [11. Secrets gérés](#11-secrets-gérés)
- [12. Procédure de rotation `MCP_PUBLIC_READ_TOKEN`](#12-procédure-de-rotation-mcp_public_read_token)
- [13. Audit dépendances](#13-audit-dépendances)
- [14. Drift de schéma ArcGIS](#14-drift-de-schéma-arcgis)
- [Signaler une vulnérabilité](#signaler-une-vulnérabilité)

---

## 1. Lecture seule, point.

- Aucun `POST` / `PUT` / `DELETE` ne quitte ce code. Seuls des `GET` ArcGIS
  REST sont effectués (métadonnées, query, count).
- Aucune route `applyEdits` / `addFeatures` / `updateFeatures` n'est exposée.
- `npm run start` n'ouvre aucun port réseau : le serveur communique en stdio
  avec le client MCP (Cursor, Claude Desktop, etc.).

## 2. Allowlist d'hôte

- Seules les URLs préfixées par `ANNECY_SIG_BASE_URL` avec hostname
  `portailsig.annecy.fr` sont autorisées (`src/arcgis/httpClient.ts`).
- Toute URL hors allowlist fait échouer la requête côté serveur, **avant**
  même l'appel HTTP.

## 3. Allowlist de couches

- Toute couche ou service non déclaré dans `src/registry.ts` est refusé.
- Pas d'accès « par découverte » : les outils MCP ne reçoivent jamais une
  URL ArcGIS arbitraire à exécuter.
- L'allowlist sépare `publicFields` (mode public) et `internalFields` (mode
  internal). Aucun champ hors registre n'est jamais demandé en `outFields`.

## 4. Sanitation des sorties

Filtrage systématique sur les exports JSON et Markdown des cinq rapports :

- Champs d'édition : `created_user`, `created_date`, `last_edited_user`,
  `last_edited_date`.
- Pièces jointes : `url_pj`, `url_piece_jointe`, `attachment`.
- Identifiants techniques : `GLOBALID`, `globalid`.
- Secrets : `token`, `password`, `secret`, `bearer`.

La suite `tests/v0.9.sanitation.test.ts` rejoue les cinq rapports (incluant
une fixture travaux qui injecte volontairement ces marqueurs) et bloque toute
fuite, sur le payload structuré comme sur le rendu Markdown.

## 5. Mode `public` vs `internal`

| Mode | Comportement |
| --- | --- |
| `public` | Seuls les `publicFields` ; couches `visibility: internal` invisibles dans `list_layers` et **ininterrogeables** ; pas d'URL de pièce jointe. |
| `internal` | Union `publicFields` + `internalFields` pour les couches autorisées ; toujours **pas** de secrets (tokens, mots de passe, etc.). |

Aucun chemin de code ne contourne ce mode. `generate_internal_dashboard_brief`
**refuse** explicitement `mode != internal`.

## 6. Garde-fous SQL `WHERE`

- Longueur maximale 500 caractères.
- Liste de motifs SQL dangereux refusés en défense en profondeur (`;`,
  `--`, `union`, `drop`, …) — voir `src/utils/validation.ts::assertSafeWhere`.

## 7. Limites quantitatives

- `DEFAULT_RESULT_LIMIT` (défaut 100), plafond `MAX_RESULT_LIMIT` (1000).
- `MAX_SEARCH_RADIUS_METERS` plafonne `search_nearby` (défaut 5 000 m).
- `ARCGIS_TIMEOUT_MS` (défaut 10 000 ms) ; `ARCGIS_CACHE_TTL_MS` (défaut
  300 000 ms, mettre `0` pour désactiver le cache GET).
- Comptage global : `count_layer` utilise `returnCountOnly` côté ArcGIS,
  sans télécharger les entités.

## 8. Transport stdio MCP — silence sur stdout

- Le serveur communique avec le client (Cursor, etc.) en stdio.
  **Aucun message** ne doit s'écrire sur stdout en dehors du protocole MCP,
  sous peine de casser le client.
- `validateContract` n'écrit que sur stderr (politique `warn`) ou ne loggue
  pas du tout (`silent`).
- `runtime/logger.ts` émet exclusivement sur stderr en NDJSON.
- Les scripts `npm run schemas` / `npm run schemas:check` écrivent leurs
  messages sur stderr également, ce qui permet de les piper sans bruit.
- Le smoke test `scripts/smoke-mcp.ts` vérifie ce silence en parsant la
  sortie JSON-RPC.

## 9. Transport HTTP distant (Vercel) — public-only

En complément du transport stdio local, un transport HTTP MCP est disponible
via les routes Vercel `api/mcp.ts` et `api/health.ts`. Sa surface d'exposition
est **strictement plus restreinte** que le stdio local :

| Aspect | Stdio local | HTTP distant (Vercel) |
| --- | --- | --- |
| Mode `internal` | Autorisé selon `DEFAULT_MODE` | **Refusé explicitement** (verrou `REMOTE_PUBLIC_ONLY=true`) |
| Outils `*_works` / `dashboard` | Enregistrés | **Non enregistrés** par défaut (`REMOTE_ALLOW_INTERNAL_TOOLS=false`) |
| Auth | Aucune (process child Cursor) | **Bearer token obligatoire** via `MCP_PUBLIC_READ_TOKEN` |
| Réseau | Stdio (process) | HTTPS (Vercel function, runtime nodejs20.x) |
| Logs | stderr uniquement (stdout réservé MCP) | `console.error` (stderr) côté serveur Vercel — jamais renvoyé au client |
| `mode=restricted` | Non implémenté | Non implémenté (à arbitrer dans une release ultérieure) |

### Surface d'attaque résumée

| Surface | Hardening |
| --- | --- |
| Transport HTTP `/api/mcp` | `publicOnly=true` par défaut, refus explicite `mode=internal`, Bearer obligatoire si `MCP_PUBLIC_READ_TOKEN` défini |
| URLs ArcGIS | `assertArcgisUrl` : HTTPS, hôte `portailsig.annecy.fr` uniquement, préfixe `ANNECY_SIG_BASE_URL`, méthode GET uniquement |
| Champs ArcGIS | Allowlist par couche (`registry.fields.generated.ts`), filtrage des champs sensibles avant exposition (mode public) |
| Travaux | Couche `travaux/3` : `publicFields = []` ; outils internes (`list_current_works`, `list_late_works`, `generate_internal_dashboard_brief`) **jamais** enregistrés sur le remote public |
| Travaux public-light | `list_public_works` / `search_public_works_nearby` : ID opaque haché (SHA-256 + salt `PUBLIC_WORK_ID_SALT`), pas d'OBJECTID brut, pas d'arrêté complet, pas de pièces jointes |
| Logs | JSON ligne-par-ligne sur **stderr uniquement** (`runtime/logger.ts`). Aucun token / Bearer / champ sensible ne doit transiter par les logs |
| CORS HTTP | Méthodes restreintes à `GET, POST, OPTIONS`, headers limités à `Authorization, Content-Type, MCP-Protocol-Version`, **pas** de cookies (`Allow-Credentials` absent) |

### Règles dures

- Le verrou `publicOnly` rejette `mode=internal` côté outil avec le message
  explicite : *« Le transport HTTP public n'autorise pas le mode internal.
  Utiliser le MCP local stdio ou une future passerelle restricted validée
  DSI. »*
- L'enregistrement des outils internal-only est conditionné à
  `REMOTE_ALLOW_INTERNAL_TOOLS=true` (défaut `false`) — à n'activer que
  derrière une passerelle restricted authentifiée, **non implémentée dans
  cette release**.
- L'auth Bearer (`MCP_PUBLIC_READ_TOKEN`) compare en *constant time* et
  n'est jamais journalisée.
- `/api/health` ne fait **aucun appel** vers le portail SIG — c'est un
  diagnostic de montage, pas un audit ArcGIS.

## 10. Travaux public-light (V1.0)

La couche travaux peut être techniquement publique côté ArcGIS
(`FLUX_SITE_INTERNET/TRAVAUX/MapServer/3` est servie sur le portail public),
mais elle **n'est jamais publiable telle quelle** dans un assistant IA
grand public.

### 10.1 Décision produit / sécurité

- **Public techniquement ≠ publiable brut ≠ utilisable sans cadrage dans
  une IA**.
- La couche brute travaux **n'est jamais exposée** sur le transport HTTP
  remote, ni via `query_layer`, ni via `search_nearby` — la couche reste
  `visibility: "internal"` dans `src/registry.ts` et le verrou
  `validateServiceLayer` la bloque en mode public.
- Une **vue public-light** est exposée via deux outils dédiés :
  `list_public_works` et `search_public_works_nearby`. Ces outils
  n'acceptent que `mode=public`.

### 10.2 Champs autorisés dans la vue public-light

`id_public` (**opaque**, hash SHA-256 préfixé `pw_`, voir §10.5),
`titre_public` (simplifié), `statut_public` (libellé citoyen),
`date_debut_iso`, `date_fin_iso`, `secteur_public` (adresse ou commune),
`commune_deleguee`, `geometry` (uniquement si demandée et disponible),
`qualityFlags` (booléens), `distance_m` (search nearby).

Le bloc `source` retourné porte des verrous machine-vérifiables :
`schemaVersion=public_works.v1`, `mode=public`, `filtered=true`,
`rawLayerExposed=false`, `disclaimer` explicite.

### 10.3 Champs strictement interdits dans cette vue

- **Pas** de pièces jointes : `url_pj`, `url_piece_jointe`, `attachment`.
- **Pas** de description libre brute (champ `description`).
- **Pas** d'identifiants internes : `ac_odp_ref`, références techniques,
  `objectid` brut tel quel.
- **Pas** de documents (lien direct vers arrêté).
- **Pas** de données nominatives, ni `created_user`, ni `last_edited_user`.
- **Pas** de `token`, `password`, `secret`, `bearer`.

Tous ces motifs sont dénylistés dans
`src/tools/publicWorks.ts::FORBIDDEN_PUBLIC_WORK_KEY_SUBSTRINGS` et
vérifiés en sortie par `assertNoSensitivePublicWorkKeys`. La suite
`tests/v1.0.publicWorks.test.ts` rejoue une fixture qui injecte tous ces
marqueurs et confirme qu'aucun ne ressort.

### 10.4 Pas d'internal sur HTTP

- `list_public_works` refuse explicitement `mode=internal`.
- Les outils internal (`list_current_works`, `list_late_works`,
  `generate_internal_dashboard_brief`) restent **non enregistrés** sur le
  transport HTTP public, conformément à la matrice §9.

### 10.5 `id_public` — opaque et non réversible sans salt

L'identifiant retourné par les vues public-light (`id_public`) **n'est
jamais l'`OBJECTID` ArcGIS brut**. Il est calculé serveur :

```
id_public = "pw_" + sha256(`${serviceKey}:${layerId}:${objectid}:${salt}`).slice(0, 12)
```

avec `salt = process.env.PUBLIC_WORK_ID_SALT` (cf. `src/utils/publicId.ts`).

Conséquences :

- Sans le salt, **aucun client public ne peut reconstituer l'`OBJECTID`** ni
  corréler deux fiches via leur identifiant. Le hash est tronqué à 12
  caractères hex (≈ 16 M valeurs) — collisions négligeables sur un volume
  travaux Annecy.
- En **production Vercel**, `PUBLIC_WORK_ID_SALT` doit être défini avec une
  valeur aléatoire non triviale (`openssl rand -hex 32` ou équivalent).
  Sans cela, le serveur retombe sur un fallback explicitement marqué
  « not-for-production » et émet un warning sur stderr.
- Le salt n'est **jamais** logué ni renvoyé au client.
- Aucun chemin de code n'expose `OBJECTID`, `ac_num` complet ou
  `ac_odp_ref` dans la sortie des outils public-light.

## 11. Secrets gérés

Aucun secret n'est nécessaire en lecture côté ArcGIS. Deux variables
sensibles doivent rester confidentielles côté Vercel :

| Variable | Rôle | Rotation conseillée |
| --- | --- | --- |
| `MCP_PUBLIC_READ_TOKEN` | Bearer requis sur `/api/mcp` (clients tiers, Cursor, Claude Desktop, etc.) | Tous les 90 jours, après tout incident, ou départ d'un usager autorisé |
| `PUBLIC_WORK_ID_SALT` | Salt SHA-256 utilisé pour rendre les IDs travaux non-réversibles | **Jamais sans coordination** : la rotation invalide tous les IDs publics déjà partagés |

Aucun secret ne doit apparaître dans :

- les logs (`logger` filtre par convention) ;
- les commits (`.env*` et `.git-commit-msg.tmp` listés dans `.gitignore`) ;
- les rapports JSON / Markdown (test `tests/v0.9.sanitation.test.ts`).

## 12. Procédure de rotation `MCP_PUBLIC_READ_TOKEN`

1. Générer un nouveau token (32 octets aléatoires, base64url) :
   ```bash
   node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
   ```
2. Sur Vercel, environnement Production : éditer la variable
   `MCP_PUBLIC_READ_TOKEN` avec la nouvelle valeur.
3. Redéployer (Vercel propage la variable au prochain build).
4. Mettre à jour les clients (`.cursor/mcp.json` côté usager, secrets CI
   éventuels) avec le nouveau Bearer.
5. Vérifier l'effet : `curl https://mcp.leadalpes.fr/api/health` doit
   répondre `bearerRequired: true` ; un appel `/api/mcp` sans Bearer
   doit renvoyer `401`.
6. Conserver la trace de la rotation (date + opérateur) dans le ticket
   d'opération interne.

En cas de fuite suspectée : rotation immédiate, puis revue des logs
`tool.error` (`runtime` du `/api/health`) sur les dernières 24 h.

## 13. Audit dépendances

Trois mécanismes :

1. **`npm run audit:check`** — exécute `npm audit --omit=dev --audit-level=high`.
   Sortie en code 1 si une vulnérabilité haute/critique touche le runtime de
   production.
2. **Dependabot** (`.github/dependabot.yml`) — PRs hebdomadaires groupées
   (runtime / tooling), majors `@modelcontextprotocol/sdk` réservés à la
   revue manuelle.
3. **CI GitHub Actions** (`.github/workflows/ci.yml`) — exécute
   `audit:check` à chaque push (`continue-on-error: true` pour ne pas
   bloquer un fix urgent ; signal de bruit, pas un mur).

## 14. Drift de schéma ArcGIS

`scripts/sync-registry-from-arcgis.ts` (live) garantit que les `outFields`
envoyés à ArcGIS correspondent à la réalité du schéma. La CI manuelle
`network-tests.yml` lance `npm run check:registry` quotidiennement
(cron 06:00 UTC) : un changement de schéma côté SIG sort en code 1 et
impose un `npm run sync:registry` local + commit du fichier généré.

## En cas de doute (publication open data)

- Toute couche en `requiresLegalReview` ne peut jamais être classée VERT
  automatiquement par l'open data brief (verrou côté `recommendOpenData`).
- Toute table d'attachements (`*__ATTACH`) est **non exposée** dans le
  registre ; ne pas l'ajouter sans arbitrage métier / juridique.
- Les recommandations restent **indicatives** (échantillons, heuristiques) :
  l'arbitrage humain est requis pour toute publication open data.
- La vue travaux public-light est **non opposable** : pour toute
  information opposable, renvoyer vers les canaux officiels de la Ville.

---

## Signaler une vulnérabilité

**Ne pas ouvrir d'issue publique** pour un problème de sécurité. Deux canaux :

1. **GitHub Security Advisory privé** (préféré) :
   <https://github.com/Damso74/annecy-sig-mcp/security/advisories/new>
   — divulgation responsable, coordination avec le mainteneur.
2. **Email direct** : <damien.credoz@annecy.fr> avec sujet
   `[SECURITY] annecy-sig-mcp` et description sans détail exploitable
   en clair (joindre un PoC chiffré si nécessaire).

Engagement de réponse : **accusé de réception sous 7 jours ouvrés**, plan de
remédiation sous 30 jours pour les vulnérabilités haute/critique. Pas de
divulgation publique avant correctif déployé sur `mcp.leadalpes.fr`.

Pour les problèmes côté **portail SIG d'Annecy** lui-même (et non côté
serveur MCP), suivre le canal officiel de la Ville d'Annecy
(<https://portailsig.annecy.fr/>).
