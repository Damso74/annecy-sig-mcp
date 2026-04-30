import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { modeSchema } from "./utils/validation.js";
import { isAppError } from "./utils/errors.js";
import { runListServices } from "./tools/listServices.js";
import { runListLayers } from "./tools/listLayers.js";
import { runDescribeLayer } from "./tools/describeLayer.js";
import { runQueryLayer, runSearchNearby } from "./tools/queryLayer.js";
import { runListCurrentWorks, runListLateWorks } from "./tools/works.js";
import { runDetectDataQualityIssues } from "./tools/quality.js";
import { runCountLayer } from "./tools/countLayer.js";
import { runInventoryAllLayers } from "./tools/inventoryAllLayers.js";
import { runRecommendOpenDataCandidates } from "./tools/recommendOpenData.js";
import { runGenerateInventoryReport } from "./tools/generateInventoryReport.js";
import { runGenerateOpenDataBrief } from "./tools/generateOpenDataBrief.js";
import { runGenerateChatbotReadinessReport } from "./tools/generateChatbotReadinessReport.js";
import { runGenerateInternalDashboardBrief } from "./tools/generateInternalDashboardBrief.js";
import { runGenerateLayerActionPlan } from "./tools/generateLayerActionPlan.js";
import { SERVER_VERSION } from "./runtime/version.js";
import {
  parseLatLon,
  parseRadiusMeters,
  validateServiceLayer,
  clampInventoryConcurrency,
} from "./utils/validation.js";

function jsonOk(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function jsonErr(e: unknown) {
  if (isAppError(e)) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: JSON.stringify({ error: e.toJSON() }, null, 2) }],
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: { code: "INTERNAL_ERROR", message } }, null, 2),
      },
    ],
  };
}

export function createMcpServer(cfg: AppConfig): McpServer {
  const server = new McpServer(
    { name: "annecy-sig-mcp", version: SERVER_VERSION },
    {
      instructions:
        "Serveur MCP lecture seule sur l’allowlist SIG Annecy (portailsig.annecy.fr). " +
        "Modes public (champs réduits) et internal (champs étendus, jamais de secrets). " +
        "V0.7 : schéma `source` stable (schemaVersion / serverVersion, diagnostics agrégés, execution avec requestedSampleLimit / effectiveSampleLimit), diagnostics typés par couche, ciblage `targets` (exclusif avec serviceKeys), inventaire découpé en modules. " +
        "Outils d’inventaire : count_layer, inventory_all_layers, recommend_open_data_candidates. " +
        "Rapports : generate_inventory_report, generate_open_data_brief, generate_chatbot_readiness_report, generate_internal_dashboard_brief, generate_layer_action_plan. " +
        "Toujours vérifier le mode avant d’exposer des données citoyennes.",
    },
  );

  server.registerTool(
    "list_services",
    {
      description:
        "Liste les services SIG Annecy autorisés par l’allowlist (avec nombre de couches visibles selon le mode).",
      inputSchema: {
        mode: modeSchema.optional().describe("public | internal (défaut depuis DEFAULT_MODE)"),
      },
    },
    async args => {
      try {
        const mode = args.mode ?? cfg.defaultMode;
        return jsonOk(runListServices(mode));
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "list_layers",
    {
      description: "Liste les couches autorisées d’un service (filtrées en mode public).",
      inputSchema: {
        serviceKey: z.string(),
        mode: modeSchema.optional(),
      },
    },
    async args => {
      try {
        const mode = args.mode ?? cfg.defaultMode;
        return jsonOk(runListLayers(args.serviceKey, mode));
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "describe_layer",
    {
      description:
        "Retourne les métadonnées ArcGIS utiles et le schéma exposé (champs filtrés selon le mode).",
      inputSchema: {
        serviceKey: z.string(),
        layerId: z.number().int(),
        mode: modeSchema.optional(),
        includeRawMetadata: z
          .boolean()
          .optional()
          .describe(
            "Si true, inclut un bloc métadonnées ArcGIS additionnel **toujours sanitisé** (défaut false — pas de brut complet).",
          ),
      },
    },
    async args => {
      try {
        const mode = args.mode ?? cfg.defaultMode;
        return jsonOk(
          await runDescribeLayer(cfg, args.serviceKey, args.layerId, mode, {
            includeRawMetadata: args.includeRawMetadata,
          }),
        );
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "query_layer",
    {
      description:
        "Interroge une couche allowlistée (WHERE simple, limite bornée, géométrie WGS84 si demandée).",
      inputSchema: {
        serviceKey: z.string(),
        layerId: z.number().int(),
        where: z.string().optional(),
        outFields: z.array(z.string()).optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
        returnGeometry: z.boolean().optional(),
        mode: modeSchema.optional(),
      },
    },
    async args => {
      try {
        const mode = args.mode ?? cfg.defaultMode;
        return jsonOk(
          await runQueryLayer(cfg, {
            serviceKey: args.serviceKey,
            layerId: args.layerId,
            where: args.where,
            outFields: args.outFields,
            limit: args.limit,
            offset: args.offset,
            returnGeometry: args.returnGeometry,
            mode,
          }),
        );
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "search_nearby",
    {
      description:
        "Recherche dans une couche autour d’un point (Haversine côté serveur après requête ArcGIS).",
      inputSchema: {
        serviceKey: z.string(),
        layerId: z.number().int(),
        lat: z.number(),
        lon: z.number(),
        radiusMeters: z.number().optional(),
        where: z.string().optional(),
        limit: z.number().int().optional(),
        mode: modeSchema.optional(),
      },
    },
    async args => {
      try {
        const mode = args.mode ?? cfg.defaultMode;
        const { lat, lon } = parseLatLon(args.lat, args.lon);
        const radiusMeters = parseRadiusMeters(args.radiusMeters, 500, cfg.maxSearchRadiusMeters);
        validateServiceLayer(args.serviceKey, args.layerId, mode);
        return jsonOk(
          await runSearchNearby(cfg, {
            serviceKey: args.serviceKey,
            layerId: args.layerId,
            lat,
            lon,
            radiusMeters,
            where: args.where,
            limit: args.limit,
            mode,
          }),
        );
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "list_current_works",
    {
      description: "Liste les travaux actifs à une date (couche travaux, mode internal requis côté données).",
      inputSchema: {
        date: z.string().optional(),
        includeGeometry: z.boolean().optional(),
        limit: z.number().int().optional(),
      },
    },
    async args => {
      try {
        return jsonOk(
          await runListCurrentWorks(cfg, {
            date: args.date,
            includeGeometry: args.includeGeometry,
            limit: args.limit,
          }),
        );
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "list_late_works",
    {
      description: "Liste les travaux avec statut « En cours hors délai » (mode internal).",
      inputSchema: {
        limit: z.number().int().optional(),
        includeGeometry: z.boolean().optional(),
      },
    },
    async args => {
      try {
        return jsonOk(
          await runListLateWorks(cfg, {
            limit: args.limit,
            includeGeometry: args.includeGeometry,
          }),
        );
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "count_layer",
    {
      description:
        "Compte les enregistrements d’une couche allowlistée (returnCountOnly, sans télécharger les géométries).",
      inputSchema: {
        serviceKey: z.string(),
        layerId: z.number().int(),
        where: z.string().optional(),
        mode: modeSchema.optional(),
      },
    },
    async args => {
      try {
        const mode = args.mode ?? cfg.defaultMode;
        return jsonOk(
          await runCountLayer(cfg, {
            serviceKey: args.serviceKey,
            layerId: args.layerId,
            where: args.where,
            mode,
          }),
        );
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "inventory_all_layers",
    {
      description:
        "Inventaire des couches visibles pour le mode : comptage, échantillon, nulls, score préliminaire et cas d’usage.",
      inputSchema: {
        mode: modeSchema.optional(),
        sampleLimit: z.number().int().optional(),
        concurrency: z.number().int().min(1).max(6).optional().describe("Parallélisation bornée (défaut 3)."),
        serviceKeys: z
          .array(z.string())
          .optional()
          .describe("Limiter l’inventaire à ces services (clés registre) ; toutes les couches visibles du service sont analysées."),
        targets: z
          .array(
            z.object({
              serviceKey: z.string(),
              layerId: z.number().int().optional(),
            }),
          )
          .optional()
          .describe(
            "Sélection fine par service et optionnellement par `layerId` (sans `layerId` : toutes les couches visibles du service). **Ne pas combiner** avec `serviceKeys`.",
          ),
        fast: z
          .boolean()
          .optional()
          .describe("Mode rapide : échantillon minimal (1), comptage conservé ; fiabilité data réduite."),
      },
    },
    async args => {
      try {
        const mode = args.mode ?? cfg.defaultMode;
        return jsonOk(
          await runInventoryAllLayers(cfg, {
            mode,
            sampleLimit: args.sampleLimit,
            concurrency: args.concurrency !== undefined ? clampInventoryConcurrency(args.concurrency) : undefined,
            serviceKeys: args.serviceKeys,
            targets: args.targets,
            fast: args.fast,
          }),
        );
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "recommend_open_data_candidates",
    {
      description:
        "Classe les couches en candidats open data VERT / ORANGE / ROUGE à partir d’un inventaire (qualité, risque, visibilité).",
      inputSchema: {
        mode: modeSchema.optional(),
        sampleLimit: z.number().int().optional(),
        concurrency: z.number().int().min(1).max(6).optional(),
        serviceKeys: z.array(z.string()).optional(),
        targets: z
          .array(
            z.object({
              serviceKey: z.string(),
              layerId: z.number().int().optional(),
            }),
          )
          .optional()
          .describe("Exclusif avec `serviceKeys`."),
        fast: z.boolean().optional(),
      },
    },
    async args => {
      try {
        const mode = args.mode ?? cfg.defaultMode;
        return jsonOk(
          await runRecommendOpenDataCandidates(cfg, {
            mode,
            sampleLimit: args.sampleLimit,
            concurrency: args.concurrency !== undefined ? clampInventoryConcurrency(args.concurrency) : undefined,
            serviceKeys: args.serviceKeys,
            targets: args.targets,
            fast: args.fast,
          }),
        );
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  const formatSchema = z.enum(["json", "markdown"]).optional();
  const writeOutputSchema = z.boolean().optional().describe("Si true, écrit aussi le rapport dans outputs/.");

  server.registerTool(
    "generate_inventory_report",
    {
      description:
        "Rapport synthétique d’inventaire (réutilise inventory_all_layers) : résumé, tops, warnings, actions — JSON ou Markdown.",
      inputSchema: {
        mode: modeSchema.optional(),
        sampleLimit: z.number().int().optional(),
        concurrency: z.number().int().min(1).max(6).optional(),
        serviceKeys: z.array(z.string()).optional(),
        targets: z
          .array(
            z.object({
              serviceKey: z.string(),
              layerId: z.number().int().optional(),
            }),
          )
          .optional()
          .describe("Exclusif avec `serviceKeys`."),
        fast: z.boolean().optional(),
        format: formatSchema,
        writeOutput: writeOutputSchema,
      },
    },
    async args => {
      try {
        const mode = args.mode ?? cfg.defaultMode;
        const format = args.format === "json" ? "json" : "markdown";
        const r = await runGenerateInventoryReport(cfg, {
          mode,
          sampleLimit: args.sampleLimit,
          concurrency: args.concurrency !== undefined ? clampInventoryConcurrency(args.concurrency) : undefined,
          serviceKeys: args.serviceKeys,
          targets: args.targets,
          fast: args.fast,
          format,
          writeOutput: args.writeOutput,
        });
        return jsonOk({ format: r.format, body: r.body, structured: r.structured, output: r.output });
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "generate_open_data_brief",
    {
      description:
        "Note open data synthétique (réutilise recommend_open_data_candidates) : VERT/ORANGE/ROUGE, risques, plan 30 jours.",
      inputSchema: {
        mode: modeSchema.optional(),
        travauxTier: z.enum(["orange", "red"]).optional(),
        sampleLimit: z.number().int().optional(),
        concurrency: z.number().int().min(1).max(6).optional(),
        serviceKeys: z.array(z.string()).optional(),
        targets: z
          .array(
            z.object({
              serviceKey: z.string(),
              layerId: z.number().int().optional(),
            }),
          )
          .optional()
          .describe("Exclusif avec `serviceKeys`."),
        fast: z.boolean().optional(),
        format: formatSchema,
        writeOutput: writeOutputSchema,
      },
    },
    async args => {
      try {
        const mode = args.mode ?? cfg.defaultMode;
        const format = args.format === "json" ? "json" : "markdown";
        const r = await runGenerateOpenDataBrief(cfg, {
          mode,
          travauxTier: args.travauxTier,
          sampleLimit: args.sampleLimit,
          concurrency: args.concurrency !== undefined ? clampInventoryConcurrency(args.concurrency) : undefined,
          serviceKeys: args.serviceKeys,
          targets: args.targets,
          fast: args.fast,
          format,
          writeOutput: args.writeOutput,
        });
        return jsonOk({ format: r.format, body: r.body, structured: r.structured, output: r.output });
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "generate_chatbot_readiness_report",
    {
      description:
        "Évalue la maturité « chatbot citoyen » sur un sous-ensemble de couches (WC, sport, culture, mobilité, etc.).",
      inputSchema: {
        mode: modeSchema.optional(),
        sampleLimit: z.number().int().optional(),
        concurrency: z.number().int().min(1).max(6).optional(),
        targets: z
          .array(
            z.object({
              serviceKey: z.string(),
              layerId: z.number().int().optional(),
            }),
          )
          .optional()
          .describe(
            "Couches à analyser (inventaire ciblé). Si absent, périmètre par défaut : couches « chatbot citoyen » du registre.",
          ),
        fast: z.boolean().optional(),
        format: formatSchema,
        writeOutput: writeOutputSchema,
      },
    },
    async args => {
      try {
        const mode = args.mode ?? cfg.defaultMode;
        const format = args.format === "json" ? "json" : "markdown";
        const r = await runGenerateChatbotReadinessReport(cfg, {
          mode,
          sampleLimit: args.sampleLimit,
          concurrency: args.concurrency !== undefined ? clampInventoryConcurrency(args.concurrency) : undefined,
          targets: args.targets,
          fast: args.fast,
          format,
          writeOutput: args.writeOutput,
        });
        return jsonOk({ format: r.format, body: r.body, structured: r.structured, output: r.output });
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "generate_internal_dashboard_brief",
    {
      description:
        "Brief dashboard interne (travaux) : actifs, retards, alertes qualité — **internal uniquement**, sans pièces jointes.",
      inputSchema: {
        mode: z.literal("internal"),
        date: z.string().optional(),
        format: formatSchema,
        writeOutput: writeOutputSchema,
      },
    },
    async args => {
      try {
        const format = args.format === "json" ? "json" : "markdown";
        const r = await runGenerateInternalDashboardBrief(cfg, {
          mode: args.mode,
          date: args.date,
          format,
          writeOutput: args.writeOutput,
        });
        return jsonOk({ format: r.format, body: r.body, structured: r.structured, output: r.output });
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "generate_layer_action_plan",
    {
      description:
        "Plan d’action par couche (résumé exécutif, usages chatbot/open data, actions techniques et métier) — JSON ou Markdown.",
      inputSchema: {
        serviceKey: z.string(),
        layerId: z.number().int(),
        mode: modeSchema.optional(),
        format: formatSchema,
        sampleLimit: z.number().int().optional(),
        concurrency: z.number().int().min(1).max(6).optional(),
        fast: z.boolean().optional(),
        writeOutput: writeOutputSchema,
      },
    },
    async args => {
      try {
        const mode = args.mode ?? cfg.defaultMode;
        const format = args.format === "json" ? "json" : "markdown";
        const r = await runGenerateLayerActionPlan(cfg, {
          serviceKey: args.serviceKey,
          layerId: args.layerId,
          mode,
          format,
          sampleLimit: args.sampleLimit,
          concurrency: args.concurrency !== undefined ? clampInventoryConcurrency(args.concurrency) : undefined,
          fast: args.fast,
          writeOutput: args.writeOutput,
        });
        return jsonOk({ format: r.format, body: r.body, structured: r.structured, output: r.output });
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "detect_data_quality_issues",
    {
      description: "Échantillonne une couche et produit un rapport de qualité (nulls, géométrie, dates, statuts).",
      inputSchema: {
        serviceKey: z.string(),
        layerId: z.number().int(),
        sampleLimit: z.number().int().optional(),
        mode: modeSchema.optional(),
      },
    },
    async args => {
      try {
        const mode = args.mode ?? cfg.defaultMode;
        return jsonOk(
          await runDetectDataQualityIssues(cfg, {
            serviceKey: args.serviceKey,
            layerId: args.layerId,
            sampleLimit: args.sampleLimit,
            mode,
          }),
        );
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  return server;
}
