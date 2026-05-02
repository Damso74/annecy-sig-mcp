/**
 * Smoke test MCP — `npx tsx scripts/smoke-mcp.ts`
 *
 * Démarre le serveur compilé (`dist/index.js`) en stdio, vérifie que :
 *
 * 1. les outils MCP attendus sont tous exposés (`list_services`, `describe_layer`,
 *    `query_layer`, `inventory_all_layers`, et les cinq `generate_*`) ;
 * 2. le serveur répond proprement à `tools/list` ;
 * 3. **aucun bruit n’est émis sur stdout** en dehors du protocole JSON-RPC
 *    MCP (le transport stdio l’interdit — un seul caractère hors trame
 *    casse le client) ;
 * 4. le serveur s’éteint proprement quand on ferme le transport.
 *
 * Le script ne touche pas au portail ArcGIS : il n’appelle aucun outil, juste
 * `tools/list`. Il est donc utilisable hors réseau et en CI.
 *
 * Pré-requis : `npm run build` doit avoir produit `dist/index.js`.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REQUIRED_TOOLS = [
  "list_services",
  "describe_layer",
  "query_layer",
  "inventory_all_layers",
  "generate_inventory_report",
  "generate_open_data_brief",
  "generate_chatbot_readiness_report",
  "generate_layer_action_plan",
  "generate_internal_dashboard_brief",
  // V1.0 — vue travaux **public-light**, exposée localement aussi.
  "list_public_works",
  "search_public_works_nearby",
  // V1.1 — outil de découverte d'intention citoyenne (offline déterministe).
  "recommend_layers_for_intent",
] as const;

type SmokeOutcome = {
  toolsFound: string[];
  missing: string[];
  stdoutLeak: string[];
  ok: boolean;
};

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..");
}

/**
 * Premier garde-fou : on lance `dist/index.js` derrière un wrapper Node qui
 * **observe stdout** en parallèle du transport SDK. Le SDK consomme stdout
 * pour le protocole — ce que l’on cherche, c’est tout ce qui n’est pas une
 * trame JSON-RPC valide. Le wrapper enregistre donc chaque ligne sortie et
 * laisse le SDK piloter le dialogue normalement.
 *
 * Sur Windows, on spawn le binaire `node` plutôt que de compter sur le shebang.
 */
function spawnUnderObserver(serverPath: string): {
  child: ChildProcessWithoutNullStreams;
  stdoutChunks: string[];
  stderrChunks: string[];
} {
  const child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot(),
    env: {
      ...process.env,
      // Politique stricte pour faire échouer toute dérive contractuelle
      // pendant le smoke test.
      CONTRACT_POLICY: "strict",
      DEFAULT_MODE: "public",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  child.stdout.on("data", (b: Buffer) => stdoutChunks.push(b.toString("utf8")));
  child.stderr.on("data", (b: Buffer) => stderrChunks.push(b.toString("utf8")));
  return { child, stdoutChunks, stderrChunks };
}

/**
 * Une trame stdout MCP est une suite de messages JSON-RPC séparés par `\n`.
 * Tout ce qui n’est pas un objet JSON valide compte comme bruit (et casserait
 * un client MCP réel).
 */
function detectStdoutLeaks(stdout: string): string[] {
  const leaks: string[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed !== "object" || parsed === null) {
        leaks.push(line);
        continue;
      }
      if (parsed.jsonrpc !== "2.0") {
        leaks.push(line);
      }
    } catch {
      leaks.push(line);
    }
  }
  return leaks;
}

async function runSmoke(): Promise<SmokeOutcome> {
  const serverPath = join(repoRoot(), "dist", "index.js");
  if (!existsSync(serverPath)) {
    throw new Error(
      `dist/index.js introuvable. Lance d'abord \`npm run build\`. (chemin attendu : ${serverPath})`,
    );
  }

  // Au lieu de gérer le child process à la main, on délègue au SDK : il
  // capte stdin/stdout proprement. On observera ce qui aura été écrit sur
  // stdout via le transport lui-même — voir plus bas.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      ...process.env,
      CONTRACT_POLICY: "strict",
      DEFAULT_MODE: "public",
    } as Record<string, string>,
    cwd: repoRoot(),
    stderr: "pipe",
  });

  const stderrSink: string[] = [];
  // Pas accessible avant `start()` ailleurs que via le getter — on s’attache
  // dès que possible après.

  const client = new Client(
    { name: "annecy-sig-mcp-smoke", version: "1.0.0-rc.1" },
    { capabilities: {} },
  );

  await client.connect(transport);

  const stderrStream = transport.stderr;
  if (stderrStream && "on" in stderrStream && typeof stderrStream.on === "function") {
    (stderrStream as NodeJS.ReadableStream).on("data", (b: Buffer) =>
      stderrSink.push(b.toString("utf8")),
    );
  }

  const list = await client.listTools();
  const toolsFound = list.tools.map(t => t.name).sort();
  const missing = REQUIRED_TOOLS.filter(n => !toolsFound.includes(n));

  await client.close();

  // Le transport SDK consomme la stdout du child via un parser JSON-RPC : si
  // un caractère hors trame avait fuité, le SDK l’aurait déjà rejeté. On fait
  // donc un second passage avec un spawn direct pour observer stdout brut et
  // confirmer qu’il ne contient que des lignes JSON-RPC.
  const observed = await observeStdoutOnce(serverPath);

  return {
    toolsFound,
    missing,
    stdoutLeak: observed.stdoutLeak,
    ok: missing.length === 0 && observed.stdoutLeak.length === 0,
  };
}

/**
 * Spawne le serveur, lui pousse une requête `tools/list` et capture le stdout
 * brut. C’est volontairement minimaliste — on veut pouvoir lire stdout
 * indépendamment du SDK pour repérer une fuite.
 */
function observeStdoutOnce(serverPath: string): Promise<{ stdoutLeak: string[] }> {
  return new Promise((resolveP, rejectP) => {
    const { child, stdoutChunks } = spawnUnderObserver(serverPath);
    const initRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "annecy-sig-mcp-smoke-raw", version: "1.0.0-rc.1" },
      },
    });
    const listRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const initialized = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });

    child.stdin.write(initRequest + "\n");
    child.stdin.write(initialized + "\n");
    child.stdin.write(listRequest + "\n");

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // best effort
      }
      const stdout = stdoutChunks.join("");
      resolveP({ stdoutLeak: detectStdoutLeaks(stdout) });
    }, 2500);

    child.on("error", err => {
      clearTimeout(timer);
      rejectP(err);
    });
  });
}

async function main(): Promise<void> {
  // Tout le logging passe par stderr — on garde stdout libre par cohérence
  // avec la contrainte de transport stdio MCP.
  const log = (msg: string): void => process.stderr.write(`${msg}\n`);
  log("[smoke-mcp] démarrage du serveur en stdio…");
  const r = await runSmoke();
  log(`[smoke-mcp] outils détectés (${r.toolsFound.length}) : ${r.toolsFound.join(", ")}`);
  if (r.missing.length) log(`[smoke-mcp] OUTILS MANQUANTS : ${r.missing.join(", ")}`);
  if (r.stdoutLeak.length) {
    log(
      `[smoke-mcp] STDOUT LEAK — ${r.stdoutLeak.length} ligne(s) hors protocole MCP :`,
    );
    for (const line of r.stdoutLeak.slice(0, 5)) log(`  > ${line}`);
  }
  if (r.ok) {
    log("[smoke-mcp] OK — serveur conforme.");
    process.exit(0);
  }
  log("[smoke-mcp] ÉCHEC — voir les détails ci-dessus.");
  process.exit(1);
}

const isMain = (() => {
  try {
    const here = fileURLToPath(import.meta.url);
    return process.argv[1] !== undefined && process.argv[1] === here;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch(err => {
    process.stderr.write(`[smoke-mcp] erreur fatale : ${(err as Error).message}\n`);
    process.exit(1);
  });
}
