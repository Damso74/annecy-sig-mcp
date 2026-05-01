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


| Aspect                         | Stdio local                            | HTTP distant (Vercel)                                                       |
| ------------------------------ | -------------------------------------- | --------------------------------------------------------------------------- |
| Mode `internal`                | Autorisé selon `DEFAULT_MODE`          | **Refusé explicitement** (verrou `REMOTE_PUBLIC_ONLY=true`)                 |
| Outils `*_works` / `dashboard` | Enregistrés                            | **Non enregistrés** par défaut (`REMOTE_ALLOW_INTERNAL_TOOLS=false`)        |
| Auth                           | Aucune (process child Cursor)          | **Bearer token optionnel** via `MCP_PUBLIC_READ_TOKEN` (recommandé en prod) |
| Réseau                         | Stdio (process)                        | HTTPS (Vercel function, runtime nodejs20.x)                                 |
| Logs                           | stderr uniquement (stdout réservé MCP) | `console.error` (stderr) côté serveur Vercel — jamais renvoyé au client     |
| `mode=restricted`              | Non implémenté                         | Non implémenté (à arbitrer dans une release ultérieure)                     |


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

## 10. Travaux public-light (V1.0)

La couche travaux peut être techniquement publique côté ArcGIS
(`FLUX_SITE_INTERNET/TRAVAUX/MapServer/3` est servie sur le portail public),
mais elle **n’est jamais publiable telle quelle** dans un assistant IA
grand public.

### 10.1 Décision produit / sécurité

- **Public techniquement ≠ publiable brut ≠ utilisable sans cadrage dans
une IA**.
- La couche brute travaux **n’est jamais exposée** sur le transport HTTP
remote, ni via `query_layer`, ni via `search_nearby` — la couche reste
`visibility: "internal"` dans `src/registry.ts` et le verrou
`validateServiceLayer` la bloque en mode public.
- Une **vue public-light** est exposée via deux outils dédiés :
`list_public_works` et `search_public_works_nearby`. Ces outils n’acceptent
que `mode=public`.

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
- **Pas** d’identifiants internes : `ac_odp_ref`, références techniques,
`objectid` brut tel quel.
- **Pas** de documents (lien direct vers arrêté).
- **Pas** de données nominatives, ni `created_user`, ni `last_edited_user`.
- **Pas** de `token`, `password`, `secret`, `bearer`.

Tous ces motifs sont allowlistés dans
`src/tools/publicWorks.ts::FORBIDDEN_PUBLIC_WORK_KEY_SUBSTRINGS` et
vérifiés en sortie par `assertNoSensitivePublicWorkKeys`. La suite
`tests/v1.0.publicWorks.test.ts` rejoue une fixture qui injecte tous ces
marqueurs et confirme qu’aucun ne ressort.

### 10.4 Pas d’internal sur HTTP

- `list_public_works` refuse explicitement `mode=internal` (Zod
  `z.literal("public").optional()` + assertion serveur).
- Les outils internal (`list_current_works`, `list_late_works`,
  `generate_internal_dashboard_brief`) restent **non enregistrés** sur le
  transport HTTP public, conformément à la matrice §9.

### 10.5 `id_public` — opaque et non réversible sans salt

L’identifiant retourné par les vues public-light (`id_public`) **n’est jamais
l’`OBJECTID` ArcGIS brut**. Il est calculé serveur :

```
id_public = "pw_" + sha256(`${serviceKey}:${layerId}:${objectid}:${salt}`).slice(0, 12)
```

avec `salt = process.env.PUBLIC_WORK_ID_SALT` (cf. `src/utils/publicId.ts`).

Conséquences :

- Sans le salt, **aucun client public ne peut reconstituer l’`OBJECTID`** ni
  corréler deux fiches via leur identifiant. Le hash est tronqué à 12
  caractères hex (≈ 16 M valeurs) — collisions négligeables sur un volume
  travaux Annecy mais refus de revenir à un identifiant déterministe partagé
  avec d’autres flux internes.
- En **production Vercel**, `PUBLIC_WORK_ID_SALT` doit être défini avec une
  valeur aléatoire non triviale (`openssl rand -hex 32` ou équivalent). Sans
  cela, le serveur retombe sur un fallback explicitement marqué
  « not-for-production » et émet un warning sur stderr.
- Le salt n’est **jamais** logué ni renvoyé au client.
- Aucun chemin de code n’expose `OBJECTID`, `ac_num` complet ou `ac_odp_ref`
  dans la sortie des outils public-light. La suite `tests/v1.0.publicWorks.test.ts`
  rejoue ces marqueurs interdits sur le `JSON.stringify` des payloads.

## En cas de doute

- Toute couche en `requiresLegalReview` ne peut jamais être classée VERT
automatiquement par l’open data brief (verrou côté `recommendOpenData`).
- Toute table d’attachements (`*__ATTACH`) est **non exposée** dans le
registre ; ne pas l’ajouter sans arbitrage métier / juridique.
- Les recommandations restent **indicatives** (échantillons, heuristiques) :
l’arbitrage humain est requis pour toute publication open data.
- La vue travaux public-light est **non opposable** : pour toute
information opposable, renvoyer vers les canaux officiels de la Ville.

