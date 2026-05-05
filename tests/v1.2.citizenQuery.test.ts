import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  isOutOfScopeIntent,
  isWorksIntent,
  runCitizenQuery,
} from "../src/tools/citizenQuery.js";

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

describe("V1.2 — helpers de routage citoyen (isWorksIntent, isOutOfScopeIntent)", () => {
  it("isWorksIntent capture les variantes courantes (travaux, chantier, voirie, déviation, perturbation, rue barrée)", () => {
    expect(isWorksIntent("Y a-t-il des travaux près de Bonlieu ?")).toBe(true);
    expect(isWorksIntent("travaux dans ma rue")).toBe(true);
    expect(isWorksIntent("chantier en cours")).toBe(true);
    expect(isWorksIntent("voirie perturbée")).toBe(true);
    expect(isWorksIntent("rue barrée")).toBe(true);
    expect(isWorksIntent("circulation perturbée")).toBe(true);
    expect(isWorksIntent("déviation centre-ville")).toBe(true);
  });

  it("isWorksIntent ne déclenche pas sur des intentions hors travaux", () => {
    expect(isWorksIntent("toilettes publiques")).toBe(false);
    expect(isWorksIntent("place PMR près du Pâquier")).toBe(false);
    expect(isWorksIntent("où charger ma voiture électrique")).toBe(false);
    expect(isWorksIntent("garer mon vélo")).toBe(false);
  });

  it("isOutOfScopeIntent détecte les demandes de coordonnées / contact d'agents", () => {
    expect(
      isOutOfScopeIntent("Peux-tu me donner les coordonnées personnelles des agents de la voirie ?"),
    ).toBe(true);
    expect(isOutOfScopeIntent("téléphone d'un agent municipal")).toBe(true);
    expect(isOutOfScopeIntent("email d'un employé de la mairie")).toBe(true);
    expect(isOutOfScopeIntent("adresse personnelle d'un fonctionnaire")).toBe(true);
    expect(isOutOfScopeIntent("contact direct d'un agent du service voirie")).toBe(true);
  });

  it("isOutOfScopeIntent détecte les données RH et documents opposables", () => {
    expect(isOutOfScopeIntent("salaire des agents municipaux")).toBe(true);
    expect(isOutOfScopeIntent("rémunération du personnel mairie")).toBe(true);
    expect(isOutOfScopeIntent("certificat officiel pour la voirie")).toBe(true);
    expect(isOutOfScopeIntent("attestation officielle de travaux")).toBe(true);
    expect(isOutOfScopeIntent("données nominatives des agents")).toBe(true);
  });

  it("isOutOfScopeIntent ne fausse pas les demandes citoyennes légitimes", () => {
    expect(isOutOfScopeIntent("toilettes publiques près de la mairie")).toBe(false);
    expect(isOutOfScopeIntent("où sont les bornes de recharge VE ?")).toBe(false);
    expect(isOutOfScopeIntent("places PMR près du Pâquier")).toBe(false);
    expect(isOutOfScopeIntent("travaux dans ma rue")).toBe(false);
    expect(isOutOfScopeIntent("garer mon vélo près de la gare")).toBe(false);
    expect(isOutOfScopeIntent("y a-t-il des travaux près de Bonlieu ?")).toBe(false);
  });
});

describe("V1.2 — runCitizenQuery : garde out_of_scope (RGPD / nominatif)", () => {
  it("'coordonnées personnelles des agents' → out_of_scope, 0 item, message clair, jamais de couche SIG", async () => {
    const r = await runCitizenQuery(cfg, {
      query: "Peux-tu me donner les coordonnées personnelles des agents de la voirie ?",
    });
    expect(r.status).toBe("out_of_scope");
    expect(r.items).toHaveLength(0);
    expect(r.recommendedTool).toBeUndefined();
    expect(r.recommendedArguments).toBeUndefined();
    expect(r.citizenAnswer).toContain("périmètre");
    expect(r.citizenAnswer).toContain("Ville d'Annecy");
    const a = r.citizenAnswer.toLowerCase();
    expect(a).not.toMatch(/\bservicekey\b/);
    expect(a).not.toMatch(/\blayerid\b/);
    expect(a).not.toContain("cimetière");
    expect(r.source.mode).toBe("public");
  });

  it("'téléphone d'un agent municipal' → out_of_scope, pas d'item SIG absurde", async () => {
    const r = await runCitizenQuery(cfg, { query: "téléphone d'un agent municipal" });
    expect(r.status).toBe("out_of_scope");
    expect(r.items).toHaveLength(0);
    expect(r.recommendedTool).toBeUndefined();
  });

  it("'email d'un employé de la mairie' → out_of_scope, message oriente vers canaux officiels", async () => {
    const r = await runCitizenQuery(cfg, { query: "email d'un employé de la mairie d'Annecy" });
    expect(r.status).toBe("out_of_scope");
    expect(r.citizenAnswer.toLowerCase()).toContain("canaux");
  });
});
