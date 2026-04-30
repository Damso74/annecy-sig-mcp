import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { writeReportOutput } from "../src/utils/reportOutput.js";

const touchedEnv = ["ARCGIS_TIMEOUT_MS", "ARCGIS_CACHE_TTL_MS", "REPORT_OUTPUT_DIR"] as const;

afterEach(() => {
  for (const key of touchedEnv) {
    delete process.env[key];
  }
});

describe("configuration v0.3", () => {
  it("charge timeout, cache TTL et dossier d’export depuis l’environnement", () => {
    process.env.ARCGIS_TIMEOUT_MS = "2500";
    process.env.ARCGIS_CACHE_TTL_MS = "60000";
    process.env.REPORT_OUTPUT_DIR = "custom-outputs";

    const cfg = loadConfig();

    expect(cfg.arcgisTimeoutMs).toBe(2500);
    expect(cfg.arcgisCacheTtlMs).toBe(60000);
    expect(cfg.reportOutputDir).toBe("custom-outputs");
  });
});

describe("writeReportOutput", () => {
  it("écrit un rapport markdown dans le dossier demandé", async () => {
    const dir = await mkdtemp(join(tmpdir(), "annecy-sig-mcp-"));
    process.env.REPORT_OUTPUT_DIR = dir;
    const cfg = loadConfig();

    const output = await writeReportOutput(cfg, "Rapport Test", "markdown", "# OK\n");
    const body = await readFile(output.path, "utf8");

    expect(output.path).toContain(dir);
    expect(output.path.endsWith(".md")).toBe(true);
    expect(body).toBe("# OK\n");

    await rm(dir, { recursive: true, force: true });
  });
});
