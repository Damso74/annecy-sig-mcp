import { z } from "zod";
import {
  CHATBOT_SCHEMA_VERSION,
  INTERNAL_DASHBOARD_SCHEMA_VERSION,
  INVENTORY_SCHEMA_VERSION,
  LAYER_ACTION_PLAN_SCHEMA_VERSION,
  OPEN_DATA_SCHEMA_VERSION,
  PUBLIC_WORKS_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION,
} from "../runtime/version.js";

/**
 * Briques Zod réutilisées par tous les contrats V0.8 / V0.9.
 *
 * Principes :
 * - chaque brique est nommée et **`describe()`d** : la documentation passe
 *   directement dans les JSON Schemas générés ;
 * - aucune brique ne `passthrough()` au niveau racine — la sanitation des
 *   champs sensibles reste portée par le code applicatif (sanitize.ts,
 *   sanitizeArcgisMetadata.ts, redaction des rapports), et non par le schéma ;
 * - les `schemaVersion` sont des littéraux figés depuis `runtime/version.ts` —
 *   c’est le verrou contractuel qui interdit le retour silencieux à v04/v05/v06.
 */

/** Identifiant de service (clé du registre, ex. `equipements`, `mobilite`, `travaux`). */
export const ServiceKeySchema = z
  .string()
  .min(1)
  .describe("Clé d’un service du registre (ex. `equipements`, `mobilite`, `travaux`).");

/** Identifiant numérique de couche ArcGIS au sein du service. */
export const LayerIdSchema = z
  .number()
  .int()
  .nonnegative()
  .describe("Identifiant numérique d’une couche ArcGIS (entier ≥ 0).");

/** Version du package npm publié — non garantie stable entre releases. */
export const ServerVersionSchema = z
  .string()
  .min(1)
  .describe("Version applicative du serveur MCP — issue de package.json (`SERVER_VERSION`).");

/** Identifiant stable du contrat JSON (ex. `inventory.v1`). */
export const SchemaVersionSchema = z
  .string()
  .min(1)
  .describe(
    "Identifiant stable du contrat JSON pour ce payload (ex. `inventory.v1`). Indépendant de `serverVersion`.",
  );

/** Durée d’exécution observable (ms). */
export const RuntimeMsSchema = z
  .number()
  .nonnegative()
  .describe("Durée totale du traitement côté serveur, exprimée en millisecondes.");

/** Formats d’export pris en charge pour les rapports. */
export const ReportFormatSchema = z
  .enum(["json", "markdown"])
  .describe("Format de sortie d’un rapport (JSON structuré ou Markdown).");

/** Mode de visibilité métier — détermine quelles couches sont exposées. */
export const VisibilityModeSchema = z
  .enum(["public", "internal"])
  .describe("Mode de visibilité : `public` filtre les couches internal, `internal` les inclut.");

/** Statut technique d’un échantillon ArcGIS récupéré pour une couche. */
export const SampleStatusSchema = z
  .enum(["ok", "empty", "failed"])
  .describe("Statut de l’échantillon ArcGIS récupéré (succès non vide / vide / échec).");

/** Statut géométrique observé sur l’échantillon. */
export const GeometryStatusSchema = z
  .enum(["present", "missing", "unknown"])
  .describe("Présence de la géométrie sur l’échantillon ArcGIS.");

/** Niveau de risque déclaré au registre (lecture/diffusion). */
export const RiskLevelSchema = z
  .enum(["green", "orange", "red"])
  .describe("Niveau de risque métier/juridique déclaré dans le registre.");

/** Statut métier d’usage dérivé pour une couche. */
export const UsageStatusSchema = z
  .enum([
    "ready",
    "usable_now",
    "usable_with_caution",
    "needs_field_mapping",
    "needs_data_cleaning",
    "to_investigate_technically",
    "internal_only",
    "not_usable",
  ])
  .describe("Statut métier d’usage agrégé sur la couche (V0.5+).");

/** Stratégie d’échantillonnage : standard ou rapide (1 entité). */
export const SamplingModeSchema = z
  .enum(["fast", "standard"])
  .describe("Mode d’échantillonnage utilisé pour la passe d’inventaire.");

/** Stratégie de fallback `outFields` retenue par l’échantillonneur. */
export const SampleFallbackUsedSchema = z
  .enum(["registry_valid", "star", "objectid_only", "none"])
  .describe("Stratégie de fallback utilisée pour récupérer l’échantillon.");

/** Cible d’inventaire optionnelle. */
export const InventoryTargetSchema = z
  .object({
    serviceKey: ServiceKeySchema,
    layerId: LayerIdSchema.optional(),
  })
  .strict()
  .describe(
    "Cible d’inventaire — sans `layerId`, toutes les couches visibles du service dans le mode courant.",
  );

/** Diagnostic typé attaché à une couche (V0.7+). */
export const InventoryDiagnosticSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .describe("Code court du diagnostic (ex. SAMPLE_FAILED, GEOMETRY_MISSING)."),
    severity: z.enum(["info", "warning", "error"]).describe("Sévérité du diagnostic."),
    message: z.string().describe("Message lisible (sanitisé en amont)."),
    details: z.record(z.string(), z.unknown()).optional().describe("Détails additionnels (libre)."),
  })
  .strict()
  .describe("Diagnostic structuré rattaché à une couche d’inventaire.");

/** Compteurs agrégés des diagnostics côté `source.diagnostics`. */
export const InventoryDiagnosticsCountsSchema = z
  .object({
    failedSamples: z.number().int().nonnegative().describe("Nombre de couches en échec d’échantillon."),
    emptySamples: z.number().int().nonnegative().describe("Nombre de couches à échantillon vide."),
    geometryUnknownLayers: z
      .number()
      .int()
      .nonnegative()
      .describe("Nombre de couches dont la géométrie n’a pas pu être évaluée."),
  })
  .strict()
  .describe("Agrégats compacts des diagnostics, exposés dans `source.diagnostics`.");

/** Métadonnées d’exécution de la passe d’inventaire. */
export const InventoryExecutionMetaSchema = z
  .object({
    concurrency: z.number().int().positive().describe("Niveau de parallélisme effectif."),
    fast: z.boolean().describe("Indique si le mode rapide a été utilisé (sample = 1)."),
    requestedSampleLimit: z.number().int().nonnegative().describe("Limite d’échantillon demandée."),
    effectiveSampleLimit: z
      .number()
      .int()
      .nonnegative()
      .describe("Limite d’échantillon réellement transmise à ArcGIS."),
    serviceKeysFilter: z
      .array(ServiceKeySchema)
      .nullable()
      .describe("Liste des `serviceKeys` filtrants, ou null si non utilisé."),
    targetsFilter: z
      .array(InventoryTargetSchema)
      .nullable()
      .describe("Liste des cibles `targets` filtrantes, ou null si non utilisé."),
  })
  .strict()
  .describe("Métadonnées d’exécution de la passe d’inventaire (concurrency, fast, filtres).");

/** Bloc `source` standardisé pour tout résultat d’inventaire. */
export const InventorySourceV1Schema = z
  .object({
    type: z.literal("annecy_sig_mcp_inventory"),
    schemaVersion: z.literal(INVENTORY_SCHEMA_VERSION).describe("Version stable du schéma `inventory.v1`."),
    serverVersion: ServerVersionSchema,
    runtimeMs: RuntimeMsSchema,
    layersScanned: z.number().int().nonnegative().describe("Nombre de couches effectivement parcourues."),
    diagnostics: InventoryDiagnosticsCountsSchema,
    execution: InventoryExecutionMetaSchema,
  })
  .strict()
  .describe("Bloc `source` d’un résultat d’inventaire (contrat `inventory.v1`).");

/** ----- Constantes littérales pour les `schemaVersion` propres à chaque rapport ----- */
export const InventorySchemaVersionLiteral = z.literal(INVENTORY_SCHEMA_VERSION);
export const OpenDataSchemaVersionLiteral = z.literal(OPEN_DATA_SCHEMA_VERSION);
export const ChatbotSchemaVersionLiteral = z.literal(CHATBOT_SCHEMA_VERSION);
export const ReportSchemaVersionLiteral = z.literal(REPORT_SCHEMA_VERSION);
export const LayerActionPlanSchemaVersionLiteral = z.literal(LAYER_ACTION_PLAN_SCHEMA_VERSION);
export const InternalDashboardSchemaVersionLiteral = z.literal(INTERNAL_DASHBOARD_SCHEMA_VERSION);
export const PublicWorksSchemaVersionLiteral = z.literal(PUBLIC_WORKS_SCHEMA_VERSION);

/** Alias historique conservé pour compatibilité d’import — V0.8 utilisait ce nom. */
export const NonEmptyString = z.string().min(1);
