import { PrismaClient } from "@prisma/client";

/**
 * Client Prisma dédié aux scripts de perf (variable d'environnement locale uniquement).
 */
export function createPerfPrisma(): PrismaClient {
  const url = process.env.PERF_DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error(
      "PERF_DATABASE_URL manquant. Exemple : postgresql://perf:perf@127.0.0.1:54333/perf_load?schema=public"
    );
  }
  return new PrismaClient({
    datasourceUrl: url,
    log: [{ level: "query", emit: "event" }],
  });
}
