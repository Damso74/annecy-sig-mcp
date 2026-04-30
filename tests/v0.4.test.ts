import { describe, expect, it } from "vitest";
import { validateRegistryFieldsAgainstArcGIS } from "../src/utils/arcgisFieldValidation.js";
import type { EsriLayerMetadata } from "../src/arcgis/types.js";
import { classifyOpenDataTier } from "../src/tools/recommendOpenData.js";
import { assessChatbotReadiness } from "../src/tools/generateChatbotReadinessReport.js";
import type { InventoryLayerRow } from "../src/tools/inventoryAllLayers.js";
import { validateSemanticMappings, getSemanticCoverage } from "../src/utils/semanticMappings.js";

describe("validateRegistryFieldsAgainstArcGIS", () => {
  it("liste les champs registre absents et aligne les noms ArcGIS", () => {
    const meta: EsriLayerMetadata = {
      fields: [
        { name: "OBJECTID", type: "esriFieldTypeOID" },
        { name: "denomination", type: "esriFieldTypeString" },
      ],
      objectIdField: "OBJECTID",
      geometryType: "esriGeometryPoint",
      capabilities: "Map,Query",
    };
    const v = validateRegistryFieldsAgainstArcGIS(["objectid", "denomination", "fantome"], meta);
    expect(v.validFields).toEqual(["OBJECTID", "denomination"]);
    expect(v.missingFields).toEqual(["fantome"]);
    expect(v.objectIdField).toBe("OBJECTID");
    expect(v.supportsQuery).toBe(true);
  });
});

function basePublicRow(over: Partial<InventoryLayerRow> = {}): InventoryLayerRow {
  const semanticValidation = validateSemanticMappings({
    semanticMappings: undefined,
    arcgisFieldNames: [],
    essentialKeys: [],
  });
  const semanticCoverage = getSemanticCoverage({ features: [], semanticMappings: undefined });
  return {
    serviceKey: "equipements",
    layerId: 5,
    layerName: "WC",
    visibility: "public",
    riskLevel: "green",
    geometryType: "esriGeometryPoint",
    count: 10,
    fields: { publicFields: ["objectid"] },
    sampleReturned: 0,
    sampleStatus: "failed",
    sampleError: "Failed to execute query",
    sampleFallbackUsed: "none",
    hasGeometryInSample: false,
    geometryStatus: "unknown",
    fieldValidation: {
      validFields: [],
      missingFields: [],
      ignoredFields: [],
      objectIdField: "OBJECTID",
      geometryType: "esriGeometryPoint",
      supportsQuery: true,
    },
    nullRateSummary: {},
    warnings: [],
    diagnostics: [],
    suggestedUseCases: [],
    preliminaryQualityScore: 95,
    scoreBreakdown: {},
    semanticMappings: undefined,
    semanticValidation,
    semanticCoverage,
    usageStatus: "to_investigate_technically",
    usageWarnings: [],
    technicalScore: 35,
    dataQualityScore: 38,
    samplingMode: "standard",
    ...over,
  };
}

describe("classifyOpenDataTier (v0.4)", () => {
  it("ne classe jamais VERT si l’échantillon a échoué", () => {
    expect(classifyOpenDataTier(basePublicRow({ preliminaryQualityScore: 99 }))).toBe("orange");
  });

  it("ne classe jamais VERT si l’échantillon est vide", () => {
    expect(
      classifyOpenDataTier(
        basePublicRow({
          sampleStatus: "empty",
          sampleError: undefined,
          preliminaryQualityScore: 99,
        }),
      ),
    ).toBe("orange");
  });
});

describe("assessChatbotReadiness (v0.4)", () => {
  it("place les échecs d’échantillon dans unknown_requires_check", () => {
    const a = assessChatbotReadiness(basePublicRow());
    expect(a.tier).toBe("unknown_requires_check");
    expect(a.reasons.some(x => /non récupéré/i.test(x))).toBe(true);
  });
});

describe("rapport public — absence de champs sensibles (v0.4)", () => {
  const RUN_NETWORK = process.env.RUN_NETWORK_TESTS === "true";

  it.skipIf(!RUN_NETWORK)(
    "generate_inventory_report public ne contient pas les motifs sensibles",
    async () => {
      const { loadConfig } = await import("../src/config.js");
      const { runGenerateInventoryReport } = await import("../src/tools/generateInventoryReport.js");
      const cfg = loadConfig();
      const r = await runGenerateInventoryReport(cfg, { mode: "public", sampleLimit: 3, format: "markdown" });
      const b = r.body.toLowerCase();
      for (const needle of [
        "created_user",
        "last_edited_user",
        "last_edited_date",
        "created_date",
        "url_piece_jointe",
        "url_pj",
        "token",
        "password",
      ]) {
        expect(b).not.toContain(needle);
      }
    },
    25_000,
  );
});
