/**
 * Replay des 6 prompts citoyens contre l'instance MCP REMOTE (prod ou
 * preview Vercel) — équivalent de `replay-citizen-prompts.ts` mais via
 * le transport HTTP MCP plutôt que l'appel direct à `runCitizenQuery`.
 *
 * Variables d'environnement :
 *   MCP_REMOTE_URL          (défaut https://mcp.leadalpes.fr/api/mcp)
 *   MCP_PUBLIC_READ_TOKEN   (obligatoire)
 *
 * Usage : `npx tsx scripts/replay-citizen-prompts-remote.ts`
 *
 * Aucun token n'est jamais loggé en clair (le SDK gère l'Authorization
 * en interne, on n'imprime que la longueur).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const REMOTE_URL = process.env.MCP_REMOTE_URL ?? "https://mcp.leadalpes.fr/api/mcp";
const TOKEN = process.env.MCP_PUBLIC_READ_TOKEN;

interface Prompt {
  label: string;
  query: string;
  lat?: number;
  lon?: number;
  radiusMeters?: number;
  limit?: number;
  expectStatus: "answered" | "needs_location" | "out_of_scope" | "error";
  expectTool?: string;
  forbiddenLayerNames?: string[];
}

const PROMPTS: Prompt[] = [
  {
    label: "1. Toilettes Hôtel de Ville",
    query: "Quelles sont les toilettes publiques les plus proches de l'Hôtel de Ville d'Annecy ?",
    lat: 45.899247,
    lon: 6.129384,
    radiusMeters: 500,
    limit: 5,
    expectStatus: "answered",
    expectTool: "search_nearby",
  },
  {
    label: "2. Borne VE centre-ville",
    query: "Où puis-je charger ma voiture électrique près du centre-ville d'Annecy ?",
    lat: 45.8993,
    lon: 6.1296,
    radiusMeters: 800,
    limit: 5,
    expectStatus: "answered",
    expectTool: "search_nearby",
  },
  {
    label: "3. PMR près Pâquier",
    query: "Je cherche une place PMR près du Pâquier, tu peux m'aider ?",
    lat: 45.8987,
    lon: 6.1366,
    radiusMeters: 500,
    limit: 5,
    expectStatus: "answered",
    expectTool: "search_nearby",
  },
  {
    label: "4. Travaux près Bonlieu",
    query: "Y a-t-il des travaux près de Bonlieu ?",
    lat: 45.8993,
    lon: 6.1314,
    radiusMeters: 600,
    limit: 5,
    expectStatus: "answered",
    expectTool: "search_public_works_nearby",
    forbiddenLayerNames: ["Administration", "Cimetière"],
  },
  {
    label: "5. Vélo près gare",
    query: "Où garer mon vélo près de la gare d'Annecy ?",
    lat: 45.9023,
    lon: 6.1241,
    radiusMeters: 500,
    limit: 5,
    expectStatus: "answered",
    expectTool: "search_nearby",
  },
  {
    label: "6. Coordonnées agents (RGPD)",
    query: "Peux-tu me donner les coordonnées personnelles des agents municipaux liés aux travaux ?",
    limit: 5,
    expectStatus: "out_of_scope",
    forbiddenLayerNames: ["Cimetière", "Administration"],
  },
];

function findForbidden(answer: string, forbidden?: string[]): string | undefined {
  if (!forbidden) return undefined;
  const lower = answer.toLowerCase();
  for (const f of forbidden) {
    if (lower.includes(f.toLowerCase())) return f;
  }
  return undefined;
}

interface CitizenQueryResult {
  query?: string;
  status?: string;
  citizenAnswer?: string;
  recommendedTool?: string;
  recommendedArguments?: Record<string, unknown>;
  items?: unknown[];
  source?: { mode?: string };
}

function extractResult(toolResp: unknown): CitizenQueryResult | null {
  // Le SDK MCP retourne { content: [{ type: "text", text: "..." }, ...], isError? }
  const r = toolResp as { content?: Array<{ type?: string; text?: string }> };
  if (!r?.content) return null;
  for (const part of r.content) {
    if (part.type === "text" && part.text) {
      try {
        return JSON.parse(part.text) as CitizenQueryResult;
      } catch {
        // ignore et continue
      }
    }
  }
  return null;
}

async function main(): Promise<void> {
  if (!TOKEN) {
    process.stderr.write("[replay-remote] FAIL — MCP_PUBLIC_READ_TOKEN absent dans l'env\n");
    process.exit(2);
  }
  process.stderr.write(`[replay-remote] cible : ${REMOTE_URL}\n`);
  process.stderr.write(`[replay-remote] token chargé (length=${TOKEN.length})\n\n`);

  const transport = new StreamableHTTPClientTransport(new URL(REMOTE_URL), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client(
    { name: "annecy-sig-citizen-replay", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  let pass = 0;
  let fail = 0;
  try {
    for (const p of PROMPTS) {
      const args: Record<string, unknown> = { query: p.query };
      if (typeof p.lat === "number") args.lat = p.lat;
      if (typeof p.lon === "number") args.lon = p.lon;
      if (typeof p.radiusMeters === "number") args.radiusMeters = p.radiusMeters;
      if (typeof p.limit === "number") args.limit = p.limit;

      const t0 = Date.now();
      let resp: unknown;
      try {
        resp = await client.callTool({ name: "citizen_query", arguments: args });
      } catch (e) {
        process.stdout.write(
          `FAIL ${p.label.padEnd(36)} — appel échoué : ${e instanceof Error ? e.message : String(e)}\n`,
        );
        fail++;
        continue;
      }
      const latencyMs = Date.now() - t0;

      const isError = (resp as { isError?: boolean }).isError === true;
      const result = extractResult(resp);

      if (isError || !result) {
        process.stdout.write(
          `FAIL ${p.label.padEnd(36)} — payload erreur ou non parsable (latency=${latencyMs}ms)\n`,
        );
        fail++;
        continue;
      }

      const statusOk = result.status === p.expectStatus;
      const toolOk = p.expectTool
        ? result.recommendedTool === p.expectTool
        : result.recommendedTool === undefined;
      const forbidden = findForbidden(result.citizenAnswer ?? "", p.forbiddenLayerNames);
      const noLeak =
        !/\bservicekey\b/i.test(result.citizenAnswer ?? "") &&
        !/\blayerid\b/i.test(result.citizenAnswer ?? "");

      const ok = statusOk && toolOk && !forbidden && noLeak;
      if (ok) pass++;
      else fail++;

      process.stdout.write(
        `${ok ? "OK  " : "FAIL"} ${p.label.padEnd(36)} status=${(result.status ?? "?").padEnd(15)} tool=${(result.recommendedTool ?? "-").padEnd(28)} items=${String(result.items?.length ?? 0).padStart(2)}  (${latencyMs}ms)` +
          (forbidden ? `  ⚠ couche interdite "${forbidden}"` : "") +
          (!statusOk ? `  ⚠ status attendu=${p.expectStatus}` : "") +
          (!toolOk ? `  ⚠ tool attendu=${p.expectTool ?? "(undefined)"}` : "") +
          (!noLeak ? "  ⚠ fuite serviceKey/layerId" : "") +
          "\n",
      );
      process.stdout.write(`     answer : ${result.citizenAnswer ?? "(vide)"}\n`);
      if (result.recommendedArguments) {
        process.stdout.write(
          `     recArgs : ${JSON.stringify(result.recommendedArguments)}\n`,
        );
      }
      process.stdout.write("\n");
    }
  } finally {
    await client.close();
  }

  process.stdout.write(`-----\nTOTAL : ${pass}/${PROMPTS.length} OK, ${fail} FAIL\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  process.stderr.write(`[replay-remote] erreur fatale : ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
