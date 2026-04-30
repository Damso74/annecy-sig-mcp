import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportJsonSchemas } from "./exportJsonSchemas.js";

/**
 * `npm run schemas:check` — vérifie que les fichiers `schemas/` versionnés sont
 * exactement ceux qu’on régénère depuis les schémas Zod actuels.
 *
 * Stratégie volontairement **sans dépendance à git** :
 * - on régénère dans un dossier temporaire ;
 * - on compare octet-par-octet (après normalisation des fins de ligne) chaque
 *   fichier attendu avec celui versionné ;
 * - tout écart fait sortir avec code 1 et un message exploitable indiquant le
 *   fichier en cause et la commande à lancer pour corriger (`npm run schemas`).
 *
 * Ce comportement vaut aussi quand le repo n’est pas un repo git (au moment
 * où le script est exécuté en CI sur un clone partiel, par exemple).
 */
function normalize(content: string): string {
  // Normalise CRLF / LF afin que la diff fonctionne identiquement sur Windows.
  return content.replace(/\r\n/g, "\n");
}

export function checkJsonSchemas(versionedDir: string): {
  ok: boolean;
  missing: string[];
  extra: string[];
  diffs: string[];
} {
  const tmp = mkdtempSync(join(tmpdir(), "annecy-sig-schemas-check-"));
  try {
    const { written } = exportJsonSchemas(tmp);
    const expectedNames = written.map(p => p.split(/[\\/]/).pop()!).sort();
    let versioned: string[] = [];
    try {
      versioned = readdirSync(versionedDir).filter(f => f.endsWith(".schema.json")).sort();
    } catch {
      versioned = [];
    }

    const missing = expectedNames.filter(n => !versioned.includes(n));
    const extra = versioned.filter(n => !expectedNames.includes(n));
    const diffs: string[] = [];

    for (const name of expectedNames) {
      if (!versioned.includes(name)) continue;
      const generated = normalize(readFileSync(join(tmp, name), "utf8"));
      const onDisk = normalize(readFileSync(join(versionedDir, name), "utf8"));
      if (generated !== onDisk) diffs.push(name);
    }

    return {
      ok: missing.length === 0 && extra.length === 0 && diffs.length === 0,
      missing,
      extra,
      diffs,
    };
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
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
  const versionedDir = join(here, "..", "..", "schemas");
  const r = checkJsonSchemas(versionedDir);
  if (r.ok) {
    console.error("[schemas:check] OK — les JSON Schemas versionnés sont à jour.");
    process.exit(0);
  }
  console.error("[schemas:check] DIVERGENCE détectée :");
  if (r.missing.length) {
    console.error(`  - fichiers manquants côté repo : ${r.missing.join(", ")}`);
  }
  if (r.extra.length) {
    console.error(
      `  - fichiers présents dans le repo mais non générés : ${r.extra.join(", ")}`,
    );
  }
  if (r.diffs.length) {
    console.error(`  - fichiers dont le contenu diffère : ${r.diffs.join(", ")}`);
  }
  console.error('\nCorrection : exécuter `npm run schemas` puis committer le diff.');
  process.exit(1);
}
