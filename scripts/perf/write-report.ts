/**
 * Génère docs/perf/load-test-AAAA-MM-JJ.md à partir de load-test-multi.latest.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";

type Result = {
  name: string;
  p50Ms: number;
  p95Ms: number;
  sqlCountPerIteration: number;
};

type Payload = {
  scales: { scale: number; raw: { phases: { phase: string; results: Result[] }[] } }[];
};

function shortName(full: string): string {
  return full.replace(/\s*\[before_indexes\]\s*|\s*\[after_indexes\]\s*/g, "").trim();
}

async function main(): Promise<void> {
  const data: Payload = JSON.parse(
    await readFile(new URL("../../docs/perf/load-test-multi.latest.json", import.meta.url), "utf8")
  );

  const date = process.env.PERF_REPORT_DATE ?? new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Tests de charge Prisma / Postgres (local)`);
  lines.push(``);
  lines.push(`Date du rapport : ${date}`);
  lines.push(``);
  lines.push(`## Contexte`);
  lines.push(``);
  lines.push(
    `- Postgres jetable : **Docker** — \`docker compose -f docker-compose.perf.yml up -d\` (port **54333**, extension \`pg_trgm\` via \`scripts/perf/init-pg.sql\`).`
  );
  lines.push(
    `- **Preuve d'exécution (cet agent)** : Docker absent sur la VM CI — PostgreSQL 16 installé localement (\`pg_ctlcluster 16 main start\`), base \`perf_load\`, utilisateur \`perf\`, port **5432**. Variable : \`PERF_DATABASE_URL=postgresql://perf:perf@127.0.0.1:5432/perf_load?schema=public\`.`
  );
  lines.push(`- Variable équivalente Docker : \`postgresql://perf:perf@127.0.0.1:54333/perf_load?schema=public\`.`);
  lines.push(
    `- Ce dépôt ne contenait pas de schéma applicatif Prisma ; un schéma **minimal dédié aux benchmarks** a été ajouté sous \`prisma/\`.`
  );
  lines.push(`- Les mesures comparent **sans** puis **avec** les index de migration \`20251106140100_*\`.`);
  lines.push(
    `- \`EXPLAIN ANALYZE\` : \`PERF_EXPLAIN=1 npm run perf:load-test\` (un plan est affiché pour \`listContactsFiltered\` en phase « après index »).`
  );
  lines.push(``);
  lines.push(`## Relancer la suite`);
  lines.push(``);
  lines.push(`\`\`\`bash`);
  lines.push(`# Avec Docker (recommandé sur poste de dev)`);
  lines.push(`npm run perf:ci-local`);
  lines.push(`\`\`\``);
  lines.push(``);
  lines.push(`\`\`\`bash`);
  lines.push(`# Postgres local (sans Docker) — adapter le port si besoin`);
  lines.push(
    `export PERF_DATABASE_URL='postgresql://perf:perf@127.0.0.1:5432/perf_load?schema=public'`
  );
  lines.push(`npx prisma generate && npx prisma migrate deploy`);
  lines.push(`npm run perf:all-scales && PERF_REPORT_DATE=${date} npx tsx scripts/perf/write-report.ts`);
  lines.push(`\`\`\``);
  lines.push(``);

  for (const { scale, raw } of data.scales) {
    const before = raw.phases.find((p) => p.phase === "before_indexes")?.results ?? [];
    const after = raw.phases.find((p) => p.phase === "after_indexes")?.results ?? [];
    const byName = new Map<string, { b?: Result; a?: Result }>();
    for (const r of before) {
      const k = shortName(r.name);
      byName.set(k, { ...(byName.get(k) ?? {}), b: r });
    }
    for (const r of after) {
      const k = shortName(r.name);
      byName.set(k, { ...(byName.get(k) ?? {}), a: r });
    }

    lines.push(`## Échelle x${scale}`);
    lines.push(``);
    lines.push(
      `| Scénario | p50 avant (ms) | p95 avant (ms) | SQL/it avant | p50 après (ms) | p95 après (ms) | SQL/it après |`
    );
    lines.push(
      `| --- | ---: | ---: | ---: | ---: | ---: | ---: |`
    );

    const names = [...byName.keys()].sort();
    for (const name of names) {
      const { b, a } = byName.get(name)!;
      lines.push(
        `| ${name} | ${b?.p50Ms ?? "—"} | ${b?.p95Ms ?? "—"} | ${b?.sqlCountPerIteration ?? "—"} | ${a?.p50Ms ?? "—"} | ${a?.p95Ms ?? "—"} | ${a?.sqlCountPerIteration ?? "—"} |`
      );
    }
    lines.push(``);
  }

  lines.push(`## Migrations et optimisations`);
  lines.push(``);
  lines.push(`- \`20251106140000_init_crm_load_test\` : tables Contact, EmailCampaign, EmailCampaignContact, PapSession, FormInbound.`);
  lines.push(
    `- \`20251106140100_add_load_test_indexes\` : index de jointure, file formulaires, liste contacts (statut + ville + tri), index GIN trigram pour recherche type tableau de bord.`
  );
  lines.push(`- Les scénarios Prisma utilisent \`select\` ciblé (pas de N+1 sur les agrégats — tableaux de bord en transaction).`);
  lines.push(``);
  lines.push(`## Risques`);
  lines.push(``);
  lines.push(`- Schéma et scripts sont **à des fins de benchmark local** ; toute réutilisation en production nécessiterait alignement métier et revue d'index.`);
  lines.push(`- L'index GIN trigram augmente légèrement le coût des écritures sur \`Contact\`.`);
  lines.push(``);

  const dir = new URL("../../docs/perf/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const path = new URL(`../../docs/perf/load-test-${date}.md`, import.meta.url);
  await writeFile(path, lines.join("\n"), "utf8");
  console.log(`Rapport écrit : ${path.pathname}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
