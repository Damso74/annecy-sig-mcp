# Sécurité — annecy-sig-mcp

`annecy-sig-mcp` est un connecteur MCP **lecture seule** pour le portail SIG de
la Ville d’Annecy. Aucune écriture, aucun token, aucune donnée personnelle
réelle dans le repo.

## 1. Lecture seule, point.

- Aucun `POST` / `PUT` / `DELETE` ne quitte ce code. Seuls des `GET` ArcGIS
REST sont effectués (métadonnées, query, count).
- Aucune route `applyEdits` / `addFeatures` / `updateFeatures` n’est exposée.
- `npm run start` n’ouvre aucun port réseau : le serveur communique en stdio
avec le client MCP (Cursor).

## 2. Allowlist d’hôte

- Seules les URLs préfixées par `ANNECY_SIG_BASE_URL` avec hostname
`portailsig.annecy.fr` sont autorisées (`src/arcgis/httpClient.ts`).
- Toute URL hors allowlist fait échouer la requête côté serveur, avant même
l’appel HTTP.

## 3. Allowlist de couches

- Toute couche ou service non déclaré dans `src/registry.ts` est refusé.
- Pas d’accès « par découverte » : les outils MCP ne reçoivent jamais une URL
ArcGIS arbitraire à exécuter.
- L’allowlist sépare `publicFields` (mode public) et `internalFields` (mode
internal). Aucun champ hors registre n’est jamais demandé en `outFields`.

## 4. Sanitation des sorties

Filtrage systématique sur les exports JSON et Markdown des cinq rapports :

- Champs d’édition : `created_user`, `created_date`, `last_edited_user`,
`last_edited_date`.
- Pièces jointes : `url_pj`, `url_piece_jointe`, `attachment`.
- Secrets : `token`, `password`, `secret`, `bearer`.

La suite `tests/v0.9.sanitation.test.ts` rejoue les cinq rapports (incluant
une fixture travaux qui injecte volontairement ces marqueurs) et bloque toute
fuite, sur le payload structuré comme sur le rendu Markdown.

## 5. Mode `public` vs `internal`


| Mode       | Comportement                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `public`   | Seuls les `publicFields` ; couches `visibility: internal` invisibles dans `list_layers` et **ininterrogeables** ; pas d’URL de pièce jointe. |
| `internal` | Union `publicFields` + `internalFields` pour les couches autorisées ; toujours **pas** de secrets (tokens, mots de passe, etc.).             |


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
- Comptage global : `count_layer` utilise `returnCountOnly` côté ArcGIS, sans
télécharger les entités.

## 8. Transport stdio MCP — silence sur stdout

- Le serveur communique avec Cursor en stdio. **Aucun message** ne doit
s’écrire sur stdout en dehors du protocole MCP, sous peine de casser le
client.
- `validateContract` n’écrit que sur stderr (politique `warn`) ou ne loggue
pas du tout (`silent`).
- Les scripts `npm run schemas` / `npm run schemas:check` écrivent leurs
messages sur stderr également, ce qui permet de les piper sans bruit.
- Le smoke test `scripts/smoke-mcp.ts` vérifie ce silence en parsant la
sortie JSON-RPC.

## 9. Transport HTTP distant (Vercel) — public-only

En complément du transport stdio local, un transport HTTP MCP est disponible
via les routes Vercel `api/mcp.ts` et `api/health.ts`. Sa surface d'exposition
est **strictement plus restreinte** que le stdio local :

| Aspect                          | Stdio local                                       | HTTP distant (Vercel)                                                                                          |
| ------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Mode `internal`                 | Autorisé selon `DEFAULT_MODE`                     | **Refusé explicitement** (verrou `REMOTE_PUBLIC_ONLY=true`)                                                    |
| Outils `*_works` / `dashboard`  | Enregistrés                                       | **Non enregistrés** par défaut (`REMOTE_ALLOW_INTERNAL_TOOLS=false`)                                           |
| Auth                            | Aucune (process child Cursor)                     | **Bearer token optionnel** via `MCP_PUBLIC_READ_TOKEN` (recommandé en prod)                                    |
| Réseau                          | Stdio (process)                                   | HTTPS (Vercel function, runtime nodejs20.x)                                                                    |
| Logs                            | stderr uniquement (stdout réservé MCP)            | `console.error` (stderr) côté serveur Vercel — jamais renvoyé au client                                        |
| `mode=restricted`               | Non implémenté                                    | Non implémenté (à arbitrer dans une release ultérieure)                                                        |

Règles dures :

- Le verrou `publicOnly` rejette `mode=internal` côté outil avec le message
  explicite : *« Le transport HTTP public n'autorise pas le mode internal.
  Utiliser le MCP local stdio ou une future passerelle restricted validée
  DSI. »*
- L'enregistrement des outils internal-only est conditionné à
  `REMOTE_ALLOW_INTERNAL_TOOLS=true` (défaut `false`) — à n'activer que
  derrière une passerelle restricted authentifiée, **non implémentée dans cette
  release**.
- L'auth Bearer (`MCP_PUBLIC_READ_TOKEN`) compare en *constant time* et
  n'est jamais journalisée.
- `/api/health` ne fait **aucun appel** vers le portail SIG — c'est un
  diagnostic de montage, pas un audit ArcGIS.

Garde-fou :
- Aucun token SIG n'est requis ni accepté par ce code (lecture seule).
- Pas de mode `restricted` dans cette release (ni stdio ni HTTP).

## En cas de doute

- Toute couche en `requiresLegalReview` ne peut jamais être classée VERT
automatiquement par l’open data brief (verrou côté `recommendOpenData`).
- Toute table d’attachements (`*__ATTACH`) est **non exposée** dans le
registre ; ne pas l’ajouter sans arbitrage métier / juridique.
- Les recommandations restent **indicatives** (échantillons, heuristiques) :
l’arbitrage humain est requis pour toute publication open data.

