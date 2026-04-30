import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");

/** Version du package npm (source de vérité au build). */
export const SERVER_VERSION: string = (
  JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }
).version;

/** Schéma stable des payloads `source` — ne pas versionner par release applicative (v04, v05, …). */
export const INVENTORY_SCHEMA_VERSION = "inventory.v1" as const;
export type InventorySchemaVersion = typeof INVENTORY_SCHEMA_VERSION;
export const OPEN_DATA_SCHEMA_VERSION = "open_data.v1" as const;
export const CHATBOT_SCHEMA_VERSION = "chatbot_readiness.v1" as const;
export const REPORT_SCHEMA_VERSION = "report.v1" as const;
export const INTERNAL_DASHBOARD_SCHEMA_VERSION = "internal_dashboard.v1" as const;
export const LAYER_ACTION_PLAN_SCHEMA_VERSION = "layer_action_plan.v1" as const;
