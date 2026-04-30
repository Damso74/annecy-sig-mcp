import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { runGenerateInventoryReport } from "../src/tools/generateInventoryReport.js";
import { runGenerateOpenDataBrief } from "../src/tools/generateOpenDataBrief.js";
import { assessChatbotReadiness } from "../src/tools/generateChatbotReadinessReport.js";
import type { InventoryLayerRow } from "../src/tools/inventoryAllLayers.js";
import { getLayerEntry } from "../src/registry.js";
import { validateSemanticMappings, getSemanticCoverage } from "../src/utils/semanticMappings.js";
import { runGenerateInternalDashboardBrief } from "../src/tools/generateInternalDashboardBrief.js";
import { executiveSummaryHeading } from "../src/utils/reportMarkdown.js";

const RUN_NETWORK = process.env.RUN_NETWORK_TESTS === "true";

describe("generate_inventory_report", () => {
  it.skipIf(!RUN_NETWORK)(
    "ne contient pas created_user dans le markdown public",
    async () => {
      const cfg = loadConfig();
      const r = await runGenerateInventoryReport(cfg, { mode: "public", sampleLimit: 5, format: "markdown" });
      expect(r.body.toLowerCase()).not.toContain("created_user");
      expect(r.body).toContain("Résumé exécutif");
    },
    25_000,
  );
});

describe("generate_open_data_brief", () => {
  it.skipIf(!RUN_NETWORK)("markdown mentionne les trois familles VERT / ORANGE / ROUGE", async () => {
    const cfg = loadConfig();
    const r = await runGenerateOpenDataBrief(cfg, { mode: "public", format: "markdown" });
    expect(r.body).toMatch(/VERT/i);
    expect(r.body).toMatch(/ORANGE/i);
    expect(r.body).toMatch(/ROUGE/i);
  });
});

describe("assessChatbotReadiness", () => {
  it("classe ready sur un profil favorable (mock)", () => {
    const entry = getLayerEntry("equipements", 5)!;
    const props = {
      denomination: "WC1",
      adresse: "Rue",
      commune: "Annecy",
      ouvert: true,
      pmr: true,
      horaire: "8h-18h",
      categorie: "Sanitaire",
      sous_categorie: "WC",
    };
    const feats = Array.from({ length: 10 }, () => ({ properties: { ...props } }));
    const semanticValidation = validateSemanticMappings({
      semanticMappings: entry.semanticMappings,
      arcgisFieldNames: Object.keys(props),
      essentialKeys: ["labelField", "addressField", "communeField"],
    });
    const semanticCoverage = getSemanticCoverage({
      features: feats,
      semanticMappings: entry.semanticMappings,
    });
    const row: InventoryLayerRow = {
      serviceKey: "equipements",
      layerId: 5,
      layerName: "WC publics",
      visibility: "public",
      riskLevel: "green",
      geometryType: "esriGeometryPoint",
      count: 100,
      fields: { publicFields: ["objectid"] },
      sampleReturned: 10,
      sampleStatus: "ok",
      sampleFallbackUsed: "registry_valid",
      hasGeometryInSample: true,
      geometryStatus: "present",
      fieldValidation: {
        validFields: ["objectid"],
        missingFields: [],
        ignoredFields: [],
        objectIdField: "objectid",
        geometryType: "esriGeometryPoint",
        supportsQuery: true,
      },
      nullRateSummary: { denomination: 0, adresse: 0, categorie: 0 },
      warnings: [],
      diagnostics: [],
      suggestedUseCases: [],
      preliminaryQualityScore: 90,
      scoreBreakdown: {},
      semanticMappings: entry.semanticMappings,
      semanticValidation,
      semanticCoverage,
      usageStatus: "ready",
      usageWarnings: [],
      technicalScore: 88,
      dataQualityScore: 92,
      samplingMode: "standard",
    };
    expect(assessChatbotReadiness(row).tier).toBe("ready");
  });
});

describe("generate_internal_dashboard_brief", () => {
  it("refuse le mode public", async () => {
    const cfg = loadConfig();
    await expect(
      runGenerateInternalDashboardBrief(cfg, { mode: "public" as never, format: "markdown" }),
    ).rejects.toThrow(/internal/);
  });
});

describe("reportMarkdown", () => {
  it("fournit un titre de résumé exécutif", () => {
    expect(executiveSummaryHeading()).toContain("Résumé exécutif");
  });
});
