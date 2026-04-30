const ALWAYS_STRIP = new Set([
  "created_user",
  "created_date",
  "last_edited_user",
  "last_edited_date",
]);

const FORBIDDEN_SUBSTRINGS = [
  "password",
  "token",
  "secret",
  "email",
  "tel_personnel",
  "nom_usager",
  "prenom_usager",
  "plaque",
  "immatriculation",
  "commentaire_interne",
] as const;

function keyMatchesForbidden(key: string): boolean {
  const lower = key.toLowerCase();
  return FORBIDDEN_SUBSTRINGS.some(s => lower.includes(s));
}

/**
 * Filtre strict sur allowlist + suppressions défensives (édition interne, motifs sensibles).
 */
export function sanitizePublicProperties(
  properties: Record<string, unknown>,
  allowedFields: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (ALWAYS_STRIP.has(k.toLowerCase())) continue;
    if (keyMatchesForbidden(k)) continue;
    if (!allowedFields.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Même logique défensive, sans filtre allowlist (mode internal après whitelist métier). */
export function stripDangerousKeys(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (ALWAYS_STRIP.has(k.toLowerCase())) continue;
    if (keyMatchesForbidden(k)) continue;
    out[k] = v;
  }
  return out;
}

export function whitelistProperties(
  properties: Record<string, unknown>,
  allowedFields: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(properties, k)) {
      out[k] = properties[k];
    }
  }
  return out;
}
