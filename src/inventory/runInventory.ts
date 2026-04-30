import type { AppConfig } from "../config.js";
import { createLayerMetadataRunCache } from "../arcgis/metadataCache.js";
import { clampSampleLimit, clampInventoryConcurrency } from "../utils/validation.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { INVENTORY_SCHEMA_VERSION, SERVER_VERSION } from "../runtime/version.js";
import type { InventoryRunInput, InventoryRunResult } from "./types.js";
import { resolveInventoryLayerEntries } from "./inventoryResolution.js";
import { buildInventoryLayerRow, type InventoryRowBuildContext } from "./buildLayerInventoryRow.js";
import { InventoryRunResultSchema, validateContract } from "../contracts/index.js";

export async function runInventoryAllLayers(cfg: AppConfig, input: InventoryRunInput): Promise<InventoryRunResult> {
  const mode = input.mode;
  const fast = input.fast === true;
  const concurrency = clampInventoryConcurrency(input.concurrency);
  const requestedSampleLimit = clampSampleLimit(input.sampleLimit ?? 20, 20, cfg.maxResultLimit);
  const effectiveSampleLimit = fast ? 1 : requestedSampleLimit;
  const samplingMode: "fast" | "standard" = fast ? "fast" : "standard";
  const samplingReliabilityNote = fast
    ? "Mode rapide : échantillon ArcGIS limité à 1 entité par couche — les scores data (nulls, libellés) sont peu représentatifs ; préférer une passe standard pour une décision métier."
    : "Mode standard : échantillon ArcGIS conforme au sampleLimit demandé.";

  const layerEntries = resolveInventoryLayerEntries(mode, input.serviceKeys, input.targets);
  const metaCache = createLayerMetadataRunCache();
  const startedAt = Date.now();

  const ctx: InventoryRowBuildContext = {
    cfg,
    mode,
    fast,
    effectiveSampleLimit,
    samplingMode,
    metaCache,
  };
  const rows = await mapWithConcurrency(layerEntries, concurrency, entry => buildInventoryLayerRow(entry, ctx));

  const failedSamples = rows.filter(l => l.sampleStatus === "failed").length;
  const emptySamples = rows.filter(l => l.sampleStatus === "empty").length;
  const geometryUnknownLayers = rows.filter(l => l.geometryStatus === "unknown").length;

  const source: InventoryRunResult["source"] = {
    type: "annecy_sig_mcp_inventory",
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    serverVersion: SERVER_VERSION,
    runtimeMs: Date.now() - startedAt,
    layersScanned: rows.length,
    diagnostics: { failedSamples, emptySamples, geometryUnknownLayers },
    execution: {
      concurrency,
      fast,
      requestedSampleLimit,
      effectiveSampleLimit,
      serviceKeysFilter: input.serviceKeys ?? null,
      targetsFilter: input.targets ?? null,
    },
  };

  const result: InventoryRunResult = {
    mode,
    requestedSampleLimit,
    effectiveSampleLimit,
    sampleLimit: requestedSampleLimit,
    samplingMode,
    samplingReliabilityNote,
    layers: rows,
    source,
  };
  return validateContract(InventoryRunResultSchema, result, "InventoryRunResult");
}
