const DEFAULT_BASE = "https://portailsig.annecy.fr/server/rest/services";

function readEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function readEnvMode(key: string, fallback: "public" | "internal"): "public" | "internal" {
  const v = (process.env[key] ?? "").toLowerCase();
  if (v === "internal") return "internal";
  if (v === "public") return "public";
  return fallback;
}

function readEnvBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function readEnvOptionalString(key: string): string | undefined {
  const v = process.env[key];
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed === "" ? undefined : trimmed;
}

export interface AppConfig {
  annecySigBaseUrl: string;
  defaultResultLimit: number;
  maxResultLimit: number;
  defaultMode: "public" | "internal";
  arcgisTimeoutMs: number;
  arcgisCacheTtlMs: number;
  /** TTL spécifique pour les schémas de couches (`?f=pjson`) — change rarement. */
  arcgisMetadataCacheTtlMs: number;
  reportOutputDir: string;
  /** Hostname autorisée pour les requêtes ArcGIS (sans schéma). */
  allowedHost: string;
  /** Plafond rayon `search_nearby` (mètres), configurable via MAX_SEARCH_RADIUS_METERS. */
  maxSearchRadiusMeters: number;
  /**
   * Paramètres dédiés au transport HTTP distant (`api/mcp`). Ils n'ont **aucun
   * effet** sur le bootstrap stdio local — ils sont lus par le handler HTTP
   * pour décider du verrouillage public-only et de l'exposition (ou non) des
   * outils internal.
   */
  remote: {
    /** Force `mode = "public"` côté serveur, refus explicite de `internal`. */
    publicOnly: boolean;
    /**
     * Autorise l'enregistrement des outils internal-only (travaux, dashboard
     * interne) sur le transport HTTP. Faux par défaut — à n'activer que
     * derrière une passerelle restricted authentifiée.
     */
    allowInternalTools: boolean;
    /**
     * Token Bearer optionnel exigé sur `/api/mcp`.
     * - Indéfini (`MCP_PUBLIC_READ_TOKEN` non défini) : auth désactivée
     *   (utile en local/test, à éviter en prod Vercel).
     * - Défini : `Authorization: Bearer <token>` requis (sinon `401`).
     *
     * Source unique de vérité côté serveur — jamais journalisé.
     */
    publicReadToken?: string;
  };
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function loadConfig(): AppConfig {
  const annecySigBaseUrl = normalizeBaseUrl(process.env.ANNECY_SIG_BASE_URL ?? DEFAULT_BASE);
  let allowedHost: string;
  try {
    allowedHost = new URL(annecySigBaseUrl).hostname;
  } catch {
    allowedHost = "portailsig.annecy.fr";
  }
  if (allowedHost !== "portailsig.annecy.fr") {
    throw new Error(
      `ANNECY_SIG_BASE_URL doit pointer vers portailsig.annecy.fr (hostname reçu: ${allowedHost}).`,
    );
  }
  const defaultResultLimit = readEnvInt("DEFAULT_RESULT_LIMIT", 100);
  const maxResultLimit = readEnvInt("MAX_RESULT_LIMIT", 1000);
  const arcgisTimeoutMs = readEnvInt("ARCGIS_TIMEOUT_MS", 10_000);
  const arcgisCacheTtlMs = readEnvInt("ARCGIS_CACHE_TTL_MS", 5 * 60_000);
  const arcgisMetadataCacheTtlMs = readEnvInt("ARCGIS_METADATA_CACHE_TTL_MS", 30 * 60_000);
  const maxSearchRadiusMeters = readEnvInt("MAX_SEARCH_RADIUS_METERS", 5000);
  return {
    annecySigBaseUrl,
    defaultResultLimit: Math.min(Math.max(defaultResultLimit, 1), maxResultLimit),
    maxResultLimit: Math.max(maxResultLimit, 1),
    defaultMode: readEnvMode("DEFAULT_MODE", "public"),
    arcgisTimeoutMs: Math.max(arcgisTimeoutMs, 500),
    arcgisCacheTtlMs: Math.max(arcgisCacheTtlMs, 0),
    arcgisMetadataCacheTtlMs: Math.max(arcgisMetadataCacheTtlMs, 0),
    reportOutputDir: process.env.REPORT_OUTPUT_DIR ?? "outputs",
    allowedHost,
    maxSearchRadiusMeters: Math.max(100, maxSearchRadiusMeters),
    remote: {
      // Le HTTP distant doit être public-only par défaut. On accepte de
      // désactiver le verrou via `REMOTE_PUBLIC_ONLY=false` mais c'est très
      // explicite côté Ops.
      publicOnly: readEnvBool("REMOTE_PUBLIC_ONLY", true),
      allowInternalTools: readEnvBool("REMOTE_ALLOW_INTERNAL_TOOLS", false),
      publicReadToken: readEnvOptionalString("MCP_PUBLIC_READ_TOKEN"),
    },
  };
}
