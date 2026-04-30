import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import {
  ChatbotReadinessReportSchema,
  InternalDashboardBriefSchema,
  InventoryReportSchema,
  InventoryRunResultSchema,
  LayerActionPlanSchema,
  OpenDataBriefSchema,
} from "./index.js";
import { InventoryLayerRowSchema } from "./inventoryContracts.js";
import {
  GeometryStatusSchema,
  InventoryDiagnosticSchema,
  InventoryDiagnosticsCountsSchema,
  InventoryExecutionMetaSchema,
  InventorySourceV1Schema,
  InventoryTargetSchema,
  LayerIdSchema,
  ReportFormatSchema,
  RiskLevelSchema,
  RuntimeMsSchema,
  SampleFallbackUsedSchema,
  SampleStatusSchema,
  SamplingModeSchema,
  ServerVersionSchema,
  ServiceKeySchema,
  UsageStatusSchema,
  VisibilityModeSchema,
} from "./common.js";

/**
 * Génère les JSON Schemas (draft-07) à partir des schémas Zod V0.9 et les écrit
 * dans `schemas/` à la racine du repo.
 *
 * V0.9 — toutes les briques communes nommées (`ServiceKey`, `LayerId`, `ServerVersion`,
 * `RuntimeMs`, `InventorySourceV1`, …) sont passées à `zod-to-json-schema` via
 * l’option `definitions`. Résultat : chaque JSON Schema généré référence ces
 * briques par leur nom, ce qui :
 * - élimine les `$ref` croisés bizarres entre champs hétérogènes (ex. `serverVersion`
 *   pointant vers la `definition` de `serviceKey` parce qu’ils partageaient
 *   `z.string().min(1)`) ;
 * - documente le contrat (les `description` Zod remontent dans le JSON Schema) ;
 * - permet aux pipelines aval de réutiliser les définitions communes.
 */
type SchemaJob = {
  /** Nom utilisé comme clé `$ref` racine. */
  name: string;
  schema: ZodTypeAny;
  filename: string;
};

const SHARED_DEFINITIONS: Record<string, ZodTypeAny> = {
  ServiceKey: ServiceKeySchema,
  LayerId: LayerIdSchema,
  ServerVersion: ServerVersionSchema,
  RuntimeMs: RuntimeMsSchema,
  ReportFormat: ReportFormatSchema,
  VisibilityMode: VisibilityModeSchema,
  SampleStatus: SampleStatusSchema,
  GeometryStatus: GeometryStatusSchema,
  RiskLevel: RiskLevelSchema,
  UsageStatus: UsageStatusSchema,
  SamplingMode: SamplingModeSchema,
  SampleFallbackUsed: SampleFallbackUsedSchema,
  InventoryTarget: InventoryTargetSchema,
  InventoryDiagnostic: InventoryDiagnosticSchema,
  InventoryDiagnosticsCounts: InventoryDiagnosticsCountsSchema,
  InventoryExecutionMeta: InventoryExecutionMetaSchema,
  InventorySourceV1: InventorySourceV1Schema,
};

const JOBS: SchemaJob[] = [
  { name: "InventoryRunResult", schema: InventoryRunResultSchema, filename: "inventory-run-result.schema.json" },
  { name: "InventoryLayerRow", schema: InventoryLayerRowSchema, filename: "inventory-layer-row.schema.json" },
  { name: "InventoryReport", schema: InventoryReportSchema, filename: "inventory-report.schema.json" },
  { name: "OpenDataBrief", schema: OpenDataBriefSchema, filename: "open-data-brief.schema.json" },
  { name: "ChatbotReadinessReport", schema: ChatbotReadinessReportSchema, filename: "chatbot-readiness.schema.json" },
  { name: "LayerActionPlan", schema: LayerActionPlanSchema, filename: "layer-action-plan.schema.json" },
  { name: "InternalDashboardBrief", schema: InternalDashboardBriefSchema, filename: "internal-dashboard-brief.schema.json" },
];

export function exportJsonSchemas(outDir: string): { written: string[] } {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const job of JOBS) {
    const json = zodToJsonSchema(job.schema, {
      name: job.name,
      target: "jsonSchema7",
      definitions: SHARED_DEFINITIONS,
      definitionPath: "definitions",
      $refStrategy: "root",
    });
    const filePath = join(outDir, job.filename);
    writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n", "utf8");
    written.push(filePath);
  }
  return { written };
}

const isMain = (() => {
  try {
    const here = fileURLToPath(import.meta.url);
    return process.argv[1] !== undefined && process.argv[1] === here;
  } catch {
    return false;
  }
})();

if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "..", "schemas");
  const { written } = exportJsonSchemas(outDir);
  // stderr seulement — stdout est réservé au transport MCP.
  console.error(`[contracts] ${written.length} JSON Schema écrit(s) dans ${outDir}`);
  for (const f of written) console.error(`  - ${f}`);
}
