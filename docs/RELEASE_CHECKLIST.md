# Check-list de release — annecy-sig-mcp

À dérouler dans l’ordre pour publier une RC ou une release stable. Cocher
chaque case avant le tag Git.

## 1. Pré-vol — environnement

- `node --version` ≥ 20.
- Branche cible à jour (`git pull --ff-only`).
- Working tree propre (`git status` clean).

## 2. Build et tests offline

- `npm ci` — installation reproductible depuis `package-lock.json`.
- `npm run build` — `tsc` exit 0.
- `npx vitest run` — tous les tests offline verts (5 skipped réseau, c’est normal).
- `npm run schemas` — régénère `schemas/*.schema.json`.
- `npm run schemas:check` — `OK — les JSON Schemas versionnés sont à jour.`

## 3. Smoke test MCP

- `npx tsx scripts/smoke-mcp.ts` — démarre `dist/index.js`, vérifie la
liste des outils MCP attendus et l’absence de logs parasites sur stdout.
- (manuel) Brancher le serveur dans Cursor avec
`examples/cursor-mcp-config.json`, puis exécuter le prompt 1 de
`docs/RECETTE_TERRAIN.md` (`list_services` public).

## 4. Recette terrain

- Dérouler les **6 prompts** de `docs/RECETTE_TERRAIN.md`.
- Saisir les résultats dans une copie de
`examples/terrain-recette-results.template.md`.
- Aucun marqueur sensible (`created_user`, `last_edited_`*, `url_pj`,
`url_piece_jointe`, `token`, `password`, `secret`, `bearer`, `attachment`,
`created_date`, `last_edited_date`) dans les exports `outputs/`.

## 5. Vérifications transverses

- `git grep -n "v04\|v05\|v06"` — aucune réintroduction des anciennes
clés dans les payloads (les occurrences en CHANGELOG sont OK).
- `package.json` `version` aligné avec la cible.
- `CHANGELOG.md` à jour pour la version cible.
- CI verte sur la branche (`.github/workflows/ci.yml`).

## 6. Tag Git

```bash
# Pour la release candidate
git tag -a v1.0.0-rc.1 -m "annecy-sig-mcp v1.0.0-rc.1"
git push origin v1.0.0-rc.1

# Une fois la RC validée en terrain (recette + 48 h sans régression)
git tag -a v1.0.0 -m "annecy-sig-mcp v1.0.0"
git push origin v1.0.0
```

## 7. Annonce

- CHANGELOG visible (interne) et lien vers la doc utilisateur.
- Diffusion du `cursor-mcp-config.json` aux utilisateurs Cursor.
- Rappel sécurité : lecture seule, pas de token, mode `public` par défaut.

## En cas de rollback

```bash
git checkout v0.9.0       # ou la version précédente connue OK
npm ci && npm run build
```

Le serveur MCP est stateless ; aucune donnée locale persistante ne survit à
une bascule de version sauf le contenu de `outputs/` (rapports exportés).