# Contribuer à annecy-sig-mcp

Merci de l'intérêt ! Ce projet est volontairement petit, focalisé et
sécurité-first. Toute contribution est bienvenue à condition de respecter
ces principes.

## Principes non négociables

1. **Lecture seule absolue** vers ArcGIS. Aucune route POST/PUT/DELETE,
   aucun appel `applyEdits`, aucun token éditeur. Si votre PR ajoute du
   code qui pourrait écrire vers le SIG, elle sera refusée.
2. **Allowlist stricte**. Toute nouvelle couche, tout nouveau service ou
   toute nouvelle URL externe doit être explicitement allowlistée dans
   `src/registry.ts` et passer la sanitation des champs sensibles.
3. **Tests obligatoires** pour tout nouveau code métier. La barre est :
   `npm test` doit rester **100 % offline** (fixtures sous
   `tests/fixtures/arcgis/`) sauf marquage explicite `RUN_NETWORK_TESTS`.
4. **Pas de secret dans le code ni dans les commits**, même de test.
   Le `.gitignore` couvre `.env*` et `.git-commit-msg.tmp`.
5. **Stdout silencieux** : le serveur stdio MCP utilise stdout pour le
   protocole. Tous les logs vont sur **stderr** (`runtime/logger.ts`).
   Le smoke `npm run smoke:mcp` valide ce point en CI.

## Cas d'usage typiques

### Demander l'ajout d'une nouvelle couche du SIG

1. Vérifier que la couche est **déjà publique** sur
   <https://portailsig.annecy.fr/>.
2. Ouvrir une issue avec le template *« Ajouter une couche »* en précisant :
   - Service ArcGIS et `layerId`
   - Cas d'usage citoyen / interne
   - Champs à exposer en mode public (sera revu côté sanitation)
3. Si validé, la couche est ajoutée à `src/registry.ts` et
   `npm run sync:registry` régénère les overrides depuis ArcGIS LIVE.

### Proposer un nouvel outil MCP

1. Lire `docs/TECHNICAL_CONTRACTS.md` pour comprendre la convention
   `schemaVersion: *.v1`, le pattern `withToolTracing` et les
   `usageProfiles`.
2. Créer un fichier `src/tools/<nom>.ts` avec un schéma Zod versionné.
3. Enregistrer l'outil dans `src/server.ts`.
4. Ajouter au moins un test offline dans `tests/`.
5. Mettre à jour `REMOTE_PUBLIC_TOOLS` dans `src/runtime/httpHandler.ts`
   **uniquement si l'outil doit être exposé sur le transport HTTP public**.
6. Mettre à jour `scripts/smoke-http.ts` (constante `REQUIRED_PUBLIC_TOOLS`).

### Corriger un bug

1. Ouvrir une issue avec le template *« Bug »* en joignant les logs
   pertinents (jamais de tokens en clair).
2. Reproduire avec un test offline si possible.
3. PR avec le fix + le test qui échoue avant et passe après.

## Workflow

```bash
git clone https://github.com/Damso74/annecy-sig-mcp.git
cd annecy-sig-mcp
npm ci
npm run build
npm test
git checkout -b fix/<sujet>   # ou feat/<sujet>, docs/<sujet>
# ... travail ...
npm test && npm run smoke:mcp && npm run smoke:http
git commit -m "type(scope): subject"
git push -u origin fix/<sujet>
# Ouvrir la PR sur GitHub
```

## Format des commits

Conventional Commits :

- `feat(scope): nouveau comportement`
- `fix(scope): correction bug`
- `docs(scope): documentation seule`
- `chore(scope): outillage, deps, refacto sans changement comportemental`
- `test(scope): ajout/correction de tests`
- `ci(scope): GitHub Actions`
- `release(version): tag de release`

Le sujet en français ou en anglais, peu importe — restez cohérent au sein
d'une PR.

## CI

Chaque PR déclenche :

- `npm ci`
- `npm run build` + `npm run typecheck:api`
- `npm test`
- `npm run schemas:check`
- `npm run smoke:mcp`
- `npm run audit:check` (vulnérabilités runtime)

Un cron quotidien lance `npm run check:registry` (live) pour détecter le
drift de schéma ArcGIS — si la CI quotidienne échoue, lancer
`npm run sync:registry` localement et committer le fichier généré.

## Sécurité

Pour signaler une vulnérabilité, **ne pas ouvrir d'issue publique**. Suivre
la procédure documentée dans [`SECURITY.md`](SECURITY.md).

## Licence

En contribuant, vous acceptez que vos contributions soient publiées sous
[licence MIT](LICENSE).

---

*Questions ? <damien.credoz@annecy.fr> ou GitHub Issues.*
