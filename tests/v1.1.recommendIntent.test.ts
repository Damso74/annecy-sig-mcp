import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { runRecommendLayersForIntent } from "../src/tools/recommendLayersForIntent.js";

const cfg = loadConfig();

describe("V1.1 — recommend_layers_for_intent", () => {
  it("trouve la borne VE pour 'voiture electrique'", () => {
    const r = runRecommendLayersForIntent(cfg, {
      intent: "où recharger ma voiture électrique près du centre",
      mode: "public",
      lat: 45.8992,
      lon: 6.1294,
    });
    expect(r.recommendations.length).toBeGreaterThan(0);
    const top = r.recommendations[0]!;
    expect(top.serviceKey).toBe("mobilite");
    expect(top.layerId).toBe(9);
    expect(top.suggestedCall.tool).toBe("search_nearby");
    expect(top.suggestedCall.args.serviceKey).toBe("mobilite");
    expect(top.suggestedCall.args.layerId).toBe(9);
    expect(top.suggestedCall.args.lat).toBe(45.8992);
  });

  it("PMR cible places PMR + WC PMR", () => {
    const r = runRecommendLayersForIntent(cfg, {
      intent: "place PMR",
      mode: "public",
    });
    const ids = r.recommendations.map(x => `${x.serviceKey}/${x.layerId}`);
    expect(ids).toContain("mobilite/8");
    expect(ids).toContain("equipements/5");
  });

  it("écoles → établissements scolaires + petite enfance", () => {
    const r = runRecommendLayersForIntent(cfg, {
      intent: "trouver une école pour mon enfant",
      mode: "public",
    });
    const ids = r.recommendations.map(x => `${x.serviceKey}/${x.layerId}`);
    expect(ids).toContain("equipements/1");
  });

  it("mode public n'expose pas les couches internal-only (travaux/3, mobilité/4)", () => {
    const r = runRecommendLayersForIntent(cfg, {
      intent: "travaux et stationnement convoyeur",
      mode: "public",
    });
    for (const reco of r.recommendations) {
      expect(reco.visibility, `${reco.serviceKey}/${reco.layerId}`).toBe("public");
    }
    const ids = r.recommendations.map(x => `${x.serviceKey}/${x.layerId}`);
    expect(ids).not.toContain("travaux/3");
    expect(ids).not.toContain("mobilite/4");
  });

  it("intention vide → recommandations vides", () => {
    const r = runRecommendLayersForIntent(cfg, { intent: "   ", mode: "public" });
    expect(r.recommendations).toEqual([]);
  });

  it("propose query_layer si lat/lon absents", () => {
    const r = runRecommendLayersForIntent(cfg, {
      intent: "WC publics",
      mode: "public",
    });
    expect(r.recommendations[0]?.suggestedCall.tool).toBe("query_layer");
  });
});
