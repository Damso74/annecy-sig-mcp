import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../src/utils/concurrency.js";
import { computePreliminaryQualityScore } from "../src/utils/inventoryScore.js";
import { clampInventoryConcurrency, parseRadiusMeters } from "../src/utils/validation.js";
import {
  isSensitiveMetadataKey,
  sanitizeArcgisLayerMetadata,
  sanitizeArcgisFields,
} from "../src/utils/sanitizeArcgisMetadata.js";
import { writeReportOutput, formatExportFilenameTimestamp } from "../src/utils/reportOutput.js";
import { loadConfig } from "../src/config.js";
import type { EsriLayerMetadata } from "../src/arcgis/types.js";

describe("mapWithConcurrency (V0.6)", () => {
  it("conserve l’ordre des résultats", async () => {
    const items = [1, 2, 3, 4, 5];
    const delays = [30, 10, 20, 5, 15];
    const out = await mapWithConcurrency(items, 3, async (n, i) => {
      await new Promise(r => setTimeout(r, delays[i]!));
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });
});

describe("clampInventoryConcurrency (V0.6)", () => {
  it("défaut 3 si absent", () => {
    expect(clampInventoryConcurrency(undefined)).toBe(3);
    expect(clampInventoryConcurrency(null)).toBe(3);
  });
  it("borne 1–6", () => {
    expect(clampInventoryConcurrency(1)).toBe(1);
    expect(clampInventoryConcurrency(6)).toBe(6);
    expect(() => clampInventoryConcurrency(0)).toThrow();
    expect(() => clampInventoryConcurrency(7)).toThrow();
  });
});

describe("parseRadiusMeters (V0.6)", () => {
  it("respecte le plafond passé en argument", () => {
    expect(parseRadiusMeters(1000, 500, 2000)).toBe(1000);
    expect(() => parseRadiusMeters(3000, 500, 2000)).toThrow();
  });
});

describe("computePreliminaryQualityScore — sous-scores V0.6", () => {
  it("échantillon non fiable : technicalScore bas, score historique inchangé", () => {
    const r = computePreliminaryQualityScore({
      visibility: "public",
      serviceKey: "equipements",
      riskLevel: "green",
      hasGeometryInSample: false,
      geometryStatus: "unknown",
      sampleReliable: false,
      readableFillRate: 0,
      keyFieldNullRate: 1,
      dateFreshnessProxy: 0,
      supportsQuery: true,
      missingRegistryFieldRatio: 0,
      sampleFallbackUsed: "none",
    });
    expect(r.score).toBe(68);
    expect(r.technicalScore).toBe(65);
    expect(r.dataQualityScore).toBe(38);
  });

  it("technique OK mais libellés vides : bon technicalScore, dataQualityScore plus bas", () => {
    const r = computePreliminaryQualityScore({
      visibility: "public",
      serviceKey: "equipements",
      riskLevel: "green",
      hasGeometryInSample: true,
      geometryStatus: "present",
      sampleReliable: true,
      readableFillRate: 0,
      keyFieldNullRate: 1,
      dateFreshnessProxy: 0.5,
      supportsQuery: true,
      missingRegistryFieldRatio: 0,
      sampleFallbackUsed: "registry_valid",
    });
    expect(r.technicalScore).toBe(100);
    expect(r.dataQualityScore).toBe(18);
    expect(r.score).toBe(60);
  });
});

describe("sanitizeArcgisMetadata (V0.6)", () => {
  it("détecte les fragments sensibles dans les noms de clés", () => {
    expect(isSensitiveMetadataKey("created_user")).toBe(true);
    expect(isSensitiveMetadataKey("url_pj")).toBe(true);
    expect(isSensitiveMetadataKey("objectid")).toBe(false);
  });

  it("sanitizeArcgisLayerMetadata retire editingInfo et champs sensibles", () => {
    const meta = {
      id: 0,
      name: "L",
      type: "Feature Layer",
      geometryType: "esriGeometryPoint",
      capabilities: "Query",
      fields: [
        { name: "OBJECTID", type: "esriFieldTypeOID" },
        { name: "denomination", type: "esriFieldTypeString" },
        { name: "created_user", type: "esriFieldTypeString" },
      ],
      editingInfo: { x: 1 },
      templates: [],
    } as unknown as EsriLayerMetadata;
    const s = sanitizeArcgisLayerMetadata(meta, { mode: "internal", includeRawMetadata: true });
    expect(s).not.toHaveProperty("editingInfo");
    expect(JSON.stringify(s).toLowerCase()).not.toContain("created_user");
  });

  it("sanitizeArcgisFields conserve objectid, retire token-like", () => {
    const fields = [
      { name: "OBJECTID", type: "esriFieldTypeOID" },
      { name: "password_hint", type: "esriFieldTypeString" },
    ];
    const s = sanitizeArcgisFields(fields, "internal");
    expect(s.map(f => f.name)).toEqual(["OBJECTID"]);
  });
});

describe("writeReportOutput — méta export V0.6", () => {
  const touched = ["REPORT_OUTPUT_DIR"] as const;
  afterEach(() => {
    for (const k of touched) delete process.env[k];
  });

  it("préfixe JSON avec exportMeta", async () => {
    const dir = await mkdtemp(join(tmpdir(), "annecy-sig-mcp-export-"));
    process.env.REPORT_OUTPUT_DIR = dir;
    const cfg = loadConfig();
    const raw = JSON.stringify({ hello: "world" });
    const out = await writeReportOutput(cfg, "open-data-brief-public", "json", raw, {
      generatedAt: "2026-04-30T12:00:00.000Z",
      mode: "public",
      sampleLimit: 5,
      concurrency: 3,
      fast: false,
      sourceVersion: "0.6.0",
      runtimeMs: 42,
      filters: { x: 1 },
    });
    const body = await readFile(out.path, "utf8");
    expect(body).toContain("exportMeta");
    expect(body).not.toContain("created_user");
    expect(body).not.toContain("password");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("formatExportFilenameTimestamp", () => {
  it("remplace les deux-points pour noms de fichiers", () => {
    expect(formatExportFilenameTimestamp("2026-04-30T19:12:47.123Z")).toMatch(/2026-04-30T19-12-47/);
  });
});
