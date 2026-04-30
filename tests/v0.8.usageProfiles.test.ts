import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  CHATBOT_CITIZEN_LAYERS,
  LAYER_REGISTRY,
  getChatbotProfile,
  getDashboardProfile,
  getOpenDataProfile,
  getLayerEntry,
} from "../src/registry.js";
import { runGenerateChatbotReadinessReport } from "../src/tools/generateChatbotReadinessReport.js";
import {
  assessOpenDataCandidate,
  runRecommendOpenDataCandidates,
} from "../src/tools/recommendOpenData.js";
import { runInventoryAllLayers } from "../src/tools/inventoryAllLayers.js";
import { defaultRegistryMatchers, installMockArcgisClient } from "./helpers/mockArcgisClient.js";

describe("V0.8 — usageProfiles déclaratifs (registry)", () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it("CHATBOT_CITIZEN_LAYERS est dérivé du registre via usageProfiles.chatbot.citizenRelevant", () => {
    expect(CHATBOT_CITIZEN_LAYERS.length).toBeGreaterThanOrEqual(8);
    for (const ref of CHATBOT_CITIZEN_LAYERS) {
      const entry = getLayerEntry(ref.serviceKey, ref.layerId);
      expect(entry, `entry registre attendue pour ${ref.serviceKey}/${ref.layerId}`).toBeDefined();
      expect(entry?.usageProfiles?.chatbot?.citizenRelevant).toBe(true);
    }
  });

  it("une couche sans profil chatbot n’apparaît pas dans CHATBOT_CITIZEN_LAYERS", () => {
    const travaux = LAYER_REGISTRY.find(e => e.serviceKey === "travaux" && e.layerId === 3);
    expect(travaux).toBeDefined();
    expect(getChatbotProfile(travaux!)?.citizenRelevant).toBeFalsy();
    const inList = CHATBOT_CITIZEN_LAYERS.some(
      r => r.serviceKey === "travaux" && r.layerId === 3,
    );
    expect(inList).toBe(false);
  });

  it("travaux a un profil openData requiresLegalReview + dashboard.relevant=true", () => {
    const travaux = getLayerEntry("travaux", 3);
    expect(travaux).toBeDefined();
    const od = getOpenDataProfile(travaux!);
    const db = getDashboardProfile(travaux!);
    expect(od?.requiresLegalReview).toBe(true);
    expect(od?.publicationReadinessHint).toBe("requires_legal_review");
    expect(db?.relevant).toBe(true);
    expect(Array.isArray(db?.kpiHints)).toBe(true);
    expect((db?.kpiHints?.length ?? 0)).toBeGreaterThan(0);
  });

  it("assessOpenDataCandidate ne classe jamais VERT une couche dont le profil exige une revue juridique", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const inv = await runInventoryAllLayers(cfg, {
      mode: "internal",
      sampleLimit: 5,
      fast: true,
      targets: [{ serviceKey: "travaux", layerId: 3 }],
    });
    const row = inv.layers.find(l => l.serviceKey === "travaux" && l.layerId === 3);
    expect(row).toBeDefined();
    const od = assessOpenDataCandidate(row!);
    expect(od.tier).not.toBe("green");
    expect(["requires_legal_review", "do_not_publish", "requires_business_validation"]).toContain(
      od.publicationReadiness,
    );
  });

  it("runRecommendOpenDataCandidates : aucune couche internal ne ressort en greenCandidates", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const r = await runRecommendOpenDataCandidates(cfg, {
      mode: "internal",
      sampleLimit: 5,
      fast: true,
      targets: [{ serviceKey: "travaux", layerId: 3 }],
    });
    for (const row of r.greenCandidates) {
      expect(row.visibility).not.toBe("internal");
    }
  });

  it("rapport chatbot : couche WC (citoyen) présente, couche travaux (non-citoyen) absente", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const r = await runGenerateChatbotReadinessReport(cfg, {
      mode: "public",
      sampleLimit: 5,
      fast: true,
      format: "json",
    });
    const allLayers = [
      ...r.structured.ready,
      ...r.structured.usableNow,
      ...r.structured.usableWithCaution,
      ...r.structured.notReady,
      ...r.structured.unknownRequiresCheck,
    ];
    const hasWc = allLayers.some(l => l.serviceKey === "equipements" && l.layerId === 5);
    expect(hasWc).toBe(true);
    const hasTravaux = allLayers.some(l => l.serviceKey === "travaux");
    expect(hasTravaux).toBe(false);
  });

  it("safeAnswerRules issus du profil sont propagés dans perLayer du rapport chatbot", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const wcEntry = getLayerEntry("equipements", 5);
    const profileRules = getChatbotProfile(wcEntry!)?.safeAnswerRules ?? [];
    const r = await runGenerateChatbotReadinessReport(cfg, {
      mode: "public",
      sampleLimit: 5,
      fast: true,
      format: "json",
      targets: [{ serviceKey: "equipements", layerId: 5 }],
    });
    const wcDetail = r.structured.perLayer.find(
      p => p.serviceKey === "equipements" && p.layerId === 5,
    );
    expect(wcDetail).toBeDefined();
    if (profileRules.length > 0) {
      // chaque règle déclarée dans le profil doit apparaître dans le rapport.
      for (const rule of profileRules) {
        expect(wcDetail!.safeAnswerRules).toContain(rule);
      }
    } else {
      // au minimum, les règles génériques V0.7 sont présentes.
      expect(wcDetail!.safeAnswerRules.length).toBeGreaterThan(0);
    }
  });

  it("dashboard : une couche internal reste internal (pas d’escalade publique via le profil)", () => {
    const travaux = getLayerEntry("travaux", 3);
    expect(travaux?.visibility).toBe("internal");
    expect(getDashboardProfile(travaux!)?.relevant).toBe(true);
    // Le profil dashboard ne doit jamais transformer la visibilité métier.
    expect(travaux?.visibility).toBe("internal");
  });
});
