/**
 * Recette terrain — exécution non-interactive des 6 prompts MCP.
 *
 * Reproduit hors Cursor exactement ce que fait Cursor : démarre `dist/index.js`
 * en stdio via le SDK MCP officiel, appelle les 6 outils de `docs/RECETTE_TERRAIN.md`
 * dans l'ordre, et écrit les résultats dans `outputs/recette-terrain-<ts>/`.
 *
 * Aucun secret. Lecture seule. Mode public/internal selon prompt.
 *
 * Usage : `npx tsx scripts/recette-terrain.ts`
 *
 * Sortie : un fichier par prompt (`prompt-N.json` + extrait `prompt-N.md`),
 * plus un `summary.json` listant les check-lists.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SENSITIVE_MARKERS = [
  "url_pj",
  "url_piece_jointe",
  "created_user",
  "created_date",
  "last_edited_user",
  "last_edited_date",
  "token",
  "password",
  "secret",
  "bearer",
  "attachment",
];

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..");
}

interface PromptResult {
  name: string;
  ok: boolean;
  notes: string[];
  sensitiveLeaks: { marker: string; sample: string }[];
  textContent?: string;
  structuredContent?: unknown;
}

function detectSensitive(payload: string): { marker: string; sample: string }[] {
  const leaks: { marker: string; sample: string }[] = [];
  const lower = payload.toLowerCase();
  for (const marker of SENSITIVE_MARKERS) {
    const idx = lower.indexOf(marker);
    if (idx >= 0) {
      const start = Math.max(0, idx - 30);
      const end = Math.min(payload.length, idx + marker.length + 30);
      leaks.push({ marker, sample: payload.slice(start, end) });
    }
  }
  return leaks;
}

interface CallToolResultLike {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

function extractText(res: CallToolResultLike): { text: string; structured?: unknown } {
  const text = (res.content ?? [])
    .filter(c => c.type === "text" && typeof c.text === "string")
    .map(c => c.text as string)
    .join("\n");
  let structured = res.structuredContent;
  if (structured === undefined && text.trim().length > 0) {
    try {
      structured = JSON.parse(text);
    } catch {
      // ignore — text n'était pas du JSON pur
    }
  }
  // Les outils `generate_*` retournent un payload enveloppe
  // { format, body, structured } — on déballe pour exposer `structured`.
  if (
    structured !== null &&
    typeof structured === "object" &&
    "format" in (structured as Record<string, unknown>) &&
    "structured" in (structured as Record<string, unknown>)
  ) {
    structured = (structured as Record<string, unknown>).structured;
  }
  return { text, structured };
}

/**
 * Marqueurs sensibles dans une zone de payload, en EXCLUANT les listes
 * documentaires de champs filtrés — c'est leur rôle de nommer les champs
 * filtrés.
 */
function detectSensitiveOutsideIgnoredLists(
  payload: string,
): { marker: string; sample: string }[] {
  const stripped = payload
    .replace(/"ignoredFieldsPreview"\s*:\s*\[[^\]]*\]/g, '"ignoredFieldsPreview":[]')
    .replace(/"ignoredFields"\s*:\s*\[[^\]]*\]/g, '"ignoredFields":[]')
    .replace(/"removedFields"\s*:\s*\[[^\]]*\]/g, '"removedFields":[]')
    .replace(/"filteredFields"\s*:\s*\[[^\]]*\]/g, '"filteredFields":[]');
  return detectSensitive(stripped);
}

async function withClient<T>(handler: (client: Client) => Promise<T>): Promise<T> {
  const serverPath = join(repoRoot(), "dist", "index.js");
  if (!existsSync(serverPath)) {
    throw new Error(`dist/index.js introuvable. Lance d'abord \`npm run build\`.`);
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      ...process.env,
      ANNECY_SIG_BASE_URL:
        process.env.ANNECY_SIG_BASE_URL ?? "https://portailsig.annecy.fr/server/rest/services",
      DEFAULT_MODE: "public",
      CONTRACT_POLICY: "warn",
    } as Record<string, string>,
    cwd: repoRoot(),
    stderr: "pipe",
  });
  const client = new Client(
    { name: "annecy-sig-mcp-recette", version: "1.0.0-rc.1" },
    { capabilities: {} },
  );
  await client.connect(transport);
  try {
    return await handler(client);
  } finally {
    await client.close();
  }
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResultLike> {
  return (await client.callTool({ name, arguments: args })) as CallToolResultLike;
}

function check(notes: string[], cond: boolean, label: string): void {
  notes.push(`${cond ? "OK " : "KO "} ${label}`);
}

async function runPrompts(): Promise<PromptResult[]> {
  return withClient(async client => {
    const out: PromptResult[] = [];

    {
      const res = await callTool(client, "list_services", { mode: "public" });
      const { text, structured } = extractText(res);
      const payload = `${text}\n${JSON.stringify(structured ?? {})}`;
      const leaks = detectSensitive(payload);
      const notes: string[] = [];
      const struct = (structured ?? {}) as Record<string, unknown>;
      const services =
        (struct.services as Array<Record<string, unknown>> | undefined) ?? [];
      const equipementsSvc = services.find(s => s.serviceKey === "equipements");
      const mobiliteSvc = services.find(s => s.serviceKey === "mobilite");
      const travauxSvc = services.find(s => s.serviceKey === "travaux");
      const travauxLayersExposed =
        travauxSvc !== undefined && Number(travauxSvc.layersCount ?? 0) > 0;
      check(notes, equipementsSvc !== undefined, "service public 'equipements' visible");
      check(notes, mobiliteSvc !== undefined, "service public 'mobilite' visible");
      check(
        notes,
        !travauxLayersExposed,
        `couches 'travaux' non exposées en public (layersCount=${
          travauxSvc?.layersCount ?? "n/a"
        })`,
      );
      check(notes, leaks.length === 0, "aucun marqueur sensible");
      out.push({
        name: "Prompt 1 — list_services public",
        ok:
          equipementsSvc !== undefined &&
          mobiliteSvc !== undefined &&
          !travauxLayersExposed &&
          leaks.length === 0 &&
          !res.isError,
        notes,
        sensitiveLeaks: leaks,
        textContent: text,
        structuredContent: structured,
      });
    }

    {
      const res = await callTool(client, "describe_layer", {
        mode: "public",
        serviceKey: "equipements",
        layerId: 5,
      });
      const { text, structured } = extractText(res);
      const payload = `${text}\n${JSON.stringify(structured ?? {})}`;
      const leaks = detectSensitiveOutsideIgnoredLists(payload);
      const notes: string[] = [];
      const struct = (structured ?? {}) as Record<string, unknown>;
      const fa = struct.fieldAlignment as Record<string, unknown> | undefined;
      const exposedFields =
        (struct.exposedFields as Array<Record<string, unknown>> | undefined) ?? [];
      const exposedNames = exposedFields
        .map(f => String(f.name ?? "").toLowerCase())
        .join(",");
      const exposedHasSensitive = SENSITIVE_MARKERS.some(m => exposedNames.includes(m));
      const hasSupportsQuery = typeof struct.supportsQuery === "boolean";
      const geom = struct.geometryType as string | undefined;
      check(notes, !exposedHasSensitive, "exposedFields sans marqueur sensible");
      check(
        notes,
        Array.isArray(fa?.ignoredFieldsPreview),
        "fieldAlignment.ignoredFieldsPreview présent",
      );
      check(notes, hasSupportsQuery, `supportsQuery présent (${String(struct.supportsQuery)})`);
      check(notes, typeof geom === "string", `geometryType présent (${geom ?? "?"})`);
      check(notes, leaks.length === 0, "aucun marqueur sensible global");
      out.push({
        name: "Prompt 2 — describe_layer equipements/5 public",
        ok:
          !exposedHasSensitive &&
          Array.isArray(fa?.ignoredFieldsPreview) &&
          hasSupportsQuery &&
          typeof geom === "string" &&
          leaks.length === 0 &&
          !res.isError,
        notes,
        sensitiveLeaks: leaks,
        textContent: text,
        structuredContent: structured,
      });
    }

    {
      const res = await callTool(client, "generate_chatbot_readiness_report", {
        mode: "public",
        format: "json",
      });
      const { text, structured } = extractText(res);
      const payload = `${text}\n${JSON.stringify(structured ?? {})}`;
      const leaks = detectSensitiveOutsideIgnoredLists(payload);
      const notes: string[] = [];
      const struct = (structured ?? {}) as Record<string, unknown>;
      const source = struct.source as Record<string, unknown> | undefined;
      const schemaVersion = source?.schemaVersion as string | undefined;
      const serverVersion = source?.serverVersion as string | undefined;
      const perLayer = (struct.perLayer as Array<Record<string, unknown>> | undefined) ?? [];
      const safeRulesNonEmpty = perLayer.some(p => {
        const r = p.safeAnswerRules as unknown[] | undefined;
        return Array.isArray(r) && r.length > 0;
      });
      check(
        notes,
        schemaVersion === "chatbot_readiness.v1",
        `schemaVersion = ${schemaVersion ?? "?"}`,
      );
      check(notes, typeof serverVersion === "string", `serverVersion = ${serverVersion ?? "?"}`);
      check(notes, safeRulesNonEmpty, "perLayer[].safeAnswerRules non vide pour ≥1 couche");
      check(notes, leaks.length === 0, "aucun marqueur sensible");
      out.push({
        name: "Prompt 3 — generate_chatbot_readiness_report public json",
        ok:
          schemaVersion === "chatbot_readiness.v1" &&
          typeof serverVersion === "string" &&
          safeRulesNonEmpty &&
          leaks.length === 0 &&
          !res.isError,
        notes,
        sensitiveLeaks: leaks,
        textContent: text,
        structuredContent: structured,
      });
    }

    {
      const res = await callTool(client, "generate_open_data_brief", {
        mode: "public",
        format: "markdown",
      });
      const { text, structured } = extractText(res);
      const payload = `${text}\n${JSON.stringify(structured ?? {})}`;
      const leaks = detectSensitiveOutsideIgnoredLists(payload);
      const notes: string[] = [];
      const struct = (structured ?? {}) as Record<string, unknown>;
      const source = struct.source as Record<string, unknown> | undefined;
      const schemaVersion = source?.schemaVersion as string | undefined;
      const serverVersion = source?.serverVersion as string | undefined;
      // Le contrat open_data.v1 expose plusieurs sections de recommandations.
      // La check-list de RECETTE_TERRAIN parle de `recommendedNextActions` :
      // on vérifie l'esprit (au moins une liste de recommandations non vide).
      const opSynthesis = struct.operationalSynthesis as Record<string, unknown> | undefined;
      const recommendationLists: unknown[] = [
        struct.quickWins,
        struct.plan30Days,
        struct.validationsNeeded,
        opSynthesis?.quickWins7Days,
        opSynthesis?.plan30Days,
        opSynthesis?.arbitragesNecessaires,
        opSynthesis?.questionsSigMetier,
      ];
      const recommendedNonEmpty = recommendationLists.some(
        l => Array.isArray(l) && l.length > 0,
      );
      const travauxInGreen = /\btravaux\b[^\n]*\bGREEN\b/i.test(text);
      check(notes, schemaVersion === "open_data.v1", `schemaVersion = ${schemaVersion ?? "?"}`);
      check(notes, typeof serverVersion === "string", `serverVersion = ${serverVersion ?? "?"}`);
      check(
        notes,
        recommendedNonEmpty,
        "recommandations actionnables présentes (quickWins/plan30Days/validationsNeeded/operationalSynthesis)",
      );
      check(notes, !travauxInGreen, "aucune couche travaux en VERT");
      check(notes, leaks.length === 0, "aucun marqueur sensible");
      out.push({
        name: "Prompt 4 — generate_open_data_brief public markdown",
        ok:
          schemaVersion === "open_data.v1" &&
          typeof serverVersion === "string" &&
          recommendedNonEmpty &&
          !travauxInGreen &&
          leaks.length === 0 &&
          !res.isError,
        notes,
        sensitiveLeaks: leaks,
        textContent: text,
        structuredContent: structured,
      });
    }

    {
      const res = await callTool(client, "inventory_all_layers", {
        mode: "internal",
        targets: [{ serviceKey: "equipements", layerId: 5 }],
        sampleLimit: 10,
      });
      const { text, structured } = extractText(res);
      const payload = `${text}\n${JSON.stringify(structured ?? {})}`;
      const leaks = detectSensitiveOutsideIgnoredLists(payload);
      const notes: string[] = [];
      const struct = (structured ?? {}) as Record<string, unknown>;
      const source = struct.source as Record<string, unknown> | undefined;
      const schemaVersion = source?.schemaVersion as string | undefined;
      const layers = (struct.layers as unknown[]) ?? [];
      const exec = source?.execution as Record<string, unknown> | undefined;
      const targetsFilter = exec?.targetsFilter;
      const serviceKeysFilter = exec?.serviceKeysFilter;
      const diagnostics = source?.diagnostics;
      check(notes, schemaVersion === "inventory.v1", `schemaVersion = ${schemaVersion ?? "?"}`);
      check(notes, layers.length === 1, `layers.length = ${layers.length} (attendu 1)`);
      check(notes, Array.isArray(targetsFilter), `execution.targetsFilter présent`);
      check(notes, serviceKeysFilter === null, `execution.serviceKeysFilter = ${String(serviceKeysFilter)}`);
      check(notes, diagnostics !== undefined, "source.diagnostics présent");
      check(notes, leaks.length === 0, "aucun marqueur sensible");
      out.push({
        name: "Prompt 5 — inventory_all_layers internal targeted",
        ok:
          schemaVersion === "inventory.v1" &&
          layers.length === 1 &&
          Array.isArray(targetsFilter) &&
          serviceKeysFilter === null &&
          diagnostics !== undefined &&
          leaks.length === 0 &&
          !res.isError,
        notes,
        sensitiveLeaks: leaks,
        textContent: text,
        structuredContent: structured,
      });
    }

    {
      const res = await callTool(client, "generate_internal_dashboard_brief", {
        mode: "internal",
        format: "markdown",
        date: "2026-04-30",
      });
      const { text, structured } = extractText(res);
      const payload = `${text}\n${JSON.stringify(structured ?? {})}`;
      const leaks = detectSensitiveOutsideIgnoredLists(payload);
      const notes: string[] = [];
      const struct = (structured ?? {}) as Record<string, unknown>;
      const source = struct.source as Record<string, unknown> | undefined;
      const schemaVersion = source?.schemaVersion as string | undefined;
      const exec = (struct.executiveSummary as string | undefined) ?? "";
      const qualityAlerts = struct.qualityAlerts;
      const sample = JSON.stringify(struct.travauxEnCoursEchantillon ?? []);
      const sampleHasSensitive = SENSITIVE_MARKERS.some(m =>
        sample.toLowerCase().includes(m),
      );
      check(
        notes,
        schemaVersion === "internal_dashboard.v1",
        `schemaVersion = ${schemaVersion ?? "?"}`,
      );
      check(notes, exec.length > 0, "executiveSummary non vide");
      check(notes, qualityAlerts !== undefined, "qualityAlerts présent");
      check(notes, !sampleHasSensitive, "travauxEnCoursEchantillon sans marqueur sensible");
      check(notes, leaks.length === 0, "aucun marqueur sensible global");

      let publicRefuses = false;
      try {
        const r2 = await callTool(client, "generate_internal_dashboard_brief", {
          mode: "public",
          format: "markdown",
          date: "2026-04-30",
        });
        publicRefuses = r2.isError === true;
      } catch {
        publicRefuses = true;
      }
      check(notes, publicRefuses, "refuse mode=public (test alternatif)");

      out.push({
        name: "Prompt 6 — generate_internal_dashboard_brief internal markdown",
        ok:
          schemaVersion === "internal_dashboard.v1" &&
          exec.length > 0 &&
          qualityAlerts !== undefined &&
          !sampleHasSensitive &&
          leaks.length === 0 &&
          publicRefuses &&
          !res.isError,
        notes,
        sensitiveLeaks: leaks,
        textContent: text,
        structuredContent: structured,
      });
    }

    return out;
  });
}

async function main(): Promise<void> {
  const log = (msg: string): void => process.stderr.write(`${msg}\n`);
  log("[recette-terrain] démarrage…");
  const results = await runPrompts();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(repoRoot(), "outputs", `recette-terrain-${ts}`);
  mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r) continue;
    writeFileSync(
      join(outDir, `prompt-${i + 1}.json`),
      JSON.stringify(
        { name: r.name, ok: r.ok, notes: r.notes, sensitiveLeaks: r.sensitiveLeaks, structured: r.structuredContent },
        null,
        2,
      ),
      "utf8",
    );
    if (r.textContent) {
      writeFileSync(join(outDir, `prompt-${i + 1}.md`), r.textContent, "utf8");
    }
  }
  const summary = results.map(r => ({ name: r.name, ok: r.ok, notes: r.notes }));
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  log(`[recette-terrain] résultats écrits dans ${outDir}`);
  for (const r of results) {
    log(`\n=== ${r.name} ===`);
    log(`  verdict : ${r.ok ? "OK" : "KO"}`);
    for (const n of r.notes) log(`  ${n}`);
    if (r.sensitiveLeaks.length) {
      for (const lk of r.sensitiveLeaks.slice(0, 3)) {
        log(`  LEAK[${lk.marker}] : ${lk.sample}`);
      }
    }
  }
  const overall = results.every(r => r.ok);
  log(`\n[recette-terrain] verdict global : ${overall ? "OK" : "KO"}`);
  process.exit(overall ? 0 : 1);
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
    process.stderr.write(`[recette-terrain] erreur fatale : ${(err as Error).message}\n`);
    process.exit(1);
  });
}
