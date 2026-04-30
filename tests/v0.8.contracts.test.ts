import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { runInventoryAllLayers } from "../src/tools/inventoryAllLayers.js";
import { runGenerateChatbotReadinessReport } from "../src/tools/generateChatbotReadinessReport.js";
import { runRecommendOpenDataCandidates } from "../src/tools/recommendOpenData.js";
import { runGenerateLayerActionPlan } from "../src/tools/generateLayerActionPlan.js";
import {
  ChatbotReadinessReportSchema,
  ContractViolationError,
  InventoryRunResultSchema,
  LayerActionPlanSchema,
  OpenDataBriefSchema,
  validateContract,
} from "../src/contracts/index.js";
import {
  CHATBOT_SCHEMA_VERSION,
  INVENTORY_SCHEMA_VERSION,
  LAYER_ACTION_PLAN_SCHEMA_VERSION,
  OPEN_DATA_SCHEMA_VERSION,
  SERVER_VERSION,
} from "../src/runtime/version.js";
import { defaultRegistryMatchers, installMockArcgisClient } from "./helpers/mockArcgisClient.js";

describe("V0.8 — contrats Zod (validateContract)", () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it("InventoryRunResult passe son schéma — schemaVersion + serverVersion présents", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const inv = await runInventoryAllLayers(cfg, {
      mode: "internal",
      sampleLimit: 5,
      targets: [
        { serviceKey: "equipements", layerId: 5 },
        { serviceKey: "travaux", layerId: 3 },
      ],
    });
    expect(inv.source.schemaVersion).toBe(INVENTORY_SCHEMA_VERSION);
    expect(inv.source.serverVersion).toBe(SERVER_VERSION);
    expect(typeof inv.source.runtimeMs).toBe("number");
    expect(inv.source.diagnostics).toBeDefined();
    expect(inv.source.execution.requestedSampleLimit).toBe(5);
    expect(() =>
      validateContract(InventoryRunResultSchema, inv, "InventoryRunResult"),
    ).not.toThrow();
  });

  it("OpenDataBrief passe son schéma — schemaVersion stable + samplingMode", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const r = await runRecommendOpenDataCandidates(cfg, {
      mode: "internal",
      sampleLimit: 5,
      fast: true,
      targets: [
        { serviceKey: "equipements", layerId: 5 },
        { serviceKey: "travaux", layerId: 3 },
      ],
    });
    expect(r.source.schemaVersion).toBe(OPEN_DATA_SCHEMA_VERSION);
    expect(r.source.serverVersion).toBe(SERVER_VERSION);
    expect(["fast", "standard"]).toContain(r.source.samplingMode);
    // Re-validate explicitly (the function already validates internally — sécurité supplémentaire).
    expect(() => validateContract(OpenDataBriefSchema, r, "OpenDataBrief")).not.toThrow();
  });

  it("ChatbotReadinessReport passe son schéma — typicalQuestions agrégées", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const r = await runGenerateChatbotReadinessReport(cfg, {
      mode: "public",
      sampleLimit: 5,
      fast: true,
      format: "json",
      targets: [{ serviceKey: "equipements", layerId: 5 }],
    });
    expect(r.structured.source.schemaVersion).toBe(CHATBOT_SCHEMA_VERSION);
    expect(r.structured.source.serverVersion).toBe(SERVER_VERSION);
    expect(r.structured.typicalQuestions.length).toBeGreaterThanOrEqual(5);
    expect(() =>
      validateContract(ChatbotReadinessReportSchema, r.structured, "ChatbotReadinessReport"),
    ).not.toThrow();
  });

  it("LayerActionPlan passe son schéma — priorité enum + scores", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const r = await runGenerateLayerActionPlan(cfg, {
      serviceKey: "equipements",
      layerId: 5,
      mode: "public",
      sampleLimit: 5,
      fast: true,
      format: "json",
    });
    expect(r.structured.source.schemaVersion).toBe(LAYER_ACTION_PLAN_SCHEMA_VERSION);
    expect(r.structured.source.serverVersion).toBe(SERVER_VERSION);
    expect(["high", "medium", "low"]).toContain(r.structured.priority);
    expect(() =>
      validateContract(LayerActionPlanSchema, r.structured, "LayerActionPlan"),
    ).not.toThrow();
  });

  it("validateContract jette une ContractViolationError exploitable en mode test", () => {
    expect(() =>
      validateContract(
        InventoryRunResultSchema,
        // payload visiblement incomplet : schemaVersion absent
        { mode: "public", layers: [] },
        "InventoryRunResult",
      ),
    ).toThrowError(ContractViolationError);

    try {
      validateContract(
        InventoryRunResultSchema,
        { mode: "public", layers: [] },
        "InventoryRunResult",
      );
    } catch (e) {
      expect(e).toBeInstanceOf(ContractViolationError);
      const err = e as ContractViolationError;
      expect(err.contractName).toBe("InventoryRunResult");
      expect(err.issues.length).toBeGreaterThan(0);
      expect(err.message).toMatch(/InventoryRunResult/);
    }
  });

  it("schemaVersion ne reprend jamais d'ancienne clé v04/v05/v06", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const inv = await runInventoryAllLayers(cfg, {
      mode: "internal",
      sampleLimit: 5,
      targets: [{ serviceKey: "equipements", layerId: 5 }],
    });
    const serialized = JSON.stringify(inv.source);
    expect(serialized).not.toMatch(/"v04"|"v05"|"v06"/);
    expect(inv.source.schemaVersion).toMatch(/\.v1$/);
  });
});
