import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { modeSchema } from "./utils/validation.js";
import { isAppError, AppError } from "./utils/errors.js";
import { runListServices } from "./tools/listServices.js";
import { runListLayers } from "./tools/listLayers.js";
import { runDescribeLayer } from "./tools/describeLayer.js";
import { runQueryLayer, runSearchNearby } from "./tools/queryLayer.js";
import { runListCurrentWorks, runListLateWorks } from "./tools/works.js";
import { runListPublicWorks, runSearchPublicWorksNearby } from "./tools/publicWorks.js";
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

/**
 * Options runtime passées au registre des outils. Permet aux deux bootstraps
 * (stdio local et HTTP distant) de partager le même code de déclaration des
 * outils sans dupliquer la logique.
 */
export type AnnecySigTransport = "stdio" | "http";

export interface AnnecySigMcpRuntimeOptions {
  transport: AnnecySigTransport;
  /**
   * Si `true`, le serveur impose `mode = "public"` :
   *   - tout outil acceptant un `mode` voit `internal` rejeté ;
   *   - les outils strictement internal (ex : `generate_internal_dashboard_brief`)
   *     ne sont enregistrés que si `allowInternalTools=true`.
   * Défaut : `false` (compat stdio local historique).
   */
  publicOnly?: boolean;
  /**
   * Autorise l'enregistrement des outils internal-only
   * (`generate_internal_dashboard_brief`, `list_current_works`, `list_late_works`).
   * Défaut : `true` (compat stdio local historique).
   *
   * En transport HTTP public, on doit le mettre à `false` explicitement.
   */
  allowInternalTools?: boolean;
  /**
   * Mode par défaut effectif si l'appelant n'en fournit pas. En remote public,
   * fixé à `"public"` quel que soit `cfg.defaultMode`.
   */
  defaultMode?: "public" | "internal";
}

const DEFAULT_RUNTIME_OPTIONS: Required<AnnecySigMcpRuntimeOptions> = {
  transport: "stdio",
  publicOnly: false,
  allowInternalTools: true,
  defaultMode: "public",
};

const REMOTE_INTERNAL_REFUSAL_MESSAGE =
  "Le transport HTTP public n'autorise pas le mode internal. " +
  "Utiliser le MCP local stdio ou une future passerelle restricted validée DSI.";

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

/**
 * Verrou commun appliqué côté outil : refuse explicitement `mode=internal` si
 * `publicOnly` est actif. On n'écrase pas silencieusement la valeur — un client
 * qui réclame `internal` doit être notifié de la limite (sécurité par
 * intention plutôt que par tolérance).
 */
function resolveEffectiveMode(
  requested: "public" | "internal" | undefined,
  cfg: AppConfig,
  options: Required<AnnecySigMcpRuntimeOptions>,
): "public" | "internal" {
  const baseDefault = options.publicOnly ? "public" : (options.defaultMode ?? cfg.defaultMode);
  const effective = requested ?? baseDefault;
  if (options.publicOnly && effective === "internal") {
    throw new AppError("FORBIDDEN", REMOTE_INTERNAL_REFUSAL_MESSAGE, {
      hint: "Réessayer en mode=public ou utiliser le serveur stdio local.",
    });
  }
  return effective;
}

/**
 * Déclare les outils MCP sur un serveur fourni, en tenant compte des
 * contraintes du transport (stdio = tout autorisé ; HTTP public = filtres).
 *
 * Centraliser ce code évite la duplication entre `index.ts` (stdio) et le
 * handler HTTP. Toute évolution d'outil doit passer ici.
 */
export function registerAnnecySigTools(
  server: McpServer,
  cfg: AppConfig,
  runtimeOptions?: AnnecySigMcpRuntimeOptions,
): void {
  const options: Required<AnnecySigMcpRuntimeOptions> = {
    ...DEFAULT_RUNTIME_OPTIONS,
    ...runtimeOptions,
  };
  // Si publicOnly est forcé, on aligne le mode par défaut sur public quoi
  // qu'il arrive — pas de fenêtre d'élévation.
  if (options.publicOnly) options.defaultMode = "public";

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
        const mode = resolveEffectiveMode(args.mode, cfg, options);
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
        const mode = resolveEffectiveMode(args.mode, cfg, options);
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
        const mode = resolveEffectiveMode(args.mode, cfg, options);
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
        const mode = resolveEffectiveMode(args.mode, cfg, options);
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
        const mode = resolveEffectiveMode(args.mode, cfg, options);
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

  // ---------------------------------------------------------------------------
  // Outils internal-only — non enregistrés en transport public.
  // ---------------------------------------------------------------------------
  if (options.allowInternalTools) {
    server.registerTool(
      "list_current_works",
      {
        description:
          "Liste les travaux actifs à une date (couche travaux, mode internal requis côté données).",
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
  }

  // ---------------------------------------------------------------------------
  // V1.0 — Travaux public-light. Exposés en local **et** en remote public car
  // ils sont strictement filtrés (jamais de pièce jointe, jamais de description
  // brute, jamais d’identifiant interne). Ils n’ouvrent **pas** la couche
  // travaux brute (cf. `list_current_works` / `list_late_works`, qui restent
  // internal-only).
  // ---------------------------------------------------------------------------
  server.registerTool(
    "list_public_works",
    {
      description:
        "Liste **filtrée public-light** des travaux (titre simplifié, statut, dates, secteur). Aucun champ technique ni pièce jointe. Réservé `mode=public`.",
      inputSchema: {
        mode: z
          .literal("public")
          .optional()
          .describe("Toujours `public` — les autres valeurs sont refusées explicitement."),
        date: z
          .string()
          .optional()
          .describe("Date de référence YYYY-MM-DD (défaut : date du jour serveur)."),
        status: z
          .enum(["active", "upcoming", "late", "all"])
          .optional()
          .describe("Filtre métier (défaut `active`)."),
        limit: z.number().int().optional().describe("Plafond 100 (défaut 20)."),
        includeGeometry: z
          .boolean()
          .optional()
          .describe("Inclure la géométrie GeoJSON (défaut false). Aucune coordonnée n’est inventée."),
        commune: z
          .string()
          .optional()
          .describe("Filtre `commune_deleguee` exact (sans wildcards, longueur ≤ 80)."),
      },
    },
    async args => {
      try {
        return jsonOk(
          await runListPublicWorks(cfg, {
            mode: args.mode,
            date: args.date,
            status: args.status,
            limit: args.limit,
            includeGeometry: args.includeGeometry,
            commune: args.commune,
          }),
        );
      } catch (e) {
        return jsonErr(e);
      }
    },
  );

  server.registerTool(
    "search_public_works_nearby",
    {
      description:
        "Travaux **public-light** autour d’un point (latitude/longitude) — filtre spatial serveur si possible, fallback Haversine. Distance en mètres dans chaque item.",
      inputSchema: {
        latitude: z.number(),
        longitude: z.number(),
        radiusMeters: z
          .number()
          .optional()
          .describe("Rayon en mètres, plafonné par MAX_SEARCH_RADIUS_METERS (défaut 500)."),
        date: z.string().optional().describe("Date de référence YYYY-MM-DD (défaut jour)."),
        limit: z.number().int().optional().describe("Plafond 50 (défaut 10)."),
        includeGeometry: z
          .boolean()
          .optional()
          .describe("Inclure la géométrie GeoJSON (défaut false)."),
      },
    },
    async args => {
      try {
        return jsonOk(
          await runSearchPublicWorksNearby(cfg, {
            latitude: args.latitude,
            longitude: args.longitude,
            radiusMeters: args.radiusMeters,
            date: args.date,
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
        const mode = resolveEffectiveMode(args.mode, cfg, options);
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
        const mode = resolveEffectiveMode(args.mode, cfg, options);
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
        const mode = resolveEffectiveMode(args.mode, cfg, options);
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
        const mode = resolveEffectiveMode(args.mode, cfg, options);
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
        const mode = resolveEffectiveMode(args.mode, cfg, options);
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
        const mode = resolveEffectiveMode(args.mode, cfg, options);
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

  if (options.allowInternalTools) {
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
  }

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
        const mode = resolveEffectiveMode(args.mode, cfg, options);
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
        const mode = resolveEffectiveMode(args.mode, cfg, options);
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
}

/**
 * Construit un `McpServer` complet (instance + outils enregistrés).
 *
 * - Sans options : conserve le comportement historique du bootstrap stdio
 *   local (tous les outils, mode défaut depuis la config).
 * - Avec `runtimeOptions`, sert également le bootstrap HTTP distant via
 *   `src/runtime/httpHandler.ts`.
 */
export function createAnnecySigMcpServer(
  cfg: AppConfig,
  runtimeOptions?: AnnecySigMcpRuntimeOptions,
): McpServer {
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
  registerAnnecySigTools(server, cfg, runtimeOptions);
  return server;
}

/** Compat ascendante — utilisé par `src/index.ts` (stdio) et plusieurs tests. */
export function createMcpServer(cfg: AppConfig): McpServer {
  return createAnnecySigMcpServer(cfg);
}

export const REMOTE_INTERNAL_REFUSAL = REMOTE_INTERNAL_REFUSAL_MESSAGE;
