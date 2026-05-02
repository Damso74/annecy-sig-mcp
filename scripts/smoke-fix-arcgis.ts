/**
 * Smoke ad hoc LIVE sur portailsig.annecy.fr — preuve que le filtrage `outFields`
 * via métadonnées corrige les HTTP 400 "Failed to execute query" sur :
 *
 * - `runQueryLayer` / `runSearchNearby` : couches mobilité, équipements
 * - `runListCurrentWorks` / `runListLateWorks` : travaux internes (works.ts)
 *
 * Lancement : `npx tsx scripts/smoke-fix-arcgis.ts`
 */
import { loadConfig } from "../src/config.js";
import { runQueryLayer, runSearchNearby } from "../src/tools/queryLayer.js";
import { runListCurrentWorks, runListLateWorks } from "../src/tools/works.js";

type Result = {
  scenario: string;
  ok: boolean;
  countReturned?: number;
  warnings?: string[];
  error?: string;
};

async function safe(scenario: string, fn: () => Promise<unknown>): Promise<Result> {
  try {
    const r = (await fn()) as { countReturned?: number; travaux?: unknown[]; warnings?: string[] };
    const count =
      typeof r.countReturned === "number"
        ? r.countReturned
        : Array.isArray(r.travaux)
          ? r.travaux.length
          : undefined;
    return { scenario, ok: true, countReturned: count, warnings: r.warnings?.slice(0, 3) };
  } catch (e) {
    return { scenario, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  const cfg = loadConfig();

  const results = await Promise.all([
    safe("query_layer mobilité/9 (bornes VE)", () =>
      runQueryLayer(cfg, { serviceKey: "mobilite", layerId: 9, limit: 3, mode: "public" }),
    ),
    safe("search_nearby mobilité/9 (Annecy centre, 1.5 km)", () =>
      runSearchNearby(cfg, {
        serviceKey: "mobilite",
        layerId: 9,
        lat: 45.8992,
        lon: 6.1294,
        radiusMeters: 1500,
        limit: 5,
        mode: "public",
      }),
    ),
    safe("query_layer équipements/1 (écoles)", () =>
      runQueryLayer(cfg, { serviceKey: "equipements", layerId: 1, limit: 3, mode: "public" }),
    ),
    safe("query_layer mobilité/8 (PMR)", () =>
      runQueryLayer(cfg, { serviceKey: "mobilite", layerId: 8, limit: 3, mode: "public" }),
    ),
    safe("query_layer mobilité/16 (Annecy Parking)", () =>
      runQueryLayer(cfg, { serviceKey: "mobilite", layerId: 16, limit: 3, mode: "public" }),
    ),
    safe("query_layer équipements/5 (WC publics — sentinelle)", () =>
      runQueryLayer(cfg, { serviceKey: "equipements", layerId: 5, limit: 3, mode: "public" }),
    ),
    safe("query_layer équipements/0 (administration)", () =>
      runQueryLayer(cfg, { serviceKey: "equipements", layerId: 0, limit: 3, mode: "public" }),
    ),
    safe("query_layer mobilité/10 (stationnement vélos)", () =>
      runQueryLayer(cfg, { serviceKey: "mobilite", layerId: 10, limit: 3, mode: "public" }),
    ),
    safe("query_layer mobilité/2 (parking relais)", () =>
      runQueryLayer(cfg, { serviceKey: "mobilite", layerId: 2, limit: 3, mode: "public" }),
    ),
    safe("query_layer mobilité/3 (stations vélonecy)", () =>
      runQueryLayer(cfg, { serviceKey: "mobilite", layerId: 3, limit: 3, mode: "public" }),
    ),
    safe("list_current_works (travaux internes)", () =>
      runListCurrentWorks(cfg, { limit: 5, includeGeometry: false }),
    ),
    safe("list_late_works (travaux retard)", () =>
      runListLateWorks(cfg, { limit: 5, includeGeometry: false }),
    ),
  ]);

  let ok = 0;
  for (const r of results) {
    if (r.ok) {
      ok++;
      console.log(`OK   ${r.scenario} — ${r.countReturned ?? "?"} feature(s)`);
      if (r.warnings?.length) {
        for (const w of r.warnings) console.log(`     warn: ${w}`);
      }
    } else {
      console.log(`FAIL ${r.scenario} — ${r.error}`);
    }
  }
  console.log(`\n${ok} / ${results.length} scénarios OK.`);
  process.exit(ok === results.length ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
