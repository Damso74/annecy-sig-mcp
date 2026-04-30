import type { AppConfig } from "../config.js";
import type { VisibilityMode } from "../registry.js";
import { getLayerEntry } from "../registry.js";
import { runInventoryAllLayers } from "./inventoryAllLayers.js";
import { runDescribeLayer } from "./describeLayer.js";
import { clampSampleLimit, validateServiceLayer } from "../utils/validation.js";
import {
  executiveSummaryHeading,
  mdBullet,
  mdH1,
  mdH2,
  mdParagraph,
} from "../utils/reportMarkdown.js";
import type { ReportFormat } from "./generateInventoryReport.js";
import { writeReportOutput, type ReportOutput, type ReportExportMeta } from "../utils/reportOutput.js";
import { SERVER_VERSION, LAYER_ACTION_PLAN_SCHEMA_VERSION } from "../runtime/version.js";
import { assessOpenDataCandidate } from "./recommendOpenData.js";
import { assessChatbotReadiness } from "./generateChatbotReadinessReport.js";
import { LayerActionPlanSchema, validateContract } from "../contracts/index.js";

export type LayerActionPlanStructured = {
  executiveSummary: string;
  serviceKey: string;
  layerId: number;
  layerName: string;
  visibility: string;
  riskLevel: string;
  usageStatus: string;
  sampleStatus: string;
  geometryStatus: string;
  fieldAlignment: {
    validFields: string[];
    missingFields: string[];
    ignoredFieldsPreview: string[];
    objectIdField: string | null;
    geometryType: string | null;
    supportsQuery: boolean;
  };
  semanticMappings: Record<string, unknown>;
  semanticValidation: unknown;
  semanticCoverage: unknown;
  possibleUses: {
    chatbot: string;
    openData: string;
    internalDashboard: string;
    website: string;
  };
  technicalIssues: string[];
  dataQualityIssues: string[];
  businessQuestions: string[];
  recommendedTechnicalActions: string[];
  recommendedBusinessActions: string[];
  priority: "high" | "medium" | "low";
  /** V0.6 */
  technicalScore: number;
  dataQualityScore: number;
  preliminaryQualityScore: number;
  source: {
    type: "annecy_sig_mcp_layer_action_plan";
    schemaVersion: typeof LAYER_ACTION_PLAN_SCHEMA_VERSION;
    serverVersion: string;
    inventory: Awaited<ReturnType<typeof runInventoryAllLayers>>["source"];
  };
};

function priorityFrom(row: Awaited<ReturnType<typeof runInventoryAllLayers>>["layers"][number]): "high" | "medium" | "low" {
  if (row.usageStatus === "to_investigate_technically" || row.sampleStatus === "failed") return "high";
  if (row.usageStatus === "needs_field_mapping" || row.usageStatus === "needs_data_cleaning") return "medium";
  return "low";
}

export async function runGenerateLayerActionPlan(
  cfg: AppConfig,
  input: {
    serviceKey: string;
    layerId: number;
    mode?: VisibilityMode;
    format?: ReportFormat;
    sampleLimit?: number;
    concurrency?: number;
    fast?: boolean;
    writeOutput?: boolean;
  },
): Promise<{ format: ReportFormat; body: string; structured: LayerActionPlanStructured; output?: ReportOutput }> {
  const startedAt = Date.now();
  const mode = input.mode ?? cfg.defaultMode;
  const format: ReportFormat = input.format === "json" ? "json" : "markdown";
  const sampleLimit = clampSampleLimit(input.sampleLimit ?? 20, 20, cfg.maxResultLimit);
  validateServiceLayer(input.serviceKey, input.layerId, mode);

  const describe = await runDescribeLayer(cfg, input.serviceKey, input.layerId, mode);
  const sensitiveField = /^(created_user|created_date|last_edited_user|last_edited_date|url_pj|url_piece_jointe|token|password|secret)$/i;
  const fieldAlignment = {
    ...describe.fieldAlignment,
    ignoredFieldsPreview: describe.fieldAlignment.ignoredFieldsPreview.filter(f => !sensitiveField.test(f)),
  };
  const inv = await runInventoryAllLayers(cfg, {
    mode,
    sampleLimit,
    concurrency: input.concurrency,
    targets: [{ serviceKey: input.serviceKey, layerId: input.layerId }],
    fast: input.fast,
  });
  const row = inv.layers.find(l => l.serviceKey === input.serviceKey && l.layerId === input.layerId);
  if (!row) {
    throw new Error(`Couche introuvable dans l’inventaire : ${input.serviceKey} / ${input.layerId}`);
  }

  const entry = getLayerEntry(input.serviceKey, input.layerId);
  const od = assessOpenDataCandidate(row);
  const chat = assessChatbotReadiness(row);

  const technicalIssues: string[] = [];
  if (row.sampleStatus === "failed") technicalIssues.push(`Échantillon : ${row.sampleError ?? "échec"}`);
  if (!row.fieldValidation.supportsQuery) technicalIssues.push("La couche ne supporte pas Query ou capacité douteuse.");
  if (row.fieldValidation.missingFields.length) {
    technicalIssues.push(
      `Champs registre absents côté service : ${row.fieldValidation.missingFields.slice(0, 8).join(", ")}${row.fieldValidation.missingFields.length > 8 ? "…" : ""}`,
    );
  }

  const dataQualityIssues: string[] = [];
  if (row.usageStatus === "needs_data_cleaning") dataQualityIssues.push(...row.usageWarnings);
  if (row.geometryStatus === "missing") dataQualityIssues.push("Géométrie absente ou vide sur l’échantillon.");
  if (row.semanticValidation.missingEssentialMappings.length) {
    dataQualityIssues.push(`Essentiels sémantiques manquants : ${row.semanticValidation.missingEssentialMappings.join(", ")}`);
  }

  const businessQuestions: string[] = [
    "Quel est le public cible (citoyen, agent, partenaire) ?",
    "Les libellés et catégories sont-ils stabilisés dans un référentiel métier ?",
    "Quelle fréquence de mise à jour peut être annoncée ?",
  ];

  const recommendedTechnicalActions: string[] = [
    "Vérifier `outFields`, la capacité Query et les timeouts sur un échantillon réduit puis élargir.",
    "Réaligner le registre sur les noms de champs réels retournés par `describe_layer`.",
  ];
  const recommendedBusinessActions: string[] = [
    "Compléter ou clarifier les champs les plus visibles pour l’usager (libellé, adresse, catégorie).",
    "Documenter les limites d’usage (précision géographique, absence d’horaires garantis).",
  ];

  const possibleUses = {
    chatbot:
      row.visibility !== "public"
        ? "Chatbot citoyen : non recommandé sans périmètre dédié (couche internal)."
        : chat.tier === "ready" || chat.tier === "usable_now"
          ? "Chatbot citoyen : pertinent si les règles de prudence (champs manquants) sont intégrées au prompt système."
          : chat.tier === "usable_with_caution"
            ? "Chatbot citoyen : possible avec réponses qualifiées et refus d’inférer hors données."
            : "Chatbot citoyen : non recommandé tant que l’échantillon ou les champs clés ne sont pas fiables.",
    openData:
      od.publicationReadiness === "publishable_now"
        ? "Open data : candidat publication rapide après validation licence DCAT."
        : od.publicationReadiness === "publishable_after_light_cleanup"
          ? "Open data : publication après courte campagne qualité."
          : row.visibility === "internal"
            ? "Open data grand public : exclure ou publier des agrégats sécurisés uniquement."
            : "Open data : validation métier ou juridique selon `publicationReadiness`.",
    internalDashboard:
      row.serviceKey === "travaux"
        ? "Dashboard interne : adapté (suivi chantiers, retards, statuts) sans exposer les pièces jointes."
        : "Dashboard interne : utile pour pilotage et contrôle qualité des attributs.",
    website:
      row.visibility === "public" && row.usageStatus !== "not_usable"
        ? "Site internet : cartographie ou fiches locales possibles avec légende et sources."
        : "Site internet : restreindre aux usages internes ou extranet si la couche est sensible.",
  };

  const executiveSummary = [
    `Couche **${row.layerName}** (${input.serviceKey} / ${input.layerId}), mode **${mode}**.`,
    `Statut métier : **${row.usageStatus}**, échantillon **${row.sampleStatus}**, géométrie **${row.geometryStatus}**.`,
    `Scores V0.6 : technique **${row.technicalScore}**, qualité data **${row.dataQualityScore}**, synthèse **${row.preliminaryQualityScore}**.`,
    `Open data : **${od.publicationReadiness}** ; chatbot citoyen : **${chat.tier}**.`,
  ].join(" ");

  const structured: LayerActionPlanStructured = validateContract<LayerActionPlanStructured>(
    LayerActionPlanSchema,
    {
      executiveSummary,
      serviceKey: input.serviceKey,
      layerId: input.layerId,
      layerName: row.layerName,
      visibility: row.visibility,
      riskLevel: row.riskLevel,
      usageStatus: row.usageStatus,
      sampleStatus: row.sampleStatus,
      geometryStatus: row.geometryStatus,
      fieldAlignment,
      semanticMappings: (entry?.semanticMappings ?? {}) as Record<string, unknown>,
      semanticValidation: row.semanticValidation,
      semanticCoverage: row.semanticCoverage,
      possibleUses,
      technicalIssues,
      dataQualityIssues,
      businessQuestions,
      recommendedTechnicalActions,
      recommendedBusinessActions,
      priority: priorityFrom(row),
      technicalScore: row.technicalScore,
      dataQualityScore: row.dataQualityScore,
      preliminaryQualityScore: row.preliminaryQualityScore,
      source: {
        type: "annecy_sig_mcp_layer_action_plan",
        schemaVersion: LAYER_ACTION_PLAN_SCHEMA_VERSION,
        serverVersion: SERVER_VERSION,
        inventory: inv.source,
      },
    },
    "LayerActionPlan",
  );

  const md = () => {
    let s = mdH1(`Plan d’action — ${row.layerName}`);
    s += executiveSummaryHeading();
    s += mdParagraph(structured.executiveSummary);
    s += mdH2("Statut de la couche");
    s += mdBullet([
      `Visibilité : **${row.visibility}**`,
      `Risque registre : **${row.riskLevel}**`,
      `usageStatus : **${row.usageStatus}**`,
      `Échantillon : **${row.sampleStatus}**`,
      `Géométrie : **${row.geometryStatus}**`,
      `Priorité proposée : **${structured.priority}**`,
      `Scores : technique **${row.technicalScore}**, data **${row.dataQualityScore}**, synthèse **${row.preliminaryQualityScore}**`,
    ]);
    s += mdH2("Ce qui marche");
    s += mdBullet([
      row.sampleStatus === "ok" ? "Échantillon ArcGIS exploitable pour analyser les nulls et la géométrie." : "Échantillon non fiable : se concentrer d’abord sur la technique.",
      row.fieldValidation.supportsQuery ? "Requête SQL serveur disponible (Query)." : "Vérifier les capacités Query côté service.",
    ]);
    s += mdH2("Ce qui bloque");
    s += mdBullet([...(technicalIssues.length ? technicalIssues : ["Rien de bloquant de premier ordre côté technique sur cette passe."])]);
    s += mdH2("Usages possibles");
    s += mdBullet([
      `Chatbot : ${possibleUses.chatbot}`,
      `Open data : ${possibleUses.openData}`,
      `Dashboard interne : ${possibleUses.internalDashboard}`,
      `Site internet : ${possibleUses.website}`,
    ]);
    s += mdH2("Actions techniques");
    s += mdBullet(recommendedTechnicalActions);
    s += mdH2("Actions métier");
    s += mdBullet(recommendedBusinessActions);
    s += mdH2("Questions à arbitrer");
    s += mdBullet(businessQuestions);
    if (dataQualityIssues.length) {
      s += mdH2("Qualité des données");
      s += mdBullet(dataQualityIssues);
    }
    return s.trim();
  };

  const body = format === "markdown" ? md() : JSON.stringify(structured, null, 2);
  const output = input.writeOutput
    ? await writeReportOutput(cfg, `layer-action-plan-${input.serviceKey}-${input.layerId}-${mode}`, format, body, {
        generatedAt: new Date().toISOString(),
        mode,
        sampleLimit,
        concurrency: inv.source.execution.concurrency,
        fast: inv.source.execution.fast,
        sourceVersion: SERVER_VERSION,
        runtimeMs: Date.now() - startedAt,
        filters: { serviceKey: input.serviceKey, layerId: input.layerId, targets: [{ serviceKey: input.serviceKey, layerId: input.layerId }] },
      } satisfies ReportExportMeta)
    : undefined;
  return { format, body, structured, output };
}
