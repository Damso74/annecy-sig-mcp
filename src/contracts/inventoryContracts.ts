import { z } from "zod";
import {
  GeometryStatusSchema,
  InventoryDiagnosticSchema,
  InventorySourceV1Schema,
  LayerIdSchema,
  RiskLevelSchema,
  SampleFallbackUsedSchema,
  SampleStatusSchema,
  SamplingModeSchema,
  ServiceKeySchema,
  UsageStatusSchema,
  VisibilityModeSchema,
} from "./common.js";

/**
 * Schémas Zod pour le résultat d’inventaire (V0.8 / V0.9 — schemaVersion stable `inventory.v1`).
 *
 * Les schémas sont **raffinés en V0.9** :
 * - `semanticValidation` et `semanticCoverage` ont leur structure propre, plus aucun `unknown` racine ;
 * - `fieldValidation` est figé sur le contrat `RegistryArcgisFieldValidation` ;
 * - `semanticMappings` reste volontairement souple (`record(string, unknown)`) côté Zod : la
 *   forme exacte est portée par le typage TypeScript dans `registry.ts` et doublonner ici
 *   ferait dériver les deux sources sans bénéfice de validation.
 */

/**
 * Couverture par clé sémantique : pour chaque mapping connu, ratio d’entités
 * où la valeur est non vide. Sert au scoring qualité et aux rapports.
 */
const SemanticCoveragePerMappingSchema = z
  .object({
    field: z.string().describe("Nom du champ ArcGIS effectivement utilisé pour ce mapping."),
    nonNullCount: z.number().int().nonnegative(),
    nullCount: z.number().int().nonnegative(),
    coverageRatio: z
      .number()
      .min(0)
      .max(1)
      .describe("Ratio non-null / total (3 décimales)."),
  })
  .strict();

export const SemanticCoverageSchema = z
  .object({
    totalFeatures: z
      .number()
      .int()
      .nonnegative()
      .describe("Nombre d’entités effectivement échantillonnées."),
    coverageByMapping: z
      .record(z.string(), SemanticCoveragePerMappingSchema)
      .describe("Couverture par clé sémantique (`labelField`, `addressField`, …)."),
    warnings: z.array(z.string()),
  })
  .strict()
  .describe("Couverture sémantique calculée sur l’échantillon (V0.5+).");

/** Validation des `semanticMappings` registre vs métadonnées ArcGIS. */
export const SemanticValidationSchema = z
  .object({
    validMappings: z
      .record(z.string(), z.string())
      .describe("Clé sémantique → nom canonique du champ ArcGIS."),
    invalidMappings: z.array(
      z
        .object({
          key: z.string(),
          field: z.string(),
          reason: z.string(),
        })
        .strict(),
    ),
    missingEssentialMappings: z
      .array(z.string())
      .describe("Clés sémantiques essentielles absentes ou invalides."),
    warnings: z.array(z.string()),
  })
  .strict()
  .describe("Résultat de la validation des `semanticMappings` registre vs ArcGIS.");

/** Confrontation registre / ArcGIS pour les champs (V0.5+). */
export const FieldValidationSchema = z
  .object({
    validFields: z
      .array(z.string())
      .describe("Noms canoniques tels qu’exposés par ArcGIS (utilisables dans `outFields`)."),
    missingFields: z
      .array(z.string())
      .describe("Champs demandés par le registre mais absents de la couche."),
    ignoredFields: z
      .array(z.string())
      .describe("Champs présents côté ArcGIS mais non demandés (liste plafonnée)."),
    objectIdField: z.string().nullable(),
    geometryType: z.string().nullable(),
    supportsQuery: z.boolean(),
  })
  .strict()
  .describe("Confrontation des champs registre avec les métadonnées ArcGIS de la couche.");

/**
 * Une ligne d’inventaire pour une couche.
 *
 * Choix V0.9 : la racine reste **`passthrough`** car les rapports en aval (chatbot,
 * open data, action plan) re-projettent ce row dans leur propre payload typé, et
 * verrouiller toutes les clés ici imposerait de mettre à jour les contrats à chaque
 * ajustement d’inventaire — sans bénéfice métier. La sanitation des champs sensibles
 * reste portée par `sanitizeArcgisMetadata` et le code applicatif.
 */
export const InventoryLayerRowSchema = z
  .object({
    serviceKey: ServiceKeySchema,
    layerId: LayerIdSchema,
    layerName: z.string(),
    visibility: VisibilityModeSchema,
    riskLevel: RiskLevelSchema,
    geometryType: z.string().nullable(),
    count: z.number().int().nullable(),
    fields: z
      .object({
        publicFields: z.array(z.string()),
        internalFields: z.array(z.string()).optional(),
      })
      .strict(),
    sampleReturned: z.number().int().nonnegative(),
    hasGeometryInSample: z.boolean(),
    geometryStatus: GeometryStatusSchema,
    sampleStatus: SampleStatusSchema,
    sampleError: z.string().optional(),
    sampleFallbackUsed: SampleFallbackUsedSchema,
    fieldValidation: FieldValidationSchema,
    nullRateSummary: z.record(z.string(), z.number()),
    warnings: z.array(z.string()),
    diagnostics: z.array(InventoryDiagnosticSchema),
    suggestedUseCases: z.array(z.string()),
    preliminaryQualityScore: z.number(),
    scoreBreakdown: z.record(z.string(), z.number()),
    // `semanticMappings` reste typé côté TS (registry.ts) ; au niveau JSON Schema on
    // accepte un record libre — la validation effective est faite via `semanticValidation`.
    semanticMappings: z.record(z.string(), z.unknown()).optional(),
    semanticValidation: SemanticValidationSchema,
    semanticCoverage: SemanticCoverageSchema,
    usageStatus: UsageStatusSchema,
    usageWarnings: z.array(z.string()),
    technicalScore: z.number(),
    dataQualityScore: z.number(),
    samplingMode: SamplingModeSchema,
  })
  .passthrough()
  .describe("Ligne d’inventaire pour une couche (V0.5/V0.6/V0.7).");

export const InventoryRunResultSchema = z
  .object({
    mode: VisibilityModeSchema,
    requestedSampleLimit: z.number().int().nonnegative(),
    effectiveSampleLimit: z.number().int().nonnegative(),
    /** Alias historique de `requestedSampleLimit` — conservé pour compat V0.5+. */
    sampleLimit: z.number().int().nonnegative(),
    samplingMode: SamplingModeSchema,
    samplingReliabilityNote: z.string(),
    layers: z.array(InventoryLayerRowSchema),
    source: InventorySourceV1Schema,
  })
  .strict()
  .describe("Résultat complet d’une passe d’inventaire (contrat `inventory.v1`).");
