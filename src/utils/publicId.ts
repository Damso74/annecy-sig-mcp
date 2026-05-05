import { createHash } from "node:crypto";

/**
 * V1.0 — génération d’identifiants publics **opaques** pour les vues
 * « public-light » exposées sur le transport HTTP remote.
 *
 * Pourquoi un fichier dédié ?
 * - L’`OBJECTID` ArcGIS est un identifiant interne ; l’exposer brut (même
 *   préfixé) faciliterait la corrélation avec d’autres flux internes (export
 *   métier DSI, dossier travaux, archives, etc.).
 * - On hashe `serviceKey:layerId:objectid:salt` en SHA-256 et on tronque à
 *   12 caractères hex. C’est suffisant pour distinguer 1e9 entités sans
 *   collision pratique (≈ 16M valeurs possibles, soit < 10⁻³ collision sur
 *   un volume travaux Annecy).
 * - Le **salt** est lu dans `PUBLIC_WORK_ID_SALT`. En son absence, on retombe
 *   sur un fallback stable mais explicitement non sensible — utile en local
 *   et dans les tests offline. En production Vercel, la variable **doit**
 *   être définie (cf. `SECURITY.md` §10 et `README.md` §8).
 * - L’identifiant n’est **pas** réversible côté client : reconstituer
 *   l’`OBJECTID` exigerait à la fois le salt secret et la connaissance
 *   de la plage d’`OBJECTID` du flux, ce qui sort du périmètre public.
 */

/**
 * Fallback explicitement marqué « non secret ». Utilisé uniquement quand
 * `PUBLIC_WORK_ID_SALT` n’est pas défini (local / tests). Le code émet un
 * `console.error` de rappel au premier usage, sans bruit sur stdout (le
 * transport stdio MCP réserve stdout au protocole).
 */
const FALLBACK_SALT = "annecy-sig-mcp-local-dev-salt-not-for-production";

let fallbackWarned = false;

/** Lit le salt depuis `process.env.PUBLIC_WORK_ID_SALT` ou retombe sur un fallback. */
export function getPublicWorkIdSalt(): string {
  const raw = process.env.PUBLIC_WORK_ID_SALT;
  if (raw && raw.trim() !== "") return raw.trim();
  if (!fallbackWarned) {
    fallbackWarned = true;
    // stderr uniquement — jamais stdout (compat stdio MCP).
    // eslint-disable-next-line no-console
    console.error(
      "[publicId] PUBLIC_WORK_ID_SALT non défini — fallback local utilisé. " +
        "À définir impérativement en production Vercel.",
    );
  }
  return FALLBACK_SALT;
}

/**
 * Construit un `id_public` opaque, stable pour un même `(serviceKey, layerId,
 * objectid, salt)`. Format : `pw_` + 12 caractères hex SHA-256.
 *
 * - `rawObjectId` peut être numérique ou string ; toute valeur null/undefined
 *   est neutralisée par un marqueur `unknown` (ne fuite pas l’absence
 *   d’identifiant côté client).
 * - On stringifie via `String(...)` puis on `trim()` pour éviter qu’un espace
 *   parasite ne change la valeur retournée.
 */
export function buildPublicWorkId(
  serviceKey: string,
  layerId: number,
  rawObjectId: unknown,
): string {
  const id =
    typeof rawObjectId === "number" && Number.isFinite(rawObjectId)
      ? String(rawObjectId)
      : typeof rawObjectId === "string" && rawObjectId.trim() !== ""
        ? rawObjectId.trim()
        : "unknown";
  const salt = getPublicWorkIdSalt();
  const hash = createHash("sha256")
    .update(`${serviceKey}:${layerId}:${id}:${salt}`)
    .digest("hex");
  return `pw_${hash.slice(0, 12)}`;
}

/** Exposé pour les tests : permet de neutraliser l’avertissement entre tests. */
export function resetPublicWorkIdSaltWarningForTests(): void {
  fallbackWarned = false;
}

/** Exposé pour les tests : valeur du fallback (non secrète). */
export const PUBLIC_WORK_ID_FALLBACK_SALT = FALLBACK_SALT;
