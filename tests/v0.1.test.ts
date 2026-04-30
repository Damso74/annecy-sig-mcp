import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";
import { runCountLayer } from "../src/tools/countLayer.js";
import { getLayerEntry } from "../src/registry.js";
import { getInventoryFieldsForMode, preparePropsForInventoryStats } from "../src/tools/inventoryAllLayers.js";
import type { LayerRegistryEntry } from "../src/registry.js";
import { computePreliminaryQualityScore } from "../src/utils/inventoryScore.js";
import {
  classifyOpenDataTier,
  getTravauxOpenDataTier,
} from "../src/tools/recommendOpenData.js";
import type { InventoryLayerRow } from "../src/tools/inventoryAllLayers.js";
import { validateSemanticMappings, getSemanticCoverage } from "../src/utils/semanticMappings.js";

describe("runCountLayer", () => {
  it("refuse la couche travaux en mode public", async () => {
    const cfg = loadConfig();
    await expect(
      runCountLayer(cfg, { serviceKey: "travaux", layerId: 3, mode: "public" }),
    ).rejects.toThrow(/internal/);
  });
});

describe("getInventoryFieldsForMode", () => {
  it("n’expose pas internalFields en mode public", () => {
    const entry = getLayerEntry("equipements", 5)!;
    const f = getInventoryFieldsForMode(entry, "public");
    expect(f.publicFields.length).toBeGreaterThan(0);
    expect(f).not.toHaveProperty("internalFields");
  });

  it("expose internalFields en mode internal", () => {
    const entry = getLayerEntry("equipements", 5)!;
    const f = getInventoryFieldsForMode(entry, "internal");
    expect(f.internalFields?.length).toBeGreaterThan(0);
  });
});

describe("preparePropsForInventoryStats (sanitize prioritaire)", () => {
  const fakeEntry = {
    serviceKey: "testsvc",
    servicePath: "TEST/MapServer",
    layerId: 0,
    layerName: "Test",
    visibility: "public" as const,
    riskLevel: "green" as const,
    publicFields: ["objectid", "created_user", "denomination"],
    internalFields: ["objectid", "created_user", "denomination"],
    description: "",
    useCases: [],
  } as unknown as LayerRegistryEntry;

  it("retire created_user même s’il était listé par erreur dans l’allowlist", () => {
    const out = preparePropsForInventoryStats(
      { objectid: 1, CREATED_USER: "intrus", denomination: "OK" },
      fakeEntry,
      "public",
    );
    expect(out).toEqual({ objectid: 1, denomination: "OK" });
  });
});

describe("computePreliminaryQualityScore", () => {
  it("produit un score cohérent sur échantillon théorique favorable", () => {
    const { score, breakdown } = computePreliminaryQualityScore({
      visibility: "public",
      serviceKey: "equipements",
      riskLevel: "green",
      hasGeometryInSample: true,
      geometryStatus: "present",
      sampleReliable: true,
      readableFillRate: 1,
      keyFieldNullRate: 0,
      dateFreshnessProxy: 1,
    });
    expect(score).toBe(100);
    expect(breakdown.citizenPilot).toBe(20);
    expect(breakdown.geometry).toBe(20);
  });

  it("neutralise la géométrie quand l’échantillon n’est pas fiable (v0.4)", () => {
    const { breakdown } = computePreliminaryQualityScore({
      visibility: "public",
      serviceKey: "equipements",
      riskLevel: "green",
      hasGeometryInSample: false,
      geometryStatus: "unknown",
      sampleReliable: false,
      readableFillRate: 0,
      keyFieldNullRate: 1,
      dateFreshnessProxy: 0,
    });
    expect(breakdown.geometry).toBe(10);
  });
});

describe("classifyOpenDataTier / travaux", () => {
  const baseTravauxRow = (): InventoryLayerRow => {
    const entry = getLayerEntry("travaux", 3)!;
    const arcgisFieldNames = [
      "objectid",
      "titre",
      "adresse",
      "commune_deleguee",
      "ac_num",
      "ac_date_debut",
      "ac_date_fin",
      "controle_resultat",
      "description",
    ];
    const semanticValidation = validateSemanticMappings({
      semanticMappings: entry.semanticMappings,
      arcgisFieldNames,
      essentialKeys: ["labelField", "addressField"],
    });
    const semanticCoverage = getSemanticCoverage({
      features: [{ properties: { titre: "Test", adresse: "Rue 1", commune_deleguee: "Annecy" } }],
      semanticMappings: entry.semanticMappings,
    });
    return {
      serviceKey: "travaux",
      layerId: 3,
      layerName: "Travaux",
      visibility: "internal",
      riskLevel: "orange",
      geometryType: "esriGeometryPolygon",
      count: 10,
      fields: { publicFields: [], internalFields: ["titre", "url_pj"] },
      sampleReturned: 5,
      sampleStatus: "ok",
      sampleFallbackUsed: "registry_valid",
      hasGeometryInSample: false,
      geometryStatus: "missing",
      fieldValidation: {
        validFields: ["objectid", "titre"],
        missingFields: [],
        ignoredFields: [],
        objectIdField: "objectid",
        geometryType: "esriGeometryPolygon",
        supportsQuery: true,
      },
      nullRateSummary: {},
      warnings: [],
      diagnostics: [],
      suggestedUseCases: [],
      preliminaryQualityScore: 55,
      scoreBreakdown: {},
      semanticMappings: entry.semanticMappings,
      semanticValidation,
      semanticCoverage,
      usageStatus: "internal_only",
      usageWarnings: [],
      technicalScore: 72,
      dataQualityScore: 58,
      samplingMode: "standard",
    };
  };

  beforeEach(() => {
    delete process.env.OPEN_DATA_TRAVAUX_TIER;
  });

  afterEach(() => {
    delete process.env.OPEN_DATA_TRAVAUX_TIER;
  });

  it("classe travaux en orange par défaut (OPEN_DATA_TRAVAUX_TIER)", () => {
    expect(getTravauxOpenDataTier()).toBe("orange");
    expect(classifyOpenDataTier(baseTravauxRow())).toBe("orange");
  });

  it("classe travaux en rouge si OPEN_DATA_TRAVAUX_TIER=red", () => {
    process.env.OPEN_DATA_TRAVAUX_TIER = "red";
    expect(getTravauxOpenDataTier()).toBe("red");
    expect(classifyOpenDataTier(baseTravauxRow())).toBe("red");
  });
});
