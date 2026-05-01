import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source de vérité de la version exposée au client MCP.
 *
 * En local / build classique, on lit `package.json` à côté du code compilé.
 * Sur Vercel (et tout bundler qui peut déplacer le fichier), `import.meta.url`
 * ne pointe plus à 2 niveaux au-dessus de `package.json` — la lecture
 * naïve échoue avec ENOENT et fait crasher l'import au top-level (et donc
 * la fonction Vercel : `FUNCTION_INVOCATION_FAILED`).
 *
 * On essaie donc plusieurs candidats puis on retombe sur un fallback statique
 * tenu à jour avec `package.json`. Ce fallback est compatible avec les
 * contraintes du projet (aucun bump non documenté).
 */

const FALLBACK_VERSION = "1.0.0-rc.1";

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // Ordre : layout source classique (src/runtime → ../../package.json),
    // puis layout dist/ identique, puis quelques remontées au cas où le
    // bundler aurait déplacé le fichier.
    const candidates = [
      join(here, "..", "..", "package.json"),
      join(here, "..", "package.json"),
      join(here, "package.json"),
      resolve(process.cwd(), "package.json"),
    ];
    for (const path of candidates) {
      try {
        const raw = readFileSync(path, "utf8");
        const parsed = JSON.parse(raw) as { version?: string; name?: string };
        // Garde-fou : on ne veut pas tomber sur n'importe quel package.json
        // (ex. le package.json d'un bundler hôte). On exige le bon `name`.
        if (parsed.name === "annecy-sig-mcp" && typeof parsed.version === "string") {
          return parsed.version;
        }
      } catch {
        // chemin suivant
      }
    }
  } catch {
    // import.meta.url indisponible ? on retombe sur le fallback.
  }
  return FALLBACK_VERSION;
}

/** Version du package npm — résolue dynamiquement en local, fallback Vercel-safe. */
export const SERVER_VERSION: string = readPackageVersion();

/** Schéma stable des payloads `source` — ne pas versionner par release applicative (v04, v05, …). */
export const INVENTORY_SCHEMA_VERSION = "inventory.v1" as const;
export type InventorySchemaVersion = typeof INVENTORY_SCHEMA_VERSION;
export const OPEN_DATA_SCHEMA_VERSION = "open_data.v1" as const;
export const CHATBOT_SCHEMA_VERSION = "chatbot_readiness.v1" as const;
export const REPORT_SCHEMA_VERSION = "report.v1" as const;
export const INTERNAL_DASHBOARD_SCHEMA_VERSION = "internal_dashboard.v1" as const;
export const LAYER_ACTION_PLAN_SCHEMA_VERSION = "layer_action_plan.v1" as const;
export const PUBLIC_WORKS_SCHEMA_VERSION = "public_works.v1" as const;
