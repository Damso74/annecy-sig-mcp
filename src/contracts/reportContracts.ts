import { z } from "zod";
import {
  ChatbotSchemaVersionLiteral,
  GeometryStatusSchema,
  InternalDashboardSchemaVersionLiteral,
  InventorySourceV1Schema,
  LayerActionPlanSchemaVersionLiteral,
  LayerIdSchema,
  OpenDataSchemaVersionLiteral,
  ReportSchemaVersionLiteral,
  RiskLevelSchema,
  RuntimeMsSchema,
  SampleStatusSchema,
  SamplingModeSchema,
  ServerVersionSchema,
  ServiceKeySchema,
  UsageStatusSchema,
  VisibilityModeSchema,
} from "./common.js";
import { SemanticCoverageSchema, SemanticValidationSchema } from "./inventoryContracts.js";

/**
 * Contrats Zod pour les rapports métier (V0.8 / V0.9).
 *
 * Choix de conception (rappel V0.8, raffiné V0.9) :
 * - on **n’embarque pas** la totalité des `InventoryLayerRow` dans les schémas de
 *   rapports : on s’appuie sur `InventorySourceV1Schema` pour la traçabilité ;
 * - les listes de couches ne portent que le couple identifiant (serviceKey/layerId)
 *   + le label public, pour que la validation reste légère et résistante aux
 *   évolutions internes des rows ;
 * - tout champ libre (raisons, fixes, règles d’usage) est validé comme `z.string()`
 *   sans contrainte de contenu : la sanitation des champs sensibles est portée
 *   ailleurs (helpers `tools/*` + tests `v0.8.arcgisFixtures` / `v0.9.sanitation`).
 */
const LayerRefSchema = z
  .object({
    serviceKey: ServiceKeySchema,
    layerId: LayerIdSchema,
    layerName: z.string(),
    label: z.string(),
  })
  .strict()
  .describe("Référence compacte d’une couche (identifiant + label utilisateur).");

const LayerRefWithReasonsSchema = LayerRefSchema.extend({
  reasons: z.array(z.string()),
})
  .strict()
  .describe("Référence d’une couche enrichie de motifs lisibles.");

const PublicationReadinessSchema = z
  .enum([
    "publishable_now",
    "publishable_after_light_cleanup",
    "requires_business_validation",
    "requires_legal_review",
    "do_not_publish",
  ])
  .describe("Niveau de maturité publication open data.");

/** ---- Open data ----------------------------------------------------- */

export const OpenDataRecommendationSchema = z
  .object({
    serviceKey: ServiceKeySchema,
    layerId: LayerIdSchema,
    layerName: z.string(),
    tier: z.enum(["green", "orange", "red"]).describe("Classement open data agrégé."),
    tierReason: z.string(),
    blockingIssues: z.array(z.string()),
    recommendedFixes: z.array(z.string()),
    publicationReadiness: PublicationReadinessSchema,
    usageStatus: z.string(),
  })
  .strict()
  .describe("Évaluation open data détaillée d’une couche.");

const SamplingAuditEntrySchema = z
  .object({
    serviceKey: ServiceKeySchema,
    layerId: LayerIdSchema,
    layerName: z.string(),
    sampleError: z.string().optional(),
  })
  .passthrough();

export const OpenDataBriefSchema = z
  .object({
    mode: VisibilityModeSchema,
    layerAssessments: z.array(OpenDataRecommendationSchema),
    reasoning: z.array(z.string()),
    recommendedNextActions: z.array(z.string()),
    source: z
      .object({
        type: z.literal("annecy_sig_mcp_open_data_recommendation"),
        schemaVersion: OpenDataSchemaVersionLiteral,
        serverVersion: ServerVersionSchema,
        inventory: InventorySourceV1Schema,
        samplingMode: SamplingModeSchema,
        samplingReliabilityNote: z.string(),
      })
      .strict(),
    samplingAudit: z
      .object({
        failedSampleLayers: z.array(SamplingAuditEntrySchema),
        emptySampleLayers: z.array(SamplingAuditEntrySchema),
        geometryUnknownLayers: z.array(SamplingAuditEntrySchema),
      })
      .strict(),
  })
  .passthrough()
  .describe("Brief open data — contrat `open_data.v1`.");

/** ---- Chatbot citoyen ----------------------------------------------- */

export const ChatbotLayerDetailSchema = z
  .object({
    serviceKey: ServiceKeySchema,
    layerId: LayerIdSchema,
    layerName: z.string(),
    label: z.string(),
    tier: z.enum([
      "ready",
      "usable_now",
      "usable_with_caution",
      "not_ready",
      "unknown_requires_check",
    ]),
    missingForGoodCitizenAnswer: z.array(z.string()),
    safeAnswerRules: z.array(z.string()),
    mustQualifyAnswer: z.boolean(),
    hallucinationRisks: z.array(z.string()),
    reasons: z.array(z.string()),
  })
  .strict()
  .describe("Détail couche pour le rapport de maturité chatbot citoyen.");

export const ChatbotReadinessReportSchema = z
  .object({
    executiveSummary: z.string(),
    ready: z.array(LayerRefSchema),
    usableNow: z.array(LayerRefWithReasonsSchema),
    usableWithCaution: z.array(LayerRefWithReasonsSchema),
    notReady: z.array(LayerRefWithReasonsSchema),
    unknownRequiresCheck: z.array(LayerRefWithReasonsSchema),
    perLayer: z.array(ChatbotLayerDetailSchema),
    typicalQuestions: z.array(z.string()),
    hallucinationRisks: z.array(z.string()),
    source: z
      .object({
        type: z.literal("annecy_sig_mcp_chatbot_readiness"),
        schemaVersion: ChatbotSchemaVersionLiteral,
        serverVersion: ServerVersionSchema,
        inventory: InventorySourceV1Schema,
        runtimeMs: RuntimeMsSchema.optional(),
      })
      .strict(),
  })
  .passthrough()
  .describe("Rapport de maturité chatbot citoyen — contrat `chatbot_readiness.v1`.");

/** ---- Layer action plan -------------------------------------------- */

export const LayerActionPlanSchema = z
  .object({
    executiveSummary: z.string(),
    serviceKey: ServiceKeySchema,
    layerId: LayerIdSchema,
    layerName: z.string(),
    visibility: VisibilityModeSchema,
    riskLevel: RiskLevelSchema,
    usageStatus: UsageStatusSchema,
    sampleStatus: SampleStatusSchema,
    geometryStatus: GeometryStatusSchema,
    fieldAlignment: z
      .object({
        validFields: z.array(z.string()),
        missingFields: z.array(z.string()),
        ignoredFieldsPreview: z
          .array(z.string())
          .describe("Aperçu plafonné des champs ArcGIS hors registre (filtré des champs sensibles)."),
        objectIdField: z.string().nullable(),
        geometryType: z.string().nullable(),
        supportsQuery: z.boolean(),
      })
      .strict()
      .describe("Alignement champs registre/ArcGIS tel qu’exposé par `describe_layer` (ignoredFieldsPreview, pas la liste brute)."),
    semanticMappings: z.record(z.string(), z.unknown()),
    semanticValidation: SemanticValidationSchema,
    semanticCoverage: SemanticCoverageSchema,
    possibleUses: z
      .object({
        chatbot: z.string(),
        openData: z.string(),
        internalDashboard: z.string(),
        website: z.string(),
      })
      .strict(),
    technicalIssues: z.array(z.string()),
    dataQualityIssues: z.array(z.string()),
    businessQuestions: z.array(z.string()),
    recommendedTechnicalActions: z.array(z.string()),
    recommendedBusinessActions: z.array(z.string()),
    priority: z.enum(["high", "medium", "low"]),
    technicalScore: z.number(),
    dataQualityScore: z.number(),
    preliminaryQualityScore: z.number(),
    source: z
      .object({
        type: z.literal("annecy_sig_mcp_layer_action_plan"),
        schemaVersion: LayerActionPlanSchemaVersionLiteral,
        serverVersion: ServerVersionSchema,
        inventory: InventorySourceV1Schema,
      })
      .strict(),
  })
  .passthrough()
  .describe("Plan d’action pour une couche — contrat `layer_action_plan.v1`.");

/** ---- Inventory report (V0.9) -------------------------------------- */

const ReportLayerRefSchema = z
  .object({
    serviceKey: ServiceKeySchema,
    layerId: LayerIdSchema,
    layerName: z.string(),
    score: z.number(),
  })
  .strict();

const TechEntrySchema = z
  .object({
    serviceKey: ServiceKeySchema,
    layerId: LayerIdSchema,
    layerName: z.string(),
    sampleStatus: z.string(),
    sampleError: z.string().optional(),
    missingRegistryFields: z.array(z.string()),
  })
  .strict();

const ToCleanEntrySchema = ReportLayerRefSchema.extend({
  reasons: z.array(z.string()),
}).strict();

export const InventoryReportSchema = z
  .object({
    executiveSummary: z.string(),
    servicesAnalyzed: z.number().int().nonnegative(),
    layersAnalyzed: z.number().int().nonnegative(),
    usageStatusCounts: z
      .record(UsageStatusSchema, z.number().int().nonnegative())
      .describe("Compteurs par `usageStatus` (clé typée)."),
    countsSummary: z
      .object({
        ready: z.number().int().nonnegative(),
        usable: z.number().int().nonnegative(),
        needsFieldMapping: z.number().int().nonnegative(),
        toClean: z.number().int().nonnegative(),
        toInvestigateTechnically: z.number().int().nonnegative(),
        internal: z.number().int().nonnegative(),
      })
      .strict(),
    samplingFailureCount: z.number().int().nonnegative(),
    emptySampleCount: z.number().int().nonnegative(),
    geometryUnknownCount: z.number().int().nonnegative(),
    samplingFailures: z.array(TechEntrySchema),
    layersWithRegistryFieldGaps: z.array(
      z
        .object({
          serviceKey: ServiceKeySchema,
          layerId: LayerIdSchema,
          layerName: z.string(),
          missingFields: z.array(z.string()),
        })
        .strict(),
    ),
    top5Best: z.array(ReportLayerRefSchema),
    top5Worst: z.array(ReportLayerRefSchema),
    frequentWarnings: z.array(
      z
        .object({
          message: z.string(),
          count: z.number().int().positive(),
        })
        .strict(),
    ),
    readyToUse: z.array(ReportLayerRefSchema),
    usableNow: z.array(ReportLayerRefSchema),
    usableWithCaution: z.array(ReportLayerRefSchema),
    needsFieldMapping: z.array(
      ReportLayerRefSchema.extend({
        hints: z.array(z.string()),
      }).strict(),
    ),
    toClean: z.array(ToCleanEntrySchema),
    toInvestigateTechnically: z.array(TechEntrySchema),
    keepInternal: z.array(
      z
        .object({
          serviceKey: ServiceKeySchema,
          layerId: LayerIdSchema,
          layerName: z.string(),
          visibility: z.string(),
        })
        .strict(),
    ),
    actionRecommendations: z.array(z.string()),
    source: z
      .object({
        type: z.literal("annecy_sig_mcp_report"),
        schemaVersion: ReportSchemaVersionLiteral,
        serverVersion: ServerVersionSchema,
        inventory: InventorySourceV1Schema,
        runtimeMs: RuntimeMsSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .describe("Rapport d’inventaire structuré — contrat `report.v1`.");

/** ---- Internal dashboard brief (V0.9) ------------------------------ */

/**
 * Les enregistrements de travaux exposés sont des `record(string, unknown)` :
 * chaque champ est déjà passé par `redactTravail` côté code applicatif (suppression
 * de `created_user`, `last_edited_*`, `url_pj`, `url_piece_jointe`). On reste
 * permissif au niveau Zod **par design** : la sanitation est portée par le code,
 * pas par le schéma — verrouiller la liste de clés ici casserait à chaque évolution
 * du flux travaux côté ArcGIS.
 */
const WorksRecordSchema = z
  .record(z.string(), z.unknown())
  .describe(
    "Enregistrement travaux sanitisé (les champs sensibles ont été retirés en amont par `redactTravail`).",
  );

const WorksStatsSchema = z
  .record(z.string(), z.unknown())
  .describe("Statistiques agrégées d’un appel `list_*_works` (forme libre).");

export const InternalDashboardBriefSchema = z
  .object({
    executiveSummary: z.string(),
    dateReference: z.string(),
    travauxEnCours: z
      .object({
        total: z.number().int().nonnegative(),
        stats: WorksStatsSchema,
      })
      .strict(),
    travauxEnRetard: z
      .object({
        total: z.number().int().nonnegative(),
        stats: WorksStatsSchema,
      })
      .strict(),
    travauxSansGeometrie: z.number().int().nonnegative(),
    travauxSansAdresse: z.number().int().nonnegative(),
    travauxSansTitre: z.number().int().nonnegative(),
    travauxTerminesNonConformesHeuristique: z.number().int().nonnegative(),
    recommendedIndicators: z.array(z.string()),
    qualityAlerts: z.array(z.string()),
    travauxEnCoursEchantillon: z.array(WorksRecordSchema),
    travauxEnRetardEchantillon: z.array(WorksRecordSchema),
    source: z
      .object({
        type: z.literal("annecy_sig_mcp_internal_dashboard"),
        schemaVersion: InternalDashboardSchemaVersionLiteral,
        serverVersion: ServerVersionSchema,
        // `travaux` agrège les blocs `source` sortis de `list_current_works` /
        // `list_late_works` — leur forme exacte est portée par leur outil et non
        // par ce schéma de rapport.
        travaux: z.array(z.unknown()),
        runtimeMs: RuntimeMsSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .describe("Brief dashboard interne travaux — contrat `internal_dashboard.v1`.");
