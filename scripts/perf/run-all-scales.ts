/**
 * Enchaîne les échelles x1, x10, x100 et agrège les résultats dans docs/perf/load-test-multi.latest.json
 */

import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SCALES = [1, 10, 100] as const;

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

async function main(): Promise<void> {
  const aggregated: {
    generatedAt: string;
    scales: { scale: number; raw: unknown }[];
  } = { generatedAt: new Date().toISOString(), scales: [] };

  for (const scale of SCALES) {
    const r = spawnSync("npm", ["run", "perf:load-test"], {
      cwd: repoRoot,
      env: { ...process.env, PERF_SCALE: String(scale), PERF_SKIP_SEED: "0" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.status !== 0) {
      console.error(r.stderr);
      throw new Error(`Échec suite scale=${scale}`);
    }
    const latest = JSON.parse(
      await readFile(new URL("../../docs/perf/load-test-results.latest.json", import.meta.url), "utf8")
    );
    aggregated.scales.push({ scale, raw: latest });
  }

  const outDir = new URL("../../docs/perf/", import.meta.url);
  await writeFile(
    new URL("../../docs/perf/load-test-multi.latest.json", import.meta.url),
    JSON.stringify(aggregated, null, 2),
    "utf8"
  );
  console.log(JSON.stringify(aggregated, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
