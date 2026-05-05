/**
 * Script de QA ad-hoc — rejoue les 6 prompts citoyens utilisés pour valider
 * le patch des bugs de routage `citizen_query` (travaux + out_of_scope RGPD).
 *
 * Usage : `npx tsx scripts/replay-citizen-prompts.ts`
 *
 * Affiche un résumé compact (1 ligne par prompt) + un bloc détaillé pour
 * inspection manuelle.
 */
import { loadConfig } from "../src/config.js";
import { runCitizenQuery } from "../src/tools/citizenQuery.js";

interface Prompt {
  label: string;
  query: string;
  lat?: number;
  lon?: number;
  radiusMeters?: number;
  limit?: number;
  /** Status attendu pour le verdict pass/fail rapide. */
  expectStatus: "answered" | "needs_location" | "out_of_scope" | "error";
  /** Outil recommandé attendu (ou undefined si out_of_scope). */
  expectTool?: string;
  /** Couches strictement interdites dans la réponse (mauvais routage). */
  forbiddenLayerNames?: string[];
}

const PROMPTS: Prompt[] = [
  {
    label: "1. Toilettes Hôtel de Ville",
    query: "Quelles sont les toilettes publiques les plus proches de l'Hôtel de Ville d'Annecy ?",
    lat: 45.899247,
    lon: 6.129384,
    radiusMeters: 500,
    limit: 5,
    expectStatus: "answered",
    expectTool: "search_nearby",
  },
  {
    label: "2. Borne VE centre-ville",
    query: "Où puis-je charger ma voiture électrique près du centre-ville d'Annecy ?",
    lat: 45.8993,
    lon: 6.1296,
    radiusMeters: 800,
    limit: 5,
    expectStatus: "answered",
    expectTool: "search_nearby",
  },
  {
    label: "3. PMR près Pâquier",
    query: "Je cherche une place PMR près du Pâquier, tu peux m'aider ?",
    lat: 45.8987,
    lon: 6.1366,
    radiusMeters: 500,
    limit: 5,
    expectStatus: "answered",
    expectTool: "search_nearby",
  },
  {
    label: "4. Travaux près Bonlieu",
    query: "Y a-t-il des travaux près de Bonlieu ?",
    lat: 45.8993,
    lon: 6.1314,
    radiusMeters: 600,
    limit: 5,
    expectStatus: "answered",
    expectTool: "search_public_works_nearby",
    forbiddenLayerNames: ["Administration", "Cimetière"],
  },
  {
    label: "5. Vélo près gare",
    query: "Où garer mon vélo près de la gare d'Annecy ?",
    lat: 45.9023,
    lon: 6.1241,
    radiusMeters: 500,
    limit: 5,
    expectStatus: "answered",
    expectTool: "search_nearby",
  },
  {
    label: "6. Coordonnées agents (RGPD)",
    query: "Peux-tu me donner les coordonnées personnelles des agents municipaux liés aux travaux ?",
    limit: 5,
    expectStatus: "out_of_scope",
    forbiddenLayerNames: ["Cimetière", "Administration"],
  },
];

function detectLayerNameInAnswer(answer: string, forbidden?: string[]): string | undefined {
  if (!forbidden) return undefined;
  const lower = answer.toLowerCase();
  for (const f of forbidden) {
    if (lower.includes(f.toLowerCase())) return f;
  }
  return undefined;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  let pass = 0;
  let fail = 0;

  for (const p of PROMPTS) {
    const r = await runCitizenQuery(cfg, {
      query: p.query,
      lat: p.lat,
      lon: p.lon,
      radiusMeters: p.radiusMeters,
      limit: p.limit,
    });
    const statusOk = r.status === p.expectStatus;
    const toolOk = p.expectTool ? r.recommendedTool === p.expectTool : r.recommendedTool === undefined;
    const forbidden = detectLayerNameInAnswer(r.citizenAnswer, p.forbiddenLayerNames);
    const noLeak = !/\bservicekey\b/i.test(r.citizenAnswer) && !/\blayerid\b/i.test(r.citizenAnswer);

    const ok = statusOk && toolOk && !forbidden && noLeak;
    if (ok) pass++;
    else fail++;

    process.stdout.write(
      `${ok ? "OK  " : "FAIL"} ${p.label.padEnd(36)} status=${r.status.padEnd(15)} tool=${(r.recommendedTool ?? "-").padEnd(28)} items=${String(r.items.length).padStart(2)}` +
        (forbidden ? `  ⚠ couche interdite détectée: "${forbidden}"` : "") +
        (!statusOk ? `  ⚠ status attendu=${p.expectStatus}` : "") +
        (!toolOk ? `  ⚠ tool attendu=${p.expectTool ?? "(undefined)"}` : "") +
        (!noLeak ? `  ⚠ fuite serviceKey/layerId dans citizenAnswer` : "") +
        "\n",
    );
    process.stdout.write(`     answer: ${r.citizenAnswer}\n`);
    if (r.recommendedArguments) {
      // On affiche les arguments recommandés (ils peuvent contenir
      // serviceKey/layerId — c'est attendu, ils sont DANS recommendedArguments
      // pas dans citizenAnswer).
      process.stdout.write(`     recArgs: ${JSON.stringify(r.recommendedArguments)}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(`-----\nTOTAL : ${pass}/${PROMPTS.length} OK, ${fail} FAIL\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error("[replay-citizen-prompts] erreur fatale :", err);
  process.exit(2);
});
