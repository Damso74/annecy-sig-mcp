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

export interface AppConfig {
  annecySigBaseUrl: string;
  defaultResultLimit: number;
  maxResultLimit: number;
  defaultMode: "public" | "internal";
  arcgisTimeoutMs: number;
  arcgisCacheTtlMs: number;
  reportOutputDir: string;
  /** Hostname autorisée pour les requêtes ArcGIS (sans schéma). */
  allowedHost: string;
  /** Plafond rayon `search_nearby` (mètres), configurable via MAX_SEARCH_RADIUS_METERS. */
  maxSearchRadiusMeters: number;
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
  const maxSearchRadiusMeters = readEnvInt("MAX_SEARCH_RADIUS_METERS", 5000);
  return {
    annecySigBaseUrl,
    defaultResultLimit: Math.min(Math.max(defaultResultLimit, 1), maxResultLimit),
    maxResultLimit: Math.max(maxResultLimit, 1),
    defaultMode: readEnvMode("DEFAULT_MODE", "public"),
    arcgisTimeoutMs: Math.max(arcgisTimeoutMs, 500),
    arcgisCacheTtlMs: Math.max(arcgisCacheTtlMs, 0),
    reportOutputDir: process.env.REPORT_OUTPUT_DIR ?? "outputs",
    allowedHost,
    maxSearchRadiusMeters: Math.max(100, maxSearchRadiusMeters),
  };
}
