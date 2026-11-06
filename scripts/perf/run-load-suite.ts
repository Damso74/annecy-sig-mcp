/**
 * Suite de tests de charge : rejoue des requêtes représentatives, mesure p50/p95 et le nombre de requêtes SQL par itération.
 * Phase 1 : index de perf retirés. Phase 2 : index recréés (équivalent migration d'optimisation).
 */

import { createPerfPrisma } from "./createPerfPrisma.js";
import { createPerfIndexes, dropPerfIndexes } from "./indexManagement.js";
import { seedLoadTest, envScale } from "./seed-load-test.js";

const ITER_LIST = 40;
const ITER_DASH = 25;
const ITER_SEARCH = 15;

type BenchResult = {
  name: string;
  iterations: number;
  p50Ms: number;
  p95Ms: number;
  sqlCountPerIteration: number;
};

type PhaseMetrics = {
  phase: "before_indexes" | "after_indexes";
  results: BenchResult[];
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function summarizeDurations(durations: number[]): { p50Ms: number; p95Ms: number } {
  const s = [...durations].sort((a, b) => a - b);
  return { p50Ms: percentile(s, 50), p95Ms: percentile(s, 95) };
}

async function runPhase(phase: PhaseMetrics["phase"]): Promise<BenchResult[]> {
  const setup = createPerfPrisma();
  if (phase === "before_indexes") {
    await dropPerfIndexes(setup);
  } else {
    await createPerfIndexes(setup);
  }
  await setup.$disconnect();

  const results: BenchResult[] = [];

  async function bench(
    name: string,
    iterations: number,
    fn: (prisma: ReturnType<typeof createPerfPrisma>) => Promise<void>
  ): Promise<void> {
    const durations: number[] = [];
    let totalSql = 0;

    for (let i = 0; i < iterations; i++) {
      const prisma = createPerfPrisma();
      let count = 0;
      prisma.$on("query", () => {
        count += 1;
      });
      const t0 = performance.now();
      await fn(prisma);
      durations.push(performance.now() - t0);
      totalSql += count;
      await prisma.$disconnect();
    }

    const { p50Ms, p95Ms } = summarizeDurations(durations);
    results.push({
      name,
      iterations,
      p50Ms: Math.round(p50Ms * 100) / 100,
      p95Ms: Math.round(p95Ms * 100) / 100,
      sqlCountPerIteration: Math.round(totalSql / iterations),
    });

    if (phase === "after_indexes" && process.env.PERF_EXPLAIN === "1" && name === "listContactsFiltered") {
      const prisma = createPerfPrisma();
      const sample = await prisma.$queryRaw<
        { "QUERY PLAN": string }[]
      >`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
        SELECT c.id, c.email, c."firstName", c."lastName", c.status, c.city, c.segment
        FROM "Contact" c
        WHERE c.status = 'ACTIVE'::"ContactStatus" AND c.city = 'Annecy'
        ORDER BY c."updatedAt" DESC
        LIMIT 50`;
      await prisma.$disconnect();
      console.log("\n--- EXPLAIN ANALYZE (échantillon listContactsFiltered) ---\n");
      console.log(sample.map((r) => r["QUERY PLAN"]).join("\n"));
    }
  }

  const cityFilter = "Annecy";
  const campaignId = "camp_0";
  const searchTerm = "prénom0 nom0";

  await bench("listContactsFiltered", ITER_LIST, async (prisma) => {
    await prisma.contact.findMany({
      where: { status: "ACTIVE", city: cityFilter },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        city: true,
        segment: true,
      },
    });
  });

  await bench("searchContactsTrigram", ITER_SEARCH, async (prisma) => {
    await prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id
      FROM "Contact" c
      WHERE similarity(
        lower(c."firstName" || ' ' || c."lastName" || ' ' || c.email),
        lower(${searchTerm})
      ) > 0.06
      ORDER BY similarity(
        lower(c."firstName" || ' ' || c."lastName" || ' ' || c.email),
        lower(${searchTerm})
      ) DESC
      LIMIT 30
    `;
  });

  await bench("campaignRecipientsJoin", ITER_DASH, async (prisma) => {
    await prisma.emailCampaignContact.findMany({
      where: { campaignId },
      take: 80,
      select: {
        id: true,
        sentAt: true,
        openedAt: true,
        contact: {
          select: { email: true, firstName: true, lastName: true, status: true },
        },
      },
    });
  });

  await bench("dashboardAggregates", ITER_DASH, async (prisma) => {
    await prisma.$transaction([
      prisma.contact.count({ where: { status: "ACTIVE" } }),
      prisma.emailCampaign.count({ where: { status: "COMPLETED" } }),
      prisma.papSession.count({ where: { outcome: "PENDING" } }),
      prisma.formInbound.count({ where: { status: "NEW" } }),
    ]);
  });

  await bench("papSessionsByContact", ITER_DASH, async (prisma) => {
    await prisma.papSession.findMany({
      where: { contactId: "c_0" },
      orderBy: { startedAt: "desc" },
      take: 100,
      select: { id: true, channel: true, outcome: true, startedAt: true },
    });
  });

  await bench("formInboundQueue", ITER_LIST, async (prisma) => {
    await prisma.formInbound.findMany({
      where: { status: "NEW" },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, email: true, subject: true, status: true, createdAt: true },
    });
  });

  return results;
}

async function main(): Promise<void> {
  const scale = envScale();

  if (process.env.PERF_SKIP_SEED !== "1") {
    await seedLoadTest(scale);
  }
  const prismaAnalyze = createPerfPrisma();
  for (const table of ["Contact", "EmailCampaignContact", "PapSession", "FormInbound"] as const) {
    await prismaAnalyze.$executeRawUnsafe(`ANALYZE "${table}";`);
  }
  await prismaAnalyze.$disconnect();

  const before = await runPhase("before_indexes");
  const after = await runPhase("after_indexes");

  const payload = {
    generatedAt: new Date().toISOString(),
    scale,
    phases: [
      { phase: "before_indexes", results: before },
      { phase: "after_indexes", results: after },
    ] as PhaseMetrics[],
  };

  const fs = await import("node:fs/promises");
  const perfDir = new URL("../../docs/perf/", import.meta.url);
  await fs.mkdir(perfDir, { recursive: true });
  await fs.writeFile(
    new URL("../../docs/perf/load-test-results.latest.json", import.meta.url),
    JSON.stringify(payload, null, 2),
    "utf8"
  );

  console.log("\n=== Résultats (JSON) ===\n");
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
