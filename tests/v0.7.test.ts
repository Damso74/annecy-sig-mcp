import { describe, expect, it } from "vitest";
import { resolveInventoryLayerEntries } from "../src/inventory/inventoryResolution.js";
import { runInventoryAllLayers } from "../src/tools/inventoryAllLayers.js";
import { loadConfig } from "../src/config.js";
import {
  INVENTORY_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION,
  SERVER_VERSION,
} from "../src/runtime/version.js";
import { pushInventoryWarning, inventoryDiagnostic, type InventoryDiagnostic } from "../src/inventory/inventoryDiagnostics.js";
import { buildInventoryReportStructuredForTest } from "../src/tools/generateInventoryReport.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("V0.7 — schéma source stable", () => {
  it("n’expose pas de clés v04 / v05 / v06 dans un payload inventaire sérialisé", () => {
    const payload = {
      source: {
        type: "annecy_sig_mcp_inventory",
        schemaVersion: INVENTORY_SCHEMA_VERSION,
        serverVersion: SERVER_VERSION,
        diagnostics: { failedSamples: 0, emptySamples: 0, geometryUnknownLayers: 0 },
        execution: {
          concurrency: 3,
          fast: false,
          requestedSampleLimit: 20,
          effectiveSampleLimit: 20,
          serviceKeysFilter: null,
          targetsFilter: null,
        },
      },
    };
    const s = JSON.stringify(payload);
    expect(s).not.toMatch(/"v04"|"v05"|"v06"/);
  });

  it("resolveInventoryLayerEntries refuse serviceKeys + targets", () => {
    expect(() =>
      resolveInventoryLayerEntries("public", ["equipements"], [{ serviceKey: "mobilite", layerId: 2 }]),
    ).toThrow(/Ne pas combiner/);
  });

  it("targets avec layerId ne retourne qu’une couche", () => {
    const layers = resolveInventoryLayerEntries("public", undefined, [{ serviceKey: "equipements", layerId: 5 }]);
    expect(layers).toHaveLength(1);
    expect(layers[0]?.layerId).toBe(5);
  });
});

describe("V0.7 — inventaire (réseau optionnel)", () => {
  const RUN_NETWORK = process.env.RUN_NETWORK_TESTS === "true";

  it.skipIf(!RUN_NETWORK)("fast=true : requestedSampleLimit vs effectiveSampleLimit + diagnostics source", async () => {
    const cfg = loadConfig();
    const inv = await runInventoryAllLayers(cfg, {
      mode: "public",
      sampleLimit: 12,
      fast: true,
    });
    expect(inv.requestedSampleLimit).toBe(12);
    expect(inv.effectiveSampleLimit).toBe(1);
    expect(inv.source.execution.requestedSampleLimit).toBe(12);
    expect(inv.source.execution.effectiveSampleLimit).toBe(1);
    expect(inv.source.schemaVersion).toBe(INVENTORY_SCHEMA_VERSION);
    expect(inv.source.serverVersion).toBe(SERVER_VERSION);
    expect(inv.source.diagnostics).toEqual(
      expect.objectContaining({
        failedSamples: expect.any(Number),
        emptySamples: expect.any(Number),
        geometryUnknownLayers: expect.any(Number),
      }),
    );
  }, 30_000);
});

describe("V0.7 — diagnostics typés", () => {
  it("pushInventoryWarning aligne warnings et diagnostics", () => {
    const warnings: string[] = [];
    const diagnostics: InventoryDiagnostic[] = [];
    pushInventoryWarning(warnings, diagnostics, inventoryDiagnostic("SAMPLE_EMPTY", "warning", "échantillon vide"));
    expect(warnings).toContain("échantillon vide");
    expect(diagnostics[0]?.code).toBe("SAMPLE_EMPTY");
  });
});

describe("V0.7 — rapport inventaire", () => {
  it("structured.source expose schemaVersion et pas de v04/v05/v06", () => {
    const structured = buildInventoryReportStructuredForTest({
      mode: "public",
      layers: [],
      source: {
        type: "annecy_sig_mcp_inventory",
        schemaVersion: INVENTORY_SCHEMA_VERSION,
        serverVersion: SERVER_VERSION,
        runtimeMs: 1,
        layersScanned: 0,
        diagnostics: { failedSamples: 2, emptySamples: 1, geometryUnknownLayers: 0 },
        execution: {
          concurrency: 3,
          fast: false,
          requestedSampleLimit: 20,
          effectiveSampleLimit: 20,
          serviceKeysFilter: null,
          targetsFilter: null,
        },
      },
    });
    expect(structured.samplingFailureCount).toBe(2);
    expect(structured.emptySampleCount).toBe(1);
    expect(structured.source.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(structured.source.serverVersion).toBe(SERVER_VERSION);
    expect(JSON.stringify(structured.source)).not.toMatch(/"v04"|"v05"|"v06"/);
  });
});

describe("V0.7 — lowerPropertyKeys hors queryLayer", () => {
  it("inventoryFields importe depuis utils/properties", () => {
    const path = join(process.cwd(), "src", "inventory", "inventoryFields.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain('../utils/properties.js"');
    expect(src).not.toContain('./queryLayer.js"');
    expect(src).not.toContain("../tools/queryLayer");
  });
});

describe("V0.7 — exports JSON sans secrets courants", () => {
  it("structured inventaire mock sans champs sensibles en minuscules", () => {
    const structured = buildInventoryReportStructuredForTest({
      mode: "public",
      layers: [],
      source: {
        type: "annecy_sig_mcp_inventory",
        schemaVersion: INVENTORY_SCHEMA_VERSION,
        serverVersion: SERVER_VERSION,
        runtimeMs: 0,
        layersScanned: 0,
        diagnostics: { failedSamples: 0, emptySamples: 0, geometryUnknownLayers: 0 },
        execution: {
          concurrency: 1,
          fast: false,
          requestedSampleLimit: 5,
          effectiveSampleLimit: 5,
          serviceKeysFilter: null,
          targetsFilter: null,
        },
      },
    });
    const low = JSON.stringify(structured).toLowerCase();
    for (const needle of ["token", "password", "created_user", "last_edited_user", "last_edited_date", "url_pj", "url_piece_jointe"]) {
      expect(low).not.toContain(needle);
    }
  });
});
