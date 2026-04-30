import type { SemanticMappings, LayerRegistryEntry, VisibilityMode } from "../registry.js";
import type { GeometryStatus } from "../utils/inventoryScore.js";
import { getSemanticCoverage, validateSemanticMappings } from "../utils/semanticMappings.js";
import type { UsageStatus } from "../utils/inventoryUsage.js";
import type { RegistryArcgisFieldValidation } from "../utils/arcgisFieldValidation.js";
import type { InventoryDiagnostic } from "./inventoryDiagnostics.js";
import type { InventorySchemaVersion } from "../runtime/version.js";

export type SampleStatus = "ok" | "empty" | "failed";
export type SampleFallbackUsed = "registry_valid" | "star" | "objectid_only" | "none";

export type InventoryLayerRow = {
  serviceKey: string;
  layerId: number;
  layerName: string;
  visibility: VisibilityMode;
  riskLevel: LayerRegistryEntry["riskLevel"];
  geometryType: string | null;
  count: number | null;
  fields: { publicFields: string[]; internalFields?: string[] };
  sampleReturned: number;
  /** @deprecated utiliser geometryStatus. */
  hasGeometryInSample: boolean;
  geometryStatus: GeometryStatus;
  sampleStatus: SampleStatus;
  sampleError?: string;
  sampleFallbackUsed: SampleFallbackUsed;
  fieldValidation: RegistryArcgisFieldValidation;
  nullRateSummary: Record<string, number>;
  warnings: string[];
  /** V0.7 — diagnostics structurés (les `warnings` restent alignés pour compatibilité). */
  diagnostics: InventoryDiagnostic[];
  suggestedUseCases: string[];
  preliminaryQualityScore: number;
  scoreBreakdown: Record<string, number>;
  semanticMappings?: SemanticMappings;
  semanticValidation: ReturnType<typeof validateSemanticMappings>;
  semanticCoverage: ReturnType<typeof getSemanticCoverage>;
  usageStatus: UsageStatus;
  usageWarnings: string[];
  technicalScore: number;
  dataQualityScore: number;
  samplingMode: "fast" | "standard";
};

export type InventoryTarget = { serviceKey: string; layerId?: number };

export type InventoryRunInput = {
  mode: VisibilityMode;
  sampleLimit?: number;
  concurrency?: number;
  serviceKeys?: string[];
  targets?: InventoryTarget[];
  fast?: boolean;
};

export type InventoryDiagnosticsCounts = {
  failedSamples: number;
  emptySamples: number;
  geometryUnknownLayers: number;
};

export type InventoryExecutionMeta = {
  concurrency: number;
  fast: boolean;
  requestedSampleLimit: number;
  effectiveSampleLimit: number;
  serviceKeysFilter: string[] | null;
  targetsFilter: InventoryTarget[] | null;
};

export type InventorySourceV1 = {
  type: "annecy_sig_mcp_inventory";
  schemaVersion: InventorySchemaVersion;
  serverVersion: string;
  runtimeMs: number;
  layersScanned: number;
  diagnostics: InventoryDiagnosticsCounts;
  execution: InventoryExecutionMeta;
};

export type InventoryRunResult = {
  mode: VisibilityMode;
  requestedSampleLimit: number;
  effectiveSampleLimit: number;
  /**
   * @deprecated préférer `requestedSampleLimit` — conservé pour compatibilité (= requestedSampleLimit).
   */
  sampleLimit: number;
  samplingMode: "fast" | "standard";
  samplingReliabilityNote: string;
  layers: InventoryLayerRow[];
  source: InventorySourceV1;
};
