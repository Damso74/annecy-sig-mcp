import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { runCitizenQuery } from "../src/tools/citizenQuery.js";

/**
 * Tests offline `citizen_query` — on n'appelle pas ArcGIS : on s'arrête
 * volontairement sur les chemins « needs_location » et « out_of_scope ».
 *
 * Aucun appel réseau n'est attendu : si une intention serait routable, on
 * vérifie au moins le statut, l'absence d'invention et la présence du
 * disclaimer.
 */

const cfg = loadConfig();

describe("V1.2 — runCitizenQuery (offline)", () => {
  it("question vide ou trop courte : out_of_scope, pas d'invention", async () => {
    const r = await runCitizenQuery(cfg, { query: "?" });
    expect(r.status).toBe("out_of_scope");
    expect(r.items).toHaveLength(0);
  });

  it("intention spatiale sans coordonnées : needs_location, demande lieu, jamais layerId", async () => {
    const r = await runCitizenQuery(cfg, { query: "toilettes publiques près de la mairie d'Annecy" });
    expect(r.status).toBe("needs_location");
    expect(r.citizenAnswer.toLowerCase()).toContain("lieu");
    expect(r.citizenAnswer.toLowerCase()).not.toContain("layerid");
    expect(r.citizenAnswer.toLowerCase()).not.toContain("servicekey");
    expect(r.recommendedTool).toBe("search_nearby");
    expect(r.items).toHaveLength(0);
    expect(r.source.mode).toBe("public");
  });

  it("intention hors périmètre : out_of_scope avec orientation officielle", async () => {
    // Question délibérément éloignée du périmètre SIG (pas de mot-clé qui
    // matche une couche allowlistée). On évite tout token >=3 chars qui
    // serait une sous-chaîne d'un libellé/description de couche.
    const r = await runCitizenQuery(cfg, {
      query: "zzz xxx yyy qqq www nnn",
    });
    expect(r.status).toBe("out_of_scope");
    expect(r.citizenAnswer.toLowerCase()).toContain("officiels");
  });

  it("place PMR près du Pâquier sans coords : needs_location", async () => {
    const r = await runCitizenQuery(cfg, { query: "places PMR près du Pâquier" });
    expect(r.status).toBe("needs_location");
    expect(r.recommendedTool).toBe("search_nearby");
  });

  it("borne véhicule électrique sans coords : needs_location", async () => {
    const r = await runCitizenQuery(cfg, { query: "où charger ma voiture électrique près du centre" });
    expect(r.status).toBe("needs_location");
  });

  it("parking vélos sans coords : needs_location", async () => {
    const r = await runCitizenQuery(cfg, { query: "parkings vélos proches de la gare" });
    expect(r.status).toBe("needs_location");
  });

  it("toujours mode public et disclaimer dans les limitations", async () => {
    const r = await runCitizenQuery(cfg, { query: "toilettes publiques près de la mairie" });
    expect(r.source.mode).toBe("public");
    // Sur un statut needs_location, on injecte la note « pas d'invention ».
    expect(r.limitations.join(" ").toLowerCase()).toContain("ne renseigne ni les horaires");
  });

  it("sortie ne contient jamais de servicekey/layerId dans le citizenAnswer", async () => {
    const queries = [
      "toilettes publiques",
      "où me garer en VE",
      "places PMR",
      "comment renouveler ma carte ?",
    ];
    for (const q of queries) {
      const r = await runCitizenQuery(cfg, { query: q });
      const a = r.citizenAnswer.toLowerCase();
      expect(a).not.toMatch(/\bservicekey\b/);
      expect(a).not.toMatch(/\blayerid\b/);
    }
  });
});
