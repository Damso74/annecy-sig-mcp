import { describe, expect, it } from "vitest";
import { detectGeometryNullInSample } from "../src/tools/quality.js";
import { buildWorkQualityFlags } from "../src/tools/queryLayer.js";

describe("detectGeometryNullInSample", () => {
  it("détecte les géométries nulles", () => {
    const r = detectGeometryNullInSample([{ geometry: null }, { geometry: { type: "Point", coordinates: [6, 45] } }]);
    expect(r.missingGeometryCount).toBe(1);
  });
});

describe("buildWorkQualityFlags", () => {
  it("détecte ac_date_fin < ac_date_debut", () => {
    const flags = buildWorkQualityFlags(
      { ac_date_debut: 2_000_000_000_000, ac_date_fin: 1_000_000_000_000 },
      { type: "Point", coordinates: [6, 45] },
    );
    expect(flags.invalidDateOrder).toBe(true);
  });

  it("signale géométrie manquante", () => {
    const flags = buildWorkQualityFlags({ titre: "x" }, null);
    expect(flags.missingGeometry).toBe(true);
  });
});
