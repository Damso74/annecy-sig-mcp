/**
 * Smoke test HTTP MCP — `npx tsx scripts/smoke-http.ts`
 *
 * Démarre un mini-serveur Node local qui appelle nos handlers Web standard
 * (`handleHttpMcpRequest` / `handleHttpHealthRequest`) en convertissant
 * IncomingMessage ↔ Request (équivalent à ce que fait Vercel pour un Node
 * fetch handler). Cela permet de valider en local, **sans déploiement**, que :
 *
 * 1. `/api/health` répond 200 sans appel ArcGIS.
 * 2. `/api/mcp` expose la **bonne liste d'outils** :
 *    - tous les outils publics attendus sont présents ;
 *    - les outils internal (`generate_internal_dashboard_brief`,
 *      `list_current_works`, `list_late_works`) sont **absents** par défaut.
 * 3. `/api/mcp` refuse explicitement `mode=internal` lors d'un appel d'outil.
 * 4. L'auth Bearer fonctionne (rejet sans token, accès avec token).
 *
 * Le test ne touche pas le portail ArcGIS (toutes les requêtes restent au
 * niveau MCP `tools/list` ou `tools/call` avec un argument qui échoue avant
 * tout appel HTTP — refus du mode internal).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const REQUIRED_PUBLIC_TOOLS = [
  "list_services",
  "list_layers",
  "describe_layer",
  "query_layer",
  "search_nearby",
  "count_layer",
  "detect_data_quality_issues",
  "inventory_all_layers",
  "recommend_open_data_candidates",
  "generate_inventory_report",
  "generate_open_data_brief",
  "generate_chatbot_readiness_report",
  "generate_layer_action_plan",
  // V1.0 — vue travaux **public-light**.
  "list_public_works",
  "search_public_works_nearby",
  // V1.1 — découverte d'intention citoyenne (offline) : 16 outils publics au total.
  "recommend_layers_for_intent",
] as const;

const FORBIDDEN_INTERNAL_TOOLS = [
  "generate_internal_dashboard_brief",
  "list_current_works",
  "list_late_works",
] as const;

const SMOKE_TOKEN = "smoke-token-not-a-secret";

type SmokeReport = {
  ok: boolean;
  results: { name: string; ok: boolean; message: string }[];
};

function log(msg: string): void {
  process.stderr.write(`[smoke-http] ${msg}\n`);
}

/**
 * Convertit un IncomingMessage Node en Request Web standard.
 * Suffisant pour les besoins du smoke (POST/GET, JSON body, headers).
 */
async function nodeReqToWebRequest(req: IncomingMessage, baseUrl: string): Promise<Request> {
  const url = new URL(req.url ?? "/", baseUrl);
  const method = (req.method ?? "GET").toUpperCase();
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item);
    } else {
      headers.set(k, v);
    }
  }
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    init.body = Buffer.concat(chunks);
    // Node fetch n'accepte pas duplex requirement par défaut; pour Buffer pas
    // de souci.
  }
  return new Request(url, init);
}

async function writeWebResponseToNode(res: ServerResponse, webResponse: Response): Promise<void> {
  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (webResponse.body) {
    const nodeStream = Readable.fromWeb(webResponse.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    nodeStream.pipe(res);
    await new Promise<void>((resolveP, rejectP) => {
      nodeStream.on("end", () => resolveP());
      nodeStream.on("error", rejectP);
    });
  } else {
    res.end();
  }
}

async function startLocalServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  // Import dynamique APRÈS avoir fixé l'env, pour que loadConfig() voie le token.
  const { handleHttpMcpRequest, handleHttpHealthRequest } = await import(
    "../src/runtime/httpHandler.js"
  );

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const webReq = await nodeReqToWebRequest(req, "http://127.0.0.1");
        let webRes: Response;
        if (req.url?.startsWith("/api/health")) {
          webRes = handleHttpHealthRequest(webReq);
        } else if (req.url?.startsWith("/api/mcp")) {
          webRes = await handleHttpMcpRequest(webReq);
        } else {
          webRes = new Response("not found", { status: 404 });
        }
        await writeWebResponseToNode(res, webRes);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        );
      }
    })();
  });

  await new Promise<void>(resolveP => server.listen(0, "127.0.0.1", resolveP));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolveP, rejectP) => {
        server.close(err => (err ? rejectP(err) : resolveP()));
      }),
  };
}

async function checkHealth(baseUrl: string): Promise<{ ok: boolean; message: string }> {
  const r = await fetch(`${baseUrl}/api/health`);
  if (r.status !== 200) return { ok: false, message: `status=${r.status}` };
  const body = (await r.json()) as Record<string, unknown>;
  if (body.status !== "ok") return { ok: false, message: `status=${String(body.status)}` };
  if (body.transport !== "http") return { ok: false, message: `transport=${String(body.transport)}` };
  if (body.publicOnly !== true) return { ok: false, message: "publicOnly=false (attendu true en remote)" };
  if (body.internalToolsAllowed !== false) {
    return { ok: false, message: "internalToolsAllowed=true (attendu false par défaut)" };
  }
  return { ok: true, message: `serverVersion=${String(body.serverVersion)}` };
}

async function listToolsViaMcp(baseUrl: string, token?: string): Promise<string[]> {
  const requestInit: RequestInit | undefined = token
    ? { headers: { Authorization: `Bearer ${token}` } }
    : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/mcp`), {
    requestInit,
  });
  const client = new Client(
    { name: "annecy-sig-smoke-http", version: "1.0.0-rc.1" },
    { capabilities: {} },
  );
  await client.connect(transport);
  try {
    const list = await client.listTools();
    return list.tools.map(t => t.name).sort();
  } finally {
    await client.close();
  }
}

async function callToolModeInternal(
  baseUrl: string,
  token?: string,
): Promise<{ refused: boolean; message: string }> {
  const requestInit: RequestInit | undefined = token
    ? { headers: { Authorization: `Bearer ${token}` } }
    : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/mcp`), {
    requestInit,
  });
  const client = new Client(
    { name: "annecy-sig-smoke-http-internal", version: "1.0.0-rc.1" },
    { capabilities: {} },
  );
  await client.connect(transport);
  try {
    const r = await client.callTool({
      name: "list_services",
      arguments: { mode: "internal" },
    });
    const text = JSON.stringify(r);
    const refused = r.isError === true && /HTTP public n'autorise pas le mode internal/.test(text);
    return { refused, message: refused ? "OK refus internal" : `payload=${text.slice(0, 200)}` };
  } finally {
    await client.close();
  }
}

async function expectAuthFailure(baseUrl: string): Promise<{ ok: boolean; message: string }> {
  const r = await fetch(`${baseUrl}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  if (r.status !== 401) return { ok: false, message: `attendu 401, reçu ${r.status}` };
  return { ok: true, message: "401 sans Bearer (attendu)" };
}

/**
 * Vérifie la réponse au preflight CORS sur `/api/mcp`. Aligné sur le hardening
 * V1.0 : Authorization + Content-Type + MCP-Protocol-Version, méthodes
 * GET/POST/OPTIONS, pas de DELETE, pas de credentials.
 */
async function checkCorsPreflight(baseUrl: string): Promise<{ ok: boolean; message: string }> {
  const r = await fetch(`${baseUrl}/api/mcp`, {
    method: "OPTIONS",
    headers: {
      origin: "https://copilot.example.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type, mcp-protocol-version",
    },
  });
  if (r.status !== 204) return { ok: false, message: `attendu 204, reçu ${r.status}` };
  const allowOrigin = r.headers.get("access-control-allow-origin");
  const allowHeaders = r.headers.get("access-control-allow-headers");
  const allowMethods = r.headers.get("access-control-allow-methods");
  const allowCreds = r.headers.get("access-control-allow-credentials");
  if (allowOrigin !== "*") {
    return { ok: false, message: `Allow-Origin=${allowOrigin}` };
  }
  if (allowHeaders !== "Authorization, Content-Type, MCP-Protocol-Version") {
    return { ok: false, message: `Allow-Headers=${allowHeaders}` };
  }
  if (allowMethods !== "GET, POST, OPTIONS") {
    return { ok: false, message: `Allow-Methods=${allowMethods}` };
  }
  if (allowCreds !== null) {
    return { ok: false, message: `Allow-Credentials=${allowCreds} (interdit)` };
  }
  return { ok: true, message: "preflight CORS conforme (no cookies, no DELETE)" };
}

async function main(): Promise<void> {
  // Force la config remote en mode public-only avec auth Bearer activée pour
  // exercer le verrou et l'auth.
  process.env.REMOTE_PUBLIC_ONLY = "true";
  process.env.REMOTE_ALLOW_INTERNAL_TOOLS = "false";
  process.env.MCP_PUBLIC_READ_TOKEN = SMOKE_TOKEN;
  process.env.DEFAULT_MODE = "public";

  const { baseUrl, close } = await startLocalServer();
  log(`serveur local prêt sur ${baseUrl}`);

  const report: SmokeReport = { ok: true, results: [] };
  const record = (name: string, ok: boolean, message: string): void => {
    report.results.push({ name, ok, message });
    if (!ok) report.ok = false;
    log(`${ok ? "OK " : "FAIL"} ${name} — ${message}`);
  };

  try {
    const health = await checkHealth(baseUrl);
    record("health", health.ok, health.message);

    const noAuth = await expectAuthFailure(baseUrl);
    record("auth: 401 sans Bearer", noAuth.ok, noAuth.message);

    const cors = await checkCorsPreflight(baseUrl);
    record("CORS OPTIONS preflight conforme", cors.ok, cors.message);

    const tools = await listToolsViaMcp(baseUrl, SMOKE_TOKEN);
    const missing = REQUIRED_PUBLIC_TOOLS.filter(n => !tools.includes(n));
    const leaked = FORBIDDEN_INTERNAL_TOOLS.filter(n => tools.includes(n));
    record(
      "tools/list contient le périmètre public",
      missing.length === 0,
      missing.length === 0 ? `${tools.length} outils` : `manquants : ${missing.join(", ")}`,
    );
    record(
      "tools/list n'expose pas les outils internal",
      leaked.length === 0,
      leaked.length === 0 ? "OK" : `fuite : ${leaked.join(", ")}`,
    );
    record(
      `tools/list expose exactement le périmètre attendu (${REQUIRED_PUBLIC_TOOLS.length} outils)`,
      tools.length === REQUIRED_PUBLIC_TOOLS.length,
      `attendu ${REQUIRED_PUBLIC_TOOLS.length}, reçu ${tools.length}`,
    );
    record(
      "list_public_works présent dans le remote HTTP",
      tools.includes("list_public_works"),
      tools.includes("list_public_works") ? "OK" : "list_public_works manquant",
    );
    record(
      "search_public_works_nearby présent dans le remote HTTP",
      tools.includes("search_public_works_nearby"),
      tools.includes("search_public_works_nearby") ? "OK" : "search_public_works_nearby manquant",
    );

    const internalRefusal = await callToolModeInternal(baseUrl, SMOKE_TOKEN);
    record(
      "appel mode=internal refusé explicitement",
      internalRefusal.refused,
      internalRefusal.message,
    );
  } finally {
    await close();
  }

  if (report.ok) {
    log("OK — smoke HTTP réussi.");
    process.exit(0);
  }
  log("ÉCHEC — voir détails ci-dessus.");
  process.exit(1);
}

main().catch(err => {
  process.stderr.write(`[smoke-http] erreur fatale : ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
