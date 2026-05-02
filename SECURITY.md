# Sécurité

`annecy-sig-mcp` est un serveur MCP **lecture seule** sur l'allowlist
ArcGIS Annecy. Aucune écriture vers le portail SIG, aucun POST, aucun proxy
arbitraire. Cette page documente les garde-fous appliqués et la procédure
de rotation des secrets.

## Surface d'attaque

| Surface                          | Hardening                                                                                                  |
|----------------------------------|------------------------------------------------------------------------------------------------------------|
| Transport HTTP `api/mcp`         | `publicOnly=true` par défaut, refus explicite `mode=internal`, Bearer obligatoire si `MCP_PUBLIC_READ_TOKEN` défini |
| URLs ArcGIS                      | `assertArcgisUrl` : HTTPS, hôte `portailsig.annecy.fr` uniquement, préfixe `ANNECY_SIG_BASE_URL`, méthode GET uniquement |
| Champs ArcGIS                    | Allowlist par couche (`registry.fields.generated.ts`), filtrage des champs sensibles avant exposition (mode public) |
| Travaux                          | Couche `travaux/3` : `publicFields = []` ; outils internes (`list_current_works`, `list_late_works`, `generate_internal_dashboard_brief`) **jamais** enregistrés sur le remote public |
| Travaux public-light             | `list_public_works` / `search_public_works_nearby` : ID opaque haché (SHA-256 + salt `PUBLIC_WORK_ID_SALT`), pas d'OBJECTID brut, pas d'arrêté complet, pas de pièces jointes |
| Logs                             | JSON ligne-par-ligne sur **stderr uniquement** (`runtime/logger.ts`). Aucun token / Bearer / champ sensible ne doit transiter par les logs |
| CORS HTTP                        | Méthodes restreintes à `GET, POST, OPTIONS`, headers limités à `Authorization, Content-Type, MCP-Protocol-Version`, **pas** de cookies (`Allow-Credentials` absent) |

## Secrets gérés

Aucun secret n'est nécessaire en lecture côté ArcGIS. Deux variables sensibles
doivent rester confidentielles côté Vercel :

| Variable                  | Rôle                                                                  | Rotation conseillée |
|---------------------------|-----------------------------------------------------------------------|---------------------|
| `MCP_PUBLIC_READ_TOKEN`   | Bearer requis sur `api/mcp` (clients tiers, Cursor, Copilot, etc.).   | Tous les 90 jours, après tout incident, ou départ d'un usager autorisé |
| `PUBLIC_WORK_ID_SALT`     | Salt SHA-256 utilisé pour rendre les IDs travaux non-réversibles.     | **Jamais sans coordination** : la rotation invalide tous les IDs publics déjà partagés |

Aucun secret ne doit apparaître dans :

- les logs (`logger` filtre par convention) ;
- les commits (rappel `.env` listé dans `.gitignore`, voir `AGENTS.md`) ;
- les rapports JSON / Markdown (test `tests/v0.9.sanitation.test.ts`).

## Procédure de rotation `MCP_PUBLIC_READ_TOKEN`

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
   répondre `bearerRequired: true` ; un appel `api/mcp` sans Bearer
   doit renvoyer `401`.
6. Conserver la trace de la rotation (date + opérateur) dans le ticket
   d'opération interne.

En cas de fuite suspectée : rotation immédiate, puis revue des logs
`tool.error` (`runtime` du `/api/health`) sur les dernières 24 h.

## Audit dépendances

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

## Drift de schéma ArcGIS

`scripts/sync-registry-from-arcgis.ts` (live) garantit que les `outFields`
envoyés à ArcGIS correspondent à la réalité du schéma. La CI manuelle
`network-tests.yml` lance `npm run check:registry` : un changement de
schéma côté SIG sort en code 1 et impose un `npm run sync:registry`
local + commit du fichier généré.

## Signaler une vulnérabilité

Vulnérabilité de sécurité dans le serveur MCP (et **non** côté portail
SIG, qui suit son propre canal) : ouvrir une issue GitHub privée
(`Security advisory`) en évitant tout détail exploitable dans le titre.
Pas de divulgation publique avant correctif.
