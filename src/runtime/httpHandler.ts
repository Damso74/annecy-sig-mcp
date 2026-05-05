/**
 * Handler HTTP MCP — utilisé par les routes Vercel `api/mcp.ts`,
 * `api/health.ts` et `api/health/internal.ts`, ainsi que par les smoke tests.
 *
 * Choix d'architecture :
 *
 * - Mode **stateless** : on instancie un `McpServer` + un transport
 *   `WebStandardStreamableHTTPServerTransport` à chaque requête. Aucune
 *   session conservée entre invocations — c'est le bon modèle pour des
 *   serverless functions (Vercel) où l'instance n'est pas garantie de
 *   survivre, et c'est cohérent avec un MCP en lecture seule sans état.
 *
 * - Mode **public-only** : par défaut le handler force `publicOnly=true` et
 *   `allowInternalTools=false` (lus depuis `cfg.remote`), refuse explicitement
 *   `mode=internal` côté outils, et n'enregistre pas les outils internal.
 *
 * - **JSON response** activée (`enableJsonResponse: true`) : on évite de
 *   maintenir une connexion SSE longue durée, peu adaptée à un déploiement
 *   serverless. Cursor / Copilot acceptent les réponses JSON Streamable HTTP.
 *
 * - **Logs** : tout passe par `console.error` (stderr). On ne fuit jamais sur
 *   stdout, par cohérence avec la contrainte stdio existante.
 *
 * Hardening V1.2 :
 * - rate limiting (IP/min, global/min, outils lourds/h) appliqué **avant**
 *   l'auth pour limiter le brute-force ;
 * - timeout global par requête (`MCP_REQUEST_TIMEOUT_MS`) avec réponse JSON-RPC
 *   `-32030` propre ;
 * - timeout dédié aux outils lourds (`MCP_HEAVY_TOOL_TIMEOUT_MS`) ;
 * - CORS configurable via `MCP_CORS_ALLOWED_ORIGINS`, sans `Allow-Credentials` ;
 * - public health minimal, internal health protégé par Bearer.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadConfig, type AppConfig } from "../config.js";
import { assertConfigLimits } from "../utils/validation.js";
import { createAnnecySigMcpServer } from "../server.js";
import { checkBearer } from "./httpAuth.js";
import {
  buildRateLimitedResponse,
  evaluateRateLimit,
  getClientIp,
  getRateLimitStore,
  HEAVY_TOOL_NAMES,
  redactIp,
} from "./rateLimit.js";
import { handleInternalHealth, handlePublicHealth } from "./httpHealth.js";
import { logger, warnIfPublicTokenMissing } from "./logger.js";

export interface HttpHandlerOptions {
  /** Config explicite (utile pour tests). Sinon `loadConfig()` à chaque appel. */
  config?: AppConfig;
}

/**
 * Liste des outils enregistrés en remote public par défaut — utilisée par le
 * smoke test pour vérifier la non-régression. Doit rester synchronisée avec
 * la logique de `registerAnnecySigTools` (filtrage `allowInternalTools`).
 */
export const REMOTE_PUBLIC_TOOLS = [
  "list_services",
  "list_layers",
  "describe_layer",
  "query_layer",
  "search_nearby",
  "count_layer",
  "detect_data_quality_issues",
  "inventory_all_layers",
  "recommend_open_data_candidates",
  // V1.1 — découverte par intention citoyenne (matching lexical déterministe).
  "recommend_layers_for_intent",
  "generate_inventory_report",
  "generate_open_data_brief",
  "generate_chatbot_readiness_report",
  "generate_layer_action_plan",
  // V1.0 — vue travaux **public-light** (filtrée, jamais brute).
  "list_public_works",
  "search_public_works_nearby",
  // V1.2 — outil haut-niveau citoyen (router vers les outils existants).
  "citizen_query",
] as const;

/** Outils explicitement exclus du périmètre public remote. */
export const REMOTE_INTERNAL_TOOLS_EXCLUDED = [
  "list_current_works",
  "list_late_works",
  "generate_internal_dashboard_brief",
] as const;

function getCfg(options?: HttpHandlerOptions): AppConfig {
  if (options?.config) return options.config;
  const cfg = loadConfig();
  assertConfigLimits(cfg);
  return cfg;
}

/**
 * En-têtes CORS du transport HTTP MCP.
 *
 * - Si `MCP_CORS_ALLOWED_ORIGINS=*` (défaut) : `Access-Control-Allow-Origin: *`
 *   (comportement historique, sans cookies).
 * - Sinon, l'origine est echo-back si elle figure dans la liste, et un
 *   `Vary: Origin` est ajouté pour ne pas casser les caches CDN.
 *
 * Headers acceptés : `Authorization, Content-Type, MCP-Protocol-Version`.
 * Méthodes : `GET, POST, OPTIONS` (pas de DELETE — stateless).
 * Pas de `Access-Control-Allow-Credentials` (auth Bearer uniquement).
 */
function corsHeaders(cfg: AppConfig, requestOrigin: string | null): Record<string, string> {
  const allowed = cfg.remote.corsAllowedOrigins;
  const base: Record<string, string> = {
    "access-control-allow-headers": "Authorization, Content-Type, MCP-Protocol-Version",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
  };
  if (allowed.length === 1 && allowed[0] === "*") {
    base["access-control-allow-origin"] = "*";
    return base;
  }
  if (requestOrigin && allowed.includes(requestOrigin)) {
    base["access-control-allow-origin"] = requestOrigin;
    base["vary"] = "Origin";
    return base;
  }
  // Origine non autorisée : on n'émet pas `Access-Control-Allow-Origin`. Le
  // navigateur bloquera la requête côté client. C'est la stratégie la plus
  // simple et la plus prudente (cf. Tâche 7).
  base["vary"] = "Origin";
  return base;
}

function withCorsHeaders(response: Response, cfg: AppConfig, requestOrigin: string | null): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(cfg, requestOrigin))) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Détecte le `tools/call` dans le body JSON-RPC pour appliquer le rate
 * limiting outils lourds. On clone la requête pour ne pas consommer le body.
 */
async function detectToolCallName(req: Request): Promise<string | undefined> {
  if (req.method !== "POST") return undefined;
  try {
    const cloned = req.clone();
    const text = await cloned.text();
    if (!text) return undefined;
    const parsed = JSON.parse(text) as
      | { method?: string; params?: { name?: string } }
      | Array<{ method?: string; params?: { name?: string } }>;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item?.method === "tools/call" && typeof item.params?.name === "string") {
          return item.params.name;
        }
      }
      return undefined;
    }
    if (parsed?.method === "tools/call" && typeof parsed.params?.name === "string") {
      return parsed.params.name;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Wraps a promise with a hard timeout that resolves to a JSON-RPC `-32030`
 * response. We do not abort the underlying transport (the SDK handles its
 * own request lifecycle) — we simply stop waiting for it and return.
 */
async function withRequestTimeout(
  promise: Promise<Response>,
  timeoutMs: number,
): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<Response>(resolveP => {
    timer = setTimeout(() => {
      resolveP(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32030, message: "Request timeout" },
            id: null,
          }),
          { status: 504, headers: { "content-type": "application/json" } },
        ),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let bootWarningEmitted = false;

/**
 * Handler MCP principal. Web standard `Request` → `Response` :
 * compatible Vercel Node functions (Fetch handler), Cloudflare Workers,
 * Deno, Bun, etc.
 */
export async function handleHttpMcpRequest(
  req: Request,
  options?: HttpHandlerOptions,
): Promise<Response> {
  const cfg = getCfg(options);
  const requestOrigin = req.headers.get("origin");

  // 1. Preflight CORS — jamais rate-limité, jamais authentifié.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(cfg, requestOrigin) });
  }

  if (!bootWarningEmitted) {
    bootWarningEmitted = true;
    warnIfPublicTokenMissing({
      bearerRequired: cfg.remote.publicReadToken !== undefined,
      publicOnly: cfg.remote.publicOnly,
    });
  }

  // 2. Rate limiting (avant l'auth, pour limiter le brute-force).
  if (cfg.remote.rateLimitEnabled) {
    const ip = getClientIp(req);
    const toolName = await detectToolCallName(req);
    const { store } = getRateLimitStore();
    const decision = await evaluateRateLimit(
      store,
      {
        enabled: true,
        ipPerMinute: cfg.remote.rateLimitIpPerMinute,
        globalPerMinute: cfg.remote.rateLimitGlobalPerMinute,
        heavyToolPerHour: cfg.remote.rateLimitHeavyToolPerHour,
      },
      { ip, toolName },
    );
    if (!decision.ok && decision.retryAfterSeconds !== undefined) {
      logger.warn("rate_limit.blocked", {
        ip: redactIp(ip),
        reason: decision.reason,
        tool: toolName,
        retryAfterSeconds: decision.retryAfterSeconds,
      });
      return withCorsHeaders(buildRateLimitedResponse(decision.retryAfterSeconds), cfg, requestOrigin);
    }
  }

  // 3. Auth Bearer optionnelle (verrouillée si MCP_PUBLIC_READ_TOKEN défini).
  const auth = checkBearer(req, { expectedToken: cfg.remote.publicReadToken });
  if (!auth.ok && auth.response) {
    logger.info("auth.rejected", { reason: auth.reason });
    return withCorsHeaders(auth.response, cfg, requestOrigin);
  }

  // 4. Création éphémère du serveur MCP en mode stateless avec verrou
  //    public-only + outils internal masqués selon la config.
  const server = createAnnecySigMcpServer(cfg, {
    transport: "http",
    publicOnly: cfg.remote.publicOnly,
    allowInternalTools: cfg.remote.allowInternalTools,
    defaultMode: "public",
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  transport.onerror = err => {
    logger.error("transport.error", { message: err.message });
  };

  // 5. Détecte si l'appel cible un outil lourd pour appliquer le budget dédié.
  const toolName = await detectToolCallName(req);
  const isHeavy = toolName !== undefined && HEAVY_TOOL_NAMES.has(toolName);
  const timeoutMs = isHeavy
    ? Math.min(cfg.remote.heavyToolTimeoutMs, cfg.remote.requestTimeoutMs)
    : cfg.remote.requestTimeoutMs;

  const handlePromise = (async (): Promise<Response> => {
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(req);
      return response;
    } catch (err) {
      logger.error("mcp.handler_error", {
        message: err instanceof Error ? err.message : String(err),
        tool: toolName,
      });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Erreur interne du serveur MCP HTTP." },
          id: null,
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    } finally {
      try {
        await server.close();
      } catch {
        // best-effort
      }
    }
  })();

  const response = await withRequestTimeout(handlePromise, timeoutMs);
  return withCorsHeaders(response, cfg, requestOrigin);
}

/**
 * Handler `/api/health` — diagnostic léger, payload minimal public.
 *
 * Retourne uniquement `status`, `server`, `transport`, `serverVersion`,
 * `mode`, `publicOnly`, `bearerRequired`. Pas d'uptime, pas de stats — voir
 * `handleInternalHealthRequest` pour le diagnostic complet.
 */
export function handleHttpHealthRequest(
  req: Request,
  options?: HttpHandlerOptions,
): Response {
  const requestOrigin = req.headers.get("origin");
  let cfg: AppConfig | undefined;
  try {
    cfg = getCfg(options);
  } catch {
    // On reste minimal même si la config échoue — pas de message exploitable.
    return new Response(
      JSON.stringify({
        status: "error",
        server: "annecy-sig-mcp",
        transport: "http",
      }),
      {
        status: 500,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      },
    );
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(cfg, requestOrigin) });
  }
  const response = handlePublicHealth(cfg);
  return withCorsHeaders(response, cfg, requestOrigin);
}

/**
 * Handler `/api/health/internal` — diagnostic détaillé, **protégé par Bearer**
 * (`MCP_ADMIN_TOKEN`, fallback `MCP_PUBLIC_READ_TOKEN`).
 */
export async function handleHttpInternalHealthRequest(
  req: Request,
  options?: HttpHandlerOptions,
): Promise<Response> {
  const requestOrigin = req.headers.get("origin");
  const cfg = getCfg(options);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(cfg, requestOrigin) });
  }
  const response = await handleInternalHealth(req, { cfg });
  return withCorsHeaders(response, cfg, requestOrigin);
}
