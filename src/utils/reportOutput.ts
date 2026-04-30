import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "../config.js";

export type ReportOutput = {
  path: string;
  format: "json" | "markdown";
  writtenAt: string;
};

/** Méta d’export V0.6 — jamais de secrets ; champs techniques uniquement. */
export type ReportExportMeta = {
  generatedAt: string;
  mode?: string;
  sampleLimit?: number;
  concurrency?: number;
  fast?: boolean;
  sourceVersion: string;
  runtimeMs: number;
  filters?: Record<string, unknown>;
};

function safePart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** Horodatage stable pour noms de fichiers (sans `:` pour Windows). */
export function formatExportFilenameTimestamp(isoDate: string): string {
  return isoDate.replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
}

function yamlEscape(s: string): string {
  if (/[\n:"']/.test(s)) return JSON.stringify(s);
  return s;
}

function metaYamlFrontMatter(meta: ReportExportMeta): string {
  const lines = ["---", `generatedAt: ${yamlEscape(meta.generatedAt)}`, `sourceVersion: ${yamlEscape(meta.sourceVersion)}`];
  if (meta.mode !== undefined) lines.push(`mode: ${yamlEscape(meta.mode)}`);
  if (meta.sampleLimit !== undefined) lines.push(`sampleLimit: ${meta.sampleLimit}`);
  if (meta.concurrency !== undefined) lines.push(`concurrency: ${meta.concurrency}`);
  if (meta.fast !== undefined) lines.push(`fast: ${meta.fast}`);
  lines.push(`runtimeMs: ${meta.runtimeMs}`);
  if (meta.filters && Object.keys(meta.filters).length > 0) {
    lines.push("filters:");
    for (const [k, v] of Object.entries(meta.filters)) {
      lines.push(`  ${k}: ${typeof v === "string" ? yamlEscape(v) : JSON.stringify(v)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

export async function writeReportOutput(
  cfg: AppConfig,
  reportName: string,
  format: "json" | "markdown",
  body: string,
  meta?: ReportExportMeta,
): Promise<ReportOutput> {
  const writtenAt = meta?.generatedAt ?? new Date().toISOString();
  const ext = format === "markdown" ? "md" : "json";
  const ts = formatExportFilenameTimestamp(writtenAt);
  const filename = `${safePart(reportName)}-${ts}.${ext}`;
  await mkdir(cfg.reportOutputDir, { recursive: true });
  const path = join(cfg.reportOutputDir, filename);

  let outBody = body;
  if (meta) {
    if (format === "markdown") {
      outBody = `${metaYamlFrontMatter(meta)}\n\n${body}`;
    } else {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const merged = { exportMeta: meta, ...parsed };
        outBody = JSON.stringify(merged, null, 2);
      } catch {
        outBody = JSON.stringify({ exportMeta: meta, body }, null, 2);
      }
    }
  }

  await writeFile(path, outBody, "utf8");
  return { path, format, writtenAt };
}
