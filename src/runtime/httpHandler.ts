/**
 * Handler HTTP MCP — utilisé par les routes Vercel `api/mcp.ts` et `api/health.ts`,
 * ainsi que par le smoke test local `scripts/smoke-http.ts`.
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
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadConfig, type AppConfig } from "../config.js";
import { assertConfigLimits } from "../utils/validation.js";
import { createAnnecySigMcpServer } from "../server.js";
import { checkBearer } from "./httpAuth.js";
import { SERVER_VERSION } from "./version.js";
import { getArcgisHttpStats } from "../arcgis/httpClient.js";
import { getLoggerStats } from "./logger.js";

/** Timestamp d'instanciation du module — sert d'uptime baseline. */
const HEALTH_BOOTED_AT = Date.now();

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
 * En-têtes CORS du transport HTTP MCP — alignés sur le hardening V1.0 :
 *
 * - `Access-Control-Allow-Origin: *` — Cursor / Copilot Studio appellent en
 *   serveur-à-serveur, mais on reste ouvert aux clients navigateur (pas de
 *   cookies, donc `*` est sûr) ;
 * - `Access-Control-Allow-Headers` réduit à `Authorization, Content-Type,
 *   MCP-Protocol-Version` — `mcp-session-id` est inutile en stateless ;
 * - `Access-Control-Allow-Methods` réduit à `GET, POST, OPTIONS` — pas de
 *   `DELETE` car aucune session n’est conservée côté serveur ;
 * - **Pas** de `Access-Control-Allow-Credentials: true` — les cookies sont
 *   strictement interdits sur ce transport (auth Bearer uniquement).
 */
function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "Authorization, Content-Type, MCP-Protocol-Version",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
  };
}

/**
 * Handler MCP principal. Web standard `Request` → `Response` :
 * compatible Vercel Node functions (Fetch handler), Cloudflare Workers,
 * Deno, Bun, etc.
 */
export async function handleHttpMcpRequest(
  req: Request,
  options?: HttpHandlerOptions,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const cfg = getCfg(options);

  // 1. Auth Bearer optionnelle (verrouillée si MCP_PUBLIC_READ_TOKEN défini).
  const auth = checkBearer(req, { expectedToken: cfg.remote.publicReadToken });
  if (!auth.ok && auth.response) {
    return withCors(auth.response);
  }

  // 2. Création éphémère du serveur MCP en mode stateless avec verrou
  //    public-only + outils internal masqués selon la config.
  const server = createAnnecySigMcpServer(cfg, {
    transport: "http",
    publicOnly: cfg.remote.publicOnly,
    allowInternalTools: cfg.remote.allowInternalTools,
    defaultMode: "public",
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Mode stateless : pas de session ID renvoyé, pas d'état entre invocations.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // Sécurité : si le client se déconnecte, on ferme proprement (n'a quasiment
  // pas d'effet en stateless mais évite des warnings côté SDK).
  transport.onerror = err => {
    // stderr uniquement.
    // eslint-disable-next-line no-console
    console.error("[mcp-http] transport error:", err.message);
  };

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(req);
    return withCors(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[mcp-http] handler error:", err instanceof Error ? err.message : err);
    return withCors(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Erreur interne du serveur MCP HTTP.",
          },
          id: null,
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );
  } finally {
    // Best-effort cleanup. `server.close()` ferme aussi le transport rattaché.
    try {
      await server.close();
    } catch {
      // best-effort
    }
  }
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Handler `/api/health` — diagnostic léger uniquement. **Aucun appel ArcGIS** :
 * on confirme seulement que le serveur est monté et que la config se charge
 * sans exception.
 */
export function handleHttpHealthRequest(
  _req: Request,
  options?: HttpHandlerOptions,
): Response {
  let cfgError: string | undefined;
  let mode: "public" | "internal" = "public";
  let publicOnly = true;
  let internalToolsAllowed = false;
  let bearerRequired = false;

  try {
    const cfg = getCfg(options);
    mode = cfg.remote.publicOnly ? "public" : cfg.defaultMode;
    publicOnly = cfg.remote.publicOnly;
    internalToolsAllowed = cfg.remote.allowInternalTools;
    bearerRequired = cfg.remote.publicReadToken !== undefined;
  } catch (e) {
    cfgError = e instanceof Error ? e.message : String(e);
  }

  const httpStats = getArcgisHttpStats();
  const loggerStats = getLoggerStats();
  const body = {
    status: cfgError ? "error" : "ok",
    server: "annecy-sig-mcp",
    mode,
    transport: "http" as const,
    serverVersion: SERVER_VERSION,
    publicOnly,
    internalToolsAllowed,
    bearerRequired,
    uptimeMs: Date.now() - HEALTH_BOOTED_AT,
    runtime: {
      arcgis: httpStats,
      tools: loggerStats,
    },
    ...(cfgError ? { error: cfgError } : {}),
  };

  return new Response(JSON.stringify(body), {
    status: cfgError ? 500 : 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...corsHeaders(),
    },
  });
}
