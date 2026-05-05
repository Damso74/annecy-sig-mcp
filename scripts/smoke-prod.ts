/**
 * Smoke test prod — `npm run smoke:prod`
 *
 * Cible une URL déployée (`mcp.leadalpes.fr` par défaut) et vérifie le
 * comportement attendu côté public sans **jamais** afficher le token ni
 * l'en-tête Authorization.
 *
 * Variables d'environnement :
 * - `MCP_REMOTE_URL`         (défaut https://mcp.leadalpes.fr/api/mcp)
 * - `MCP_REMOTE_HEALTH_URL`  (défaut https://mcp.leadalpes.fr/api/health)
 * - `MCP_PUBLIC_READ_TOKEN`  (obligatoire pour exécuter `tools/list`)
 *
 * Sortie :
 * - OK / FAIL par étape (sur stderr)
 * - exit 0 si succès complet, 1 sinon
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const REMOTE_URL = process.env.MCP_REMOTE_URL ?? "https://mcp.leadalpes.fr/api/mcp";
const HEALTH_URL = process.env.MCP_REMOTE_HEALTH_URL ?? "https://mcp.leadalpes.fr/api/health";
const TOKEN = process.env.MCP_PUBLIC_READ_TOKEN;

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
  "recommend_layers_for_intent",
  "generate_inventory_report",
  "generate_open_data_brief",
  "generate_chatbot_readiness_report",
  "generate_layer_action_plan",
  "list_public_works",
  "search_public_works_nearby",
  "citizen_query",
];

const FORBIDDEN_INTERNAL_TOOLS = [
  "list_current_works",
  "list_late_works",
  "generate_internal_dashboard_brief",
];

type Step = { name: string; ok: boolean; message: string };
const steps: Step[] = [];

function log(msg: string): void {
  process.stderr.write(`[smoke-prod] ${msg}\n`);
}

function record(name: string, ok: boolean, message: string): void {
  steps.push({ name, ok, message });
  log(`${ok ? "OK  " : "FAIL"} ${name} — ${message}`);
}

/**
 * Ne jamais inclure de token dans un message vers stderr.
 */
function safe(s: string): string {
  // Si jamais le token est tombé dans une string par accident, on le masque
  // avant log.
  if (TOKEN && s.includes(TOKEN)) return s.replace(TOKEN, "<redacted>");
  return s;
}

async function checkPublicHealth(): Promise<void> {
  try {
    const res = await fetch(HEALTH_URL);
    const body = (await res.json()) as Record<string, unknown>;
    if (res.status !== 200) {
      record("public health", false, `status=${res.status}`);
      return;
    }
    if (body.status !== "ok") {
      record("public health", false, `payload status=${String(body.status)}`);
      return;
    }
    if (body.publicOnly !== true) {
      record("public health", false, "publicOnly attendu true");
      return;
    }
    if ("uptimeMs" in body || "runtime" in body || "rateLimit" in body) {
      record("public health", false, "payload public ne doit pas exposer uptime/runtime/rateLimit");
      return;
    }
    record("public health minimal", true, `serverVersion=${String(body.serverVersion)}`);
  } catch (e) {
    record("public health", false, safe(e instanceof Error ? e.message : String(e)));
  }
}

async function checkAuth401(): Promise<void> {
  try {
    const r = await fetch(REMOTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    if (r.status === 401) {
      record("/api/mcp sans Bearer → 401", true, "OK");
    } else {
      record("/api/mcp sans Bearer → 401", false, `status=${r.status}`);
    }
  } catch (e) {
    record("/api/mcp sans Bearer → 401", false, safe(e instanceof Error ? e.message : String(e)));
  }
}

async function listToolsViaMcp(): Promise<string[] | null> {
  if (!TOKEN) {
    record("tools/list avec Bearer", false, "MCP_PUBLIC_READ_TOKEN absent dans l'env du runner");
    return null;
  }
  const transport = new StreamableHTTPClientTransport(new URL(REMOTE_URL), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client(
    { name: "annecy-sig-smoke-prod", version: "1.0.0-rc.1" },
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

async function callInternalRefusal(): Promise<void> {
  if (!TOKEN) return;
  const transport = new StreamableHTTPClientTransport(new URL(REMOTE_URL), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client(
    { name: "annecy-sig-smoke-prod-internal", version: "1.0.0-rc.1" },
    { capabilities: {} },
  );
  try {
    await client.connect(transport);
    const r = await client.callTool({
      name: "list_services",
      arguments: { mode: "internal" },
    });
    const text = JSON.stringify(r);
    const refused =
      r.isError === true &&
      /HTTP public n'autorise pas le mode internal/.test(text);
    record(
      "mode=internal refusé en prod",
      refused,
      refused ? "OK" : `payload inattendu (taille=${text.length})`,
    );
  } catch (e) {
    record("mode=internal refusé en prod", false, safe(e instanceof Error ? e.message : String(e)));
  } finally {
    await client.close();
  }
}

async function callCitizenQuery(): Promise<void> {
  if (!TOKEN) return;
  const transport = new StreamableHTTPClientTransport(new URL(REMOTE_URL), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client(
    { name: "annecy-sig-smoke-prod-citizen", version: "1.0.0-rc.1" },
    { capabilities: {} },
  );
  try {
    await client.connect(transport);
    // Préfère citizen_query si disponible, sinon fallback recommend_layers_for_intent.
    const r = await client.callTool({
      name: "citizen_query",
      arguments: { query: "toilettes publiques proches de la mairie d'Annecy" },
    });
    const text = JSON.stringify(r);
    if (r.isError === true) {
      record("citizen_query (toilettes mairie)", false, `payload erreur (taille=${text.length})`);
    } else {
      record("citizen_query (toilettes mairie)", true, `payload OK (taille=${text.length})`);
    }
  } catch (e) {
    record("citizen_query (toilettes mairie)", false, safe(e instanceof Error ? e.message : String(e)));
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  if (!TOKEN) {
    log("⚠ MCP_PUBLIC_READ_TOKEN absent — seules les étapes anonymes seront exécutées.");
  } else {
    log("MCP_PUBLIC_READ_TOKEN détecté (masqué en logs).");
  }
  log(`URL santé : ${HEALTH_URL}`);
  log(`URL MCP   : ${REMOTE_URL}`);

  await checkPublicHealth();
  await checkAuth401();

  if (TOKEN) {
    let tools: string[] | null = null;
    try {
      tools = await listToolsViaMcp();
    } catch (e) {
      record("tools/list avec Bearer", false, safe(e instanceof Error ? e.message : String(e)));
    }
    if (tools) {
      const missing = REQUIRED_PUBLIC_TOOLS.filter(n => !tools!.includes(n));
      const leaked = FORBIDDEN_INTERNAL_TOOLS.filter(n => tools!.includes(n));
      record(
        "tools/list contient le périmètre public",
        missing.length === 0,
        missing.length === 0 ? `${tools.length} outils` : `manquants: ${missing.join(", ")}`,
      );
      record(
        "tools/list n'expose aucun outil internal",
        leaked.length === 0,
        leaked.length === 0 ? "OK" : `fuite: ${leaked.join(", ")}`,
      );
    }
    await callInternalRefusal();
    await callCitizenQuery();
  }

  const ok = steps.every(s => s.ok);
  if (ok) {
    log("OK — smoke prod réussi.");
    process.exit(0);
  }
  log("ÉCHEC — voir détails ci-dessus.");
  process.exit(1);
}

main().catch(err => {
  process.stderr.write(`[smoke-prod] erreur fatale : ${safe(err instanceof Error ? err.stack ?? err.message : String(err))}\n`);
  process.exit(1);
});
