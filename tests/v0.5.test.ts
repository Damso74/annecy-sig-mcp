import { describe, expect, it } from "vitest";
import { validateSemanticMappings, getSemanticCoverage, resolveSemanticValue } from "../src/utils/semanticMappings.js";
import { buildInventoryReportStructuredForTest } from "../src/tools/generateInventoryReport.js";
import type { InventoryLayerRow } from "../src/tools/inventoryAllLayers.js";
import { assessOpenDataCandidate, classifyOpenDataTier } from "../src/tools/recommendOpenData.js";
import { assessChatbotReadiness } from "../src/tools/generateChatbotReadinessReport.js";
import { getLayerEntry } from "../src/registry.js";
import { runGenerateLayerActionPlan } from "../src/tools/generateLayerActionPlan.js";
import { loadConfig } from "../src/config.js";

describe("semanticMappings utilitaires (V0.5)", () => {
  it("accepte des mappings valides", () => {
    const r = validateSemanticMappings({
      semanticMappings: { labelField: "nom", addressField: "adresse" },
      arcgisFieldNames: ["nom", "adresse", "objectid"],
      essentialKeys: ["labelField"],
    });
    expect(r.invalidMappings).toEqual([]);
    expect(r.validMappings.labelField).toBe("nom");
  });

  it("détecte un champ inexistant", () => {
    const r = validateSemanticMappings({
      semanticMappings: { labelField: "fantome" },
      arcgisFieldNames: ["nom"],
      essentialKeys: ["labelField"],
    });
    expect(r.invalidMappings.length).toBe(1);
    expect(r.invalidMappings[0]?.field).toBe("fantome");
  });

  it("calcule les ratios de couverture", () => {
    const r = getSemanticCoverage({
      features: [
        { properties: { a: "x" } },
        { properties: { a: "" } },
        { properties: { a: null } },
      ],
      semanticMappings: { labelField: "a" },
    });
    expect(r.totalFeatures).toBe(3);
    expect(r.coverageByMapping.labelField?.nonNullCount).toBe(1);
    expect(r.coverageByMapping.labelField?.nullCount).toBe(2);
  });

  it("traite une chaîne vide comme absente", () => {
    const v = resolveSemanticValue({
      properties: { x: "" },
      semanticMappings: { labelField: "x" },
      key: "labelField",
    });
    expect(v).toBeUndefined();
  });

  it("traite 0 et false comme valeurs présentes", () => {
    expect(
      resolveSemanticValue({
        properties: { n: 0 },
        semanticMappings: { capacityField: "n" },
        key: "capacityField",
      }),
    ).toBe(0);
    expect(
      resolveSemanticValue({
        properties: { f: false },
        semanticMappings: { openingField: "f" },
        key: "openingField",
      }),
    ).toBe(false);
  });
});

describe("generateInventoryReport — toClean (V0.5)", () => {
  it("ne renvoie aucune entrée toClean avec reasons vide", () => {
    const entry = getLayerEntry("equipements", 5)!;
    const semanticValidation = validateSemanticMappings({
      semanticMappings: entry.semanticMappings,
      arcgisFieldNames: ["denomination", "adresse", "commune"],
      essentialKeys: ["labelField"],
    });
    const semanticCoverage = getSemanticCoverage({
      features: [{ properties: { denomination: "A" } }],
      semanticMappings: entry.semanticMappings,
    });
    const layer: InventoryLayerRow = {
      serviceKey: "equipements",
      layerId: 5,
      layerName: "WC",
      visibility: "public",
      riskLevel: "green",
      geometryType: "esriGeometryPoint",
      count: 1,
      fields: { publicFields: ["denomination"] },
      sampleReturned: 1,
      sampleStatus: "ok",
      sampleFallbackUsed: "registry_valid",
      hasGeometryInSample: true,
      geometryStatus: "present",
      fieldValidation: {
        validFields: ["denomination"],
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
      preliminaryQualityScore: 40,
      scoreBreakdown: {},
      semanticMappings: entry.semanticMappings,
      semanticValidation,
      semanticCoverage,
      usageStatus: "needs_data_cleaning",
      usageWarnings: ["Qualité data : test"],
      technicalScore: 65,
      dataQualityScore: 42,
      samplingMode: "standard",
    };
    const structured = buildInventoryReportStructuredForTest({
      mode: "public",
      sampleLimit: 5,
      samplingMode: "standard",
      samplingReliabilityNote: "Mode standard.",
      layers: [layer],
      source: {
        type: "annecy_sig_mcp_inventory",
        schemaVersion: "inventory.v1",
        serverVersion: "test",
        runtimeMs: 0,
        layersScanned: 1,
        diagnostics: { failedSamples: 0, emptySamples: 0, geometryUnknownLayers: 0 },
        execution: {
          concurrency: 3,
          fast: false,
          requestedSampleLimit: 5,
          effectiveSampleLimit: 5,
          serviceKeysFilter: null,
          targetsFilter: null,
        },
      },
    });
    expect(structured.toClean.every(t => t.reasons.length > 0)).toBe(true);
  });
});

describe("recommendOpenData — assessOpenDataCandidate (V0.5)", () => {
  function mockRow(over: Partial<InventoryLayerRow>): InventoryLayerRow {
    const entry = getLayerEntry("equipements", 0)!;
    const semanticValidation = validateSemanticMappings({
      semanticMappings: entry.semanticMappings,
      arcgisFieldNames: ["denomination", "adresse", "commune", "categorie"],
      essentialKeys: ["labelField", "addressField", "communeField"],
    });
    const feats = Array.from({ length: 8 }, () => ({
      properties: { denomination: "X", adresse: "Rue 1", commune: "Annecy", categorie: "ADM" },
    }));
    const semanticCoverage = getSemanticCoverage({
      features: feats,
      semanticMappings: entry.semanticMappings,
    });
    return {
      serviceKey: "equipements",
      layerId: 0,
      layerName: "Admin",
      visibility: "public",
      riskLevel: "green",
      geometryType: "esriGeometryPoint",
      count: 8,
      fields: { publicFields: ["denomination"] },
      sampleReturned: 8,
      sampleStatus: "ok",
      sampleFallbackUsed: "registry_valid",
      hasGeometryInSample: true,
      geometryStatus: "present",
      fieldValidation: {
        validFields: ["denomination"],
        missingFields: [],
        ignoredFields: [],
        objectIdField: "OBJECTID",
        geometryType: "esriGeometryPoint",
        supportsQuery: true,
      },
      nullRateSummary: { denomination: 0.05 },
      warnings: [],
      diagnostics: [],
      suggestedUseCases: [],
      preliminaryQualityScore: 85,
      scoreBreakdown: {},
      semanticMappings: entry.semanticMappings,
      semanticValidation,
      semanticCoverage,
      usageStatus: "ready",
      usageWarnings: [],
      technicalScore: 82,
      dataQualityScore: 85,
      samplingMode: "standard",
      ...over,
    };
  }

  it("peut classer une couche mockée propre en VERT", () => {
    const a = assessOpenDataCandidate(mockRow({}));
    expect(a.tier).toBe("green");
    expect(a.publicationReadiness).toBe("publishable_now");
  });

  it("classe ORANGE si mapping essentiel absent mais couche publique", () => {
    const entry = getLayerEntry("equipements", 0)!;
    const badValidation = validateSemanticMappings({
      semanticMappings: entry.semanticMappings,
      arcgisFieldNames: ["denomination"],
      essentialKeys: ["labelField", "addressField", "communeField"],
    });
    const a = assessOpenDataCandidate(
      mockRow({
        semanticValidation: badValidation,
        usageStatus: "needs_field_mapping",
      }),
    );
    expect(a.tier).toBe("orange");
  });

  it("classe ROUGE si travauxTier red", () => {
    const entry = getLayerEntry("travaux", 3)!;
    const sv = validateSemanticMappings({
      semanticMappings: entry.semanticMappings,
      arcgisFieldNames: ["titre", "adresse"],
      essentialKeys: ["labelField"],
    });
    const sc = getSemanticCoverage({
      features: [{ properties: { titre: "T", adresse: "A" } }],
      semanticMappings: entry.semanticMappings,
    });
    const row: InventoryLayerRow = {
      serviceKey: "travaux",
      layerId: 3,
      layerName: "Travaux",
      visibility: "internal",
      riskLevel: "orange",
      geometryType: "esriGeometryPolygon",
      count: 1,
      fields: { publicFields: [], internalFields: ["titre"] },
      sampleReturned: 1,
      sampleStatus: "ok",
      sampleFallbackUsed: "registry_valid",
      hasGeometryInSample: true,
      geometryStatus: "present",
      fieldValidation: {
        validFields: ["titre"],
        missingFields: [],
        ignoredFields: [],
        objectIdField: "OBJECTID",
        geometryType: "esriGeometryPolygon",
        supportsQuery: true,
      },
      nullRateSummary: {},
      warnings: [],
      diagnostics: [],
      suggestedUseCases: [],
      preliminaryQualityScore: 70,
      scoreBreakdown: {},
      semanticMappings: entry.semanticMappings,
      semanticValidation: sv,
      semanticCoverage: sc,
      usageStatus: "internal_only",
      usageWarnings: [],
      technicalScore: 75,
      dataQualityScore: 70,
      samplingMode: "standard",
    };
    process.env.OPEN_DATA_TRAVAUX_TIER = "red";
    expect(classifyOpenDataTier(row)).toBe("red");
    delete process.env.OPEN_DATA_TRAVAUX_TIER;
  });
});

describe("assessChatbotReadiness — semanticMappings (V0.5)", () => {
  it("distingue usable_now vs usable_with_caution selon usageStatus", () => {
    const entry = getLayerEntry("equipements", 5)!;
    const feats = Array.from({ length: 10 }, () => ({
      properties: { denomination: "WC", adresse: "R", commune: "Annecy", ouvert: true, pmr: false },
    }));
    const sv = validateSemanticMappings({
      semanticMappings: entry.semanticMappings,
      arcgisFieldNames: ["denomination", "adresse", "commune", "ouvert", "pmr"],
      essentialKeys: ["labelField", "addressField", "communeField"],
    });
    const sc = getSemanticCoverage({ features: feats, semanticMappings: entry.semanticMappings });
    const base = {
      serviceKey: "equipements" as const,
      layerId: 5,
      layerName: "WC",
      visibility: "public" as const,
      riskLevel: "green" as const,
      geometryType: "esriGeometryPoint",
      count: 10,
      fields: { publicFields: ["denomination"] },
      sampleReturned: 10,
      sampleStatus: "ok" as const,
      sampleFallbackUsed: "registry_valid" as const,
      hasGeometryInSample: true,
      geometryStatus: "present" as const,
      fieldValidation: {
        validFields: ["denomination"],
        missingFields: [],
        ignoredFields: [],
        objectIdField: "OBJECTID",
        geometryType: "esriGeometryPoint",
        supportsQuery: true,
      },
      nullRateSummary: { denomination: 0 },
      warnings: [],
      diagnostics: [],
      suggestedUseCases: [],
      preliminaryQualityScore: 80,
      scoreBreakdown: {},
      semanticMappings: entry.semanticMappings,
      semanticValidation: sv,
      semanticCoverage: sc,
      usageWarnings: [] as string[],
      technicalScore: 80,
      dataQualityScore: 78,
      samplingMode: "standard",
    };
    expect(assessChatbotReadiness({ ...base, usageStatus: "usable_now" }).tier).toBe("usable_now");
    expect(assessChatbotReadiness({ ...base, usageStatus: "usable_with_caution" }).tier).toBe(
      "usable_with_caution",
    );
  });
});

describe("generate_layer_action_plan (V0.5)", () => {
  const RUN_NETWORK = process.env.RUN_NETWORK_TESTS === "true";

  it.skipIf(!RUN_NETWORK)(
    "retourne les sections attendues (réseau)",
    async () => {
      const cfg = loadConfig();
      const r = await runGenerateLayerActionPlan(cfg, {
        serviceKey: "equipements",
        layerId: 5,
        mode: "public",
        format: "json",
        sampleLimit: 3,
        writeOutput: false,
      });
      expect(r.structured.executiveSummary.length).toBeGreaterThan(10);
      expect(r.structured.possibleUses.chatbot).toBeTruthy();
      expect(r.structured.recommendedTechnicalActions.length).toBeGreaterThan(0);
      const body = JSON.stringify(r.structured).toLowerCase();
      for (const needle of ["created_user", "url_pj", "token", "password"]) {
        expect(body).not.toContain(needle);
      }
    },
    30_000,
  );
});
