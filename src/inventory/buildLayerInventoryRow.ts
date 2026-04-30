import type { AppConfig } from "../config.js";
import type { LayerRegistryEntry, VisibilityMode } from "../registry.js";
import { countLayerRequest } from "../arcgis/client.js";
import type { createLayerMetadataRunCache } from "../arcgis/metadataCache.js";
import {
  assertSafeWhere,
  getEffectiveFields,
  validateServiceLayer,
} from "../utils/validation.js";
import { computePreliminaryQualityScore } from "../utils/inventoryScore.js";
import { isAppError } from "../utils/errors.js";
import { validateRegistryFieldsAgainstArcGIS } from "../utils/arcgisFieldValidation.js";
import { fetchInventorySampleWithFallbacks } from "../utils/inventorySampleArcgis.js";
import { validateSemanticMappings, getSemanticCoverage } from "../utils/semanticMappings.js";
import { deriveUsageStatus, getSemanticEssentialKeys } from "../utils/inventoryUsage.js";
import {
  getDateKeysForInventory,
  getReadableKeysForInventory,
  getInventoryFieldsForMode,
  preparePropsForInventoryStats,
} from "./inventoryFields.js";
import {
  dateFreshnessProxy,
  deriveGeometryStatus,
  fillRate,
  nullRateOnKeys,
  nullRateSummary,
} from "./inventorySampling.js";
import {
  inventoryDiagnostic,
  pushInventoryWarning,
  type InventoryDiagnostic,
} from "./inventoryDiagnostics.js";
import type { InventoryDiagnosticCode } from "./inventoryDiagnostics.js";
import type { InventoryLayerRow, SampleFallbackUsed, SampleStatus } from "./types.js";

export type InventoryRowBuildContext = {
  cfg: AppConfig;
  mode: VisibilityMode;
  fast: boolean;
  effectiveSampleLimit: number;
  samplingMode: "fast" | "standard";
  metaCache: ReturnType<typeof createLayerMetadataRunCache>;
};

function buildStubInventoryLayerRow(
  entry: LayerRegistryEntry,
  ctx: Pick<InventoryRowBuildContext, "mode" | "fast" | "samplingMode">,
  primaryMessage: string,
  primaryCode: InventoryDiagnosticCode,
  primarySeverity: InventoryDiagnostic["severity"] = "error",
): InventoryLayerRow {
  const { mode, fast, samplingMode } = ctx;
  const warnings: string[] = [];
  const diagnostics: InventoryDiagnostic[] = [];
  pushInventoryWarning(
    warnings,
    diagnostics,
    inventoryDiagnostic(primaryCode, primarySeverity, primaryMessage, { serviceKey: entry.serviceKey, layerId: entry.layerId }),
  );
  if (fast) {
    pushInventoryWarning(
      warnings,
      diagnostics,
      inventoryDiagnostic(
        "FAST_MODE_LIMITED_SAMPLE",
        "warning",
        "Mode rapide : échantillon minimal — les ratios null / libellés ne reflètent pas la volumétrie réelle.",
      ),
    );
  }
  const fieldsOut = getInventoryFieldsForMode(entry, mode);
  const requested = [...getEffectiveFields(entry, mode)];
  const stubValidation = {
    validFields: [] as string[],
    missingFields: requested,
    ignoredFields: [] as string[],
    objectIdField: null as string | null,
    geometryType: entry.geometryType ?? null,
    supportsQuery: false,
  };
  const { score, breakdown, technicalScore, dataQualityScore } = computePreliminaryQualityScore({
    visibility: entry.visibility,
    serviceKey: entry.serviceKey,
    riskLevel: entry.riskLevel,
    hasGeometryInSample: false,
    geometryStatus: "unknown",
    sampleReliable: false,
    readableFillRate: 0,
    keyFieldNullRate: 1,
    dateFreshnessProxy: 0,
    supportsQuery: false,
    missingRegistryFieldRatio: 1,
    sampleFallbackUsed: "none",
  });
  const essential = getSemanticEssentialKeys(entry);
  const semanticValidation =
    entry.semanticMappings !== undefined
      ? {
          validMappings: {},
          invalidMappings: [] as { key: string; field: string; reason: string }[],
          missingEssentialMappings: [...essential],
          warnings: ["Métadonnées ArcGIS indisponibles : validation sémantique impossible."],
        }
      : validateSemanticMappings({
          semanticMappings: undefined,
          arcgisFieldNames: [],
          essentialKeys: [],
        });
  const semanticCoverage = getSemanticCoverage({ features: [], semanticMappings: entry.semanticMappings });
  const { usageStatus, usageWarnings } = deriveUsageStatus({
    entry,
    sampleStatus: "failed",
    geometryStatus: "unknown",
    fieldValidation: stubValidation,
    semanticValidation,
    semanticCoverage,
    preliminaryQualityScore: score,
    warnings,
  });
  return {
    serviceKey: entry.serviceKey,
    layerId: entry.layerId,
    layerName: entry.layerName,
    visibility: entry.visibility,
    riskLevel: entry.riskLevel,
    geometryType: stubValidation.geometryType,
    count: null,
    fields: fieldsOut,
    sampleReturned: 0,
    hasGeometryInSample: false,
    geometryStatus: "unknown",
    sampleStatus: "failed",
    sampleError: primaryMessage,
    sampleFallbackUsed: "none",
    fieldValidation: stubValidation,
    nullRateSummary: {},
    warnings,
    diagnostics,
    suggestedUseCases: [...entry.useCases],
    preliminaryQualityScore: score,
    scoreBreakdown: breakdown,
    semanticMappings: entry.semanticMappings,
    semanticValidation,
    semanticCoverage,
    usageStatus,
    usageWarnings,
    technicalScore,
    dataQualityScore,
    samplingMode,
  };
}

export async function buildInventoryLayerRow(
  entry: LayerRegistryEntry,
  ctx: InventoryRowBuildContext,
): Promise<InventoryLayerRow> {
  const { cfg, mode, fast, effectiveSampleLimit, samplingMode, metaCache } = ctx;
  try {
    validateServiceLayer(entry.serviceKey, entry.layerId, mode);
    const warnings: string[] = [];
    const diagnostics: InventoryDiagnostic[] = [];
    if (fast) {
      pushInventoryWarning(
        warnings,
        diagnostics,
        inventoryDiagnostic(
          "FAST_MODE_LIMITED_SAMPLE",
          "warning",
          "Mode rapide : échantillon minimal — les ratios null / libellés ne reflètent pas la volumétrie réelle.",
        ),
      );
    }

    let meta;
    try {
      meta = await metaCache.get(entry.serviceKey, cfg, entry.servicePath, entry.layerId);
    } catch (e) {
      const msg = isAppError(e) ? e.message : String(e);
      return buildStubInventoryLayerRow(
        entry,
        { mode, fast, samplingMode },
        `Métadonnées ArcGIS indisponibles : ${msg}`,
        "METADATA_FAILED",
      );
    }

    const requestedFields = [...getEffectiveFields(entry, mode)];
    const fieldValidation = validateRegistryFieldsAgainstArcGIS(requestedFields, meta);
    if (fieldValidation.missingFields.length > 0) {
      pushInventoryWarning(
        warnings,
        diagnostics,
        inventoryDiagnostic(
          "FIELD_REGISTRY_MISSING",
          "warning",
          `Champs registre absents du service ArcGIS (${fieldValidation.missingFields.length}) : ${fieldValidation.missingFields.slice(0, 12).join(", ")}${fieldValidation.missingFields.length > 12 ? "…" : ""}`,
          { missingFields: fieldValidation.missingFields.slice(0, 24) },
        ),
      );
    }

    let count: number | null = null;
    try {
      assertSafeWhere("1=1");
      count = await countLayerRequest(cfg, entry.servicePath, entry.layerId, "1=1");
    } catch (e) {
      count = null;
      const msg = isAppError(e) ? e.message : String(e);
      pushInventoryWarning(
        warnings,
        diagnostics,
        inventoryDiagnostic("COUNT_FAILED", "warning", `Comptage indisponible : ${msg}`, {
          serviceKey: entry.serviceKey,
          layerId: entry.layerId,
        }),
      );
    }

    const sample = await fetchInventorySampleWithFallbacks(cfg, entry, effectiveSampleLimit, fieldValidation);

    let cleanedRows: Record<string, unknown>[] = [];
    let sampleReturned = 0;

    if (sample.sampleStatus === "failed") {
      pushInventoryWarning(
        warnings,
        diagnostics,
        inventoryDiagnostic(
          "SAMPLE_FAILED",
          "warning",
          `Géométrie inconnue : échantillon non récupéré (${sample.sampleError ?? "erreur"})`,
          { sampleError: sample.sampleError },
        ),
      );
    } else if (sample.sampleStatus === "empty") {
      pushInventoryWarning(
        warnings,
        diagnostics,
        inventoryDiagnostic("SAMPLE_EMPTY", "warning", "Géométrie inconnue : échantillon vide (0 entité sur la requête utilisée)."),
      );
    } else if (sample.parsed) {
      sampleReturned = sample.parsed.features.length;
      if (sample.parsed.rawExceeded) {
        pushInventoryWarning(
          warnings,
          diagnostics,
          inventoryDiagnostic(
            "TRANSFER_LIMIT_WARNING",
            "info",
            "Échantillon : limite de transfert ArcGIS possible (exceededTransferLimit).",
          ),
        );
      }
      for (const f of sample.parsed.features) {
        cleanedRows.push(preparePropsForInventoryStats(f.properties, entry, mode));
      }
    }

    const geometryStatus = deriveGeometryStatus(sample.sampleStatus as SampleStatus, sample.parsed?.features ?? []);

    if (geometryStatus === "missing") {
      pushInventoryWarning(
        warnings,
        diagnostics,
        inventoryDiagnostic("GEOMETRY_MISSING", "warning", "Géométrie : aucune géométrie utile sur l’échantillon récupéré."),
      );
    }

    const hasGeometryInSample = geometryStatus === "present";
    const sampleReliable = sample.sampleStatus === "ok";

    const rk = getReadableKeysForInventory(entry);
    const readableFillRate = fillRate(cleanedRows, rk);
    const keyFieldNullRate = nullRateOnKeys(cleanedRows, rk);
    const nullSummary = nullRateSummary(
      cleanedRows,
      [...getEffectiveFields(entry, mode)].map(f => f.toLowerCase()),
    );
    const dateKeys = getDateKeysForInventory(entry);
    const dateProxy = dateFreshnessProxy(cleanedRows, dateKeys);
    const missRatio = requestedFields.length > 0 ? fieldValidation.missingFields.length / requestedFields.length : 0;

    const { score, breakdown, technicalScore, dataQualityScore } = computePreliminaryQualityScore({
      visibility: entry.visibility,
      serviceKey: entry.serviceKey,
      riskLevel: entry.riskLevel,
      hasGeometryInSample,
      geometryStatus,
      sampleReliable,
      readableFillRate,
      keyFieldNullRate,
      dateFreshnessProxy: dateProxy,
      supportsQuery: fieldValidation.supportsQuery,
      missingRegistryFieldRatio: missRatio,
      sampleFallbackUsed: sample.sampleFallbackUsed as SampleFallbackUsed,
    });

    const fieldsOut = getInventoryFieldsForMode(entry, mode);
    const arcgisFieldNames = (meta.fields ?? []).map(f => f.name);
    const essentialKeys = getSemanticEssentialKeys(entry);
    const semanticValidation = validateSemanticMappings({
      semanticMappings: entry.semanticMappings,
      arcgisFieldNames,
      essentialKeys,
    });
    const coverageFeatures = cleanedRows.map(properties => ({ properties }));
    const semanticCoverage = getSemanticCoverage({
      features: coverageFeatures,
      semanticMappings: entry.semanticMappings,
    });
    const { usageStatus, usageWarnings } = deriveUsageStatus({
      entry,
      sampleStatus: sample.sampleStatus,
      geometryStatus,
      fieldValidation,
      semanticValidation,
      semanticCoverage,
      preliminaryQualityScore: score,
      warnings,
    });

    return {
      serviceKey: entry.serviceKey,
      layerId: entry.layerId,
      layerName: entry.layerName,
      visibility: entry.visibility,
      riskLevel: entry.riskLevel,
      geometryType: fieldValidation.geometryType ?? entry.geometryType ?? null,
      count,
      fields: fieldsOut,
      sampleReturned,
      hasGeometryInSample,
      geometryStatus,
      sampleStatus: sample.sampleStatus as SampleStatus,
      sampleError: sample.sampleError,
      sampleFallbackUsed: sample.sampleFallbackUsed,
      fieldValidation,
      nullRateSummary: nullSummary,
      warnings,
      diagnostics,
      suggestedUseCases: [...entry.useCases],
      preliminaryQualityScore: score,
      scoreBreakdown: breakdown,
      semanticMappings: entry.semanticMappings,
      semanticValidation,
      semanticCoverage,
      usageStatus,
      usageWarnings,
      technicalScore,
      dataQualityScore,
      samplingMode,
    };
  } catch (e) {
    const msg = isAppError(e) ? e.message : String(e);
    return buildStubInventoryLayerRow(
      entry,
      { mode, fast, samplingMode },
      `Erreur inattendue inventaire : ${msg}`,
      "UNEXPECTED_INVENTORY_ERROR",
    );
  }
}
