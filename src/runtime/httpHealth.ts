/**
 * Healthchecks HTTP — séparation public minimal / internal détaillé.
 *
 * - `handlePublicHealth` : payload réduit, renvoyé sans authentification, sans
 *   informations exploitables pour la reconnaissance (uptime, stats cache,
 *   compteurs d'erreurs, etc.). Convient pour Better Stack / UptimeRobot.
 *
 * - `handleInternalHealth` : payload détaillé, **protégé par Bearer**.
 *   - Si `MCP_ADMIN_TOKEN` est défini, c'est le token attendu.
 *   - Sinon, fallback sur `MCP_PUBLIC_READ_TOKEN` (compromis « simple par
 *     défaut » documenté dans SECURITY.md).
 *   - Si aucun des deux n'est défini en environnement remote (Vercel /
 *     production), la route répond `401` plutôt que d'exposer les détails.
 *
 * Ne jamais inclure dans une réponse de health :
 * - la valeur d'un token, même tronqué ;
 * - l'IP cliente brute ;
 * - un Authorization header ;
 * - une variable d'env brute autre que les flags non sensibles listés.
 */

import { type AppConfig } from "../config.js";
import { SERVER_VERSION } from "./version.js";
import { getArcgisHttpStats } from "../arcgis/httpClient.js";
import { getLoggerStats } from "./logger.js";
import { getRateLimitStoreType } from "./rateLimit.js";
import { checkBearer } from "./httpAuth.js";

const HEALTH_BOOTED_AT = Date.now();

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

/**
 * Payload minimal public — pas d'uptime, pas de stats, pas de message
 * d'erreur. Si la config échoue, on signale un état dégradé sans rien
 * révéler.
 */
export function handlePublicHealth(cfg?: AppConfig): Response {
  const publicOnly = cfg?.remote.publicOnly ?? true;
  const bearerRequired = cfg?.remote.publicReadToken !== undefined;
  return jsonResponse(200, {
    status: "ok",
    server: "annecy-sig-mcp",
    transport: "http" as const,
    serverVersion: SERVER_VERSION,
    mode: "public" as const,
    publicOnly,
    bearerRequired,
  });
}

export interface InternalHealthOptions {
  cfg: AppConfig;
}

/**
 * Health internal détaillé. Vérifie le Bearer (`MCP_ADMIN_TOKEN`, sinon
 * `MCP_PUBLIC_READ_TOKEN`) et retourne un payload riche orienté
 * exploitation.
 */
export async function handleInternalHealth(
  req: Request,
  options: InternalHealthOptions,
): Promise<Response> {
  const cfg = options.cfg;
  const expected = cfg.remote.adminToken ?? cfg.remote.publicReadToken;
  if (!expected) {
    // En environnement remote, on refuse plutôt que d'exposer.
    const isRemote =
      process.env.VERCEL === "1" ||
      process.env.VERCEL_ENV !== undefined ||
      process.env.NODE_ENV === "production";
    if (isRemote) {
      return jsonResponse(
        401,
        {
          status: "error",
          error: "Authentification requise pour /api/health/internal.",
        },
        { "www-authenticate": 'Bearer realm="annecy-sig-mcp-admin"' },
      );
    }
    // En local : on laisse passer pour le confort de dev — c'est documenté.
  } else {
    const auth = checkBearer(req, { expectedToken: expected });
    if (!auth.ok && auth.response) return auth.response;
  }

  const arcgis = getArcgisHttpStats();
  const tools = getLoggerStats();
  const rateLimitStoreType = getRateLimitStoreType();

  return jsonResponse(200, {
    status: "ok",
    server: "annecy-sig-mcp",
    transport: "http" as const,
    serverVersion: SERVER_VERSION,
    uptimeMs: Date.now() - HEALTH_BOOTED_AT,
    config: {
      publicOnly: cfg.remote.publicOnly,
      internalToolsAllowed: cfg.remote.allowInternalTools,
      bearerRequired: cfg.remote.publicReadToken !== undefined,
      adminTokenConfigured: cfg.remote.adminToken !== undefined,
      maxResultLimit: cfg.maxResultLimit,
      maxSearchRadiusMeters: cfg.maxSearchRadiusMeters,
      arcgisTimeoutMs: cfg.arcgisTimeoutMs,
      requestTimeoutMs: cfg.remote.requestTimeoutMs,
      heavyToolTimeoutMs: cfg.remote.heavyToolTimeoutMs,
      corsAllowedOrigins: cfg.remote.corsAllowedOrigins,
    },
    rateLimit: {
      enabled: cfg.remote.rateLimitEnabled,
      storeType: rateLimitStoreType,
      ipPerMinute: cfg.remote.rateLimitIpPerMinute,
      globalPerMinute: cfg.remote.rateLimitGlobalPerMinute,
      heavyToolPerHour: cfg.remote.rateLimitHeavyToolPerHour,
    },
    runtime: {
      arcgis,
      tools,
    },
  });
}
