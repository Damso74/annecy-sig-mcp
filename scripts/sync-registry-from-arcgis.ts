/**
 * Sync registre ↔ ArcGIS — `npm run sync:registry`.
 *
 * Pour chaque couche allowlistée du registre :
 *   1. récupère le schéma `f=pjson` côté portail SIG ;
 *   2. recoupe les champs souhaités par défaut (registre générique par service)
 *      avec ceux réellement exposés ;
 *   3. classe chaque champ ArcGIS exposé en :
 *        - **public** (intersection registre ∩ ArcGIS, hors sensibles)
 *        - **internal extra** (autres champs ArcGIS, hors sensibles, hors géom)
 *        - **bloqué** (sensibles : `created_user`, `last_edited_*`, `token`,
 *          `password`, `secret`, `bearer`, `url_pj`, `url_piece_jointe`, etc.)
 *   4. génère `src/registry.fields.generated.ts` avec un `LAYER_FIELDS_OVERRIDES`
 *      structuré par `serviceKey` puis `layerId`.
 *
 * Le but est d'éliminer les warnings « champs registre absents » sur
 * `query_layer` / `search_nearby` en n'envoyant à ArcGIS QUE des `outFields`
 * réellement présents.
 *
 * Usage :
 *   npx tsx scripts/sync-registry-from-arcgis.ts [--check]
 *
 *   --check : ne réécrit pas le fichier mais sort en code 1 si l'override
 *             courant ne correspond plus à la réalité ArcGIS (drift CI).
 */
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { getLayerMetadata } from "../src/arcgis/client.js";
import {
  EQUIP_INTERNAL_EXTRA,
  EQUIP_PUBLIC_FIELDS,
  LAYER_REGISTRY,
  MOBIL_INTERNAL_EXTRA,
  MOBIL_PUBLIC_FIELDS,
  TRAVAUX_INTERNAL_FIELDS,
} from "../src/registry.js";
import type { LayerRegistryEntry } from "../src/registry.js";

const SENSITIVE_LC = new Set([
  "created_user",
  "created_date",
  "last_edited_user",
  "last_edited_date",
  "globalid",
  "shape",
  "shape_length",
  "shape_area",
  "token",
  "password",
  "secret",
  "bearer",
  "url_pj",
  "url_piece_jointe",
  "attachment",
]);

type Override = {
  publicFields: string[];
  internalExtraFields: string[];
  arcgisGeneratedAt: string;
};

function genericFor(entry: LayerRegistryEntry): {
  genericPublic: readonly string[];
  genericInternalExtra: readonly string[];
} {
  if (entry.serviceKey === "equipements") {
    return { genericPublic: EQUIP_PUBLIC_FIELDS, genericInternalExtra: EQUIP_INTERNAL_EXTRA };
  }
  if (entry.serviceKey === "mobilite") {
    return { genericPublic: MOBIL_PUBLIC_FIELDS, genericInternalExtra: MOBIL_INTERNAL_EXTRA };
  }
  if (entry.serviceKey === "travaux") {
    // Travaux : pas de champs publics par défaut, tous sont internal-only.
    return { genericPublic: [], genericInternalExtra: TRAVAUX_INTERNAL_FIELDS };
  }
  return { genericPublic: [], genericInternalExtra: [] };
}

async function buildOverride(entry: LayerRegistryEntry): Promise<Override> {
  const cfg = loadConfig();
  const meta = await getLayerMetadata(entry.serviceKey, cfg, entry.servicePath, entry.layerId);
  const arcgisFields = (meta.fields ?? []).map(f => f.name).filter((x): x is string => Boolean(x));
  const arcgisLc = new Set(arcgisFields.map(x => x.toLowerCase()));

  const { genericPublic } = genericFor(entry);
  const wantedPublicLc = new Set(genericPublic.map(x => x.toLowerCase()));

  const publicFields: string[] = [];
  const internalExtraFields: string[] = [];

  // Stratégie internal : exposer **tous** les champs ArcGIS non sensibles qui
  // ne sont pas déjà en public. C'est volontairement plus large que la liste
  // générique du registre (qui n'arrive jamais à couvrir l'hétérogénéité réelle
  // des couches). Le filtre SENSITIVE_LC reste la seule garde-fou côté schéma.
  for (const f of arcgisFields) {
    const lc = f.toLowerCase();
    if (SENSITIVE_LC.has(lc)) continue;
    if (wantedPublicLc.has(lc)) {
      publicFields.push(f);
    } else {
      internalExtraFields.push(f);
    }
  }

  // Garantir OBJECTID en tête (présent quasi systématiquement).
  const oidName = arcgisFields.find(f => f.toLowerCase() === "objectid");
  if (oidName) {
    const lc = oidName.toLowerCase();
    if (entry.serviceKey === "travaux") {
      // travaux : OBJECTID reste internal-only (pas de public)
      if (!internalExtraFields.some(x => x.toLowerCase() === lc) && !publicFields.some(x => x.toLowerCase() === lc)) {
        internalExtraFields.unshift(oidName);
      }
    } else if (!publicFields.some(x => x.toLowerCase() === lc)) {
      publicFields.unshift(oidName);
    }
  }

  return {
    publicFields,
    internalExtraFields,
    arcgisGeneratedAt: new Date().toISOString(),
  };
}

function renderFile(
  overrides: Record<string, Record<number, Override>>,
  generatedAt: string,
): string {
  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * Surcharges de champs par couche, alignées sur le schéma ArcGIS réel");
  lines.push(" * (récupéré via `f=pjson`).");
  lines.push(" *");
  lines.push(" * Fichier **généré** par `scripts/sync-registry-from-arcgis.ts`.");
  lines.push(" * Ne pas éditer à la main : lancer `npm run sync:registry` pour régénérer.");
  lines.push(" *");
  lines.push(" * Si une couche est absente de cet objet, le registre retombe sur les");
  lines.push(" * listes génériques par service (`EQUIP_PUBLIC_FIELDS` / `MOBIL_PUBLIC_FIELDS`).");
  lines.push(" */");
  lines.push("export type LayerFieldsOverride = {");
  lines.push("  /** Champs ArcGIS exposés en mode public (sous-ensemble validé contre `f=pjson`). */");
  lines.push("  publicFields: string[];");
  lines.push("  /** Champs supplémentaires uniquement disponibles en mode internal. */");
  lines.push("  internalExtraFields: string[];");
  lines.push("  /** Date ISO du `f=pjson` ayant servi à générer cette entrée. */");
  lines.push("  arcgisGeneratedAt: string;");
  lines.push("};");
  lines.push("");
  lines.push(`/** Synchronisé le ${generatedAt}. */`);
  lines.push("export const LAYER_FIELDS_OVERRIDES: Record<string, Record<number, LayerFieldsOverride>> = {");
  for (const serviceKey of Object.keys(overrides).sort()) {
    lines.push(`  ${JSON.stringify(serviceKey)}: {`);
    const layers = overrides[serviceKey];
    if (!layers) continue;
    const ids = Object.keys(layers)
      .map(n => Number(n))
      .sort((a, b) => a - b);
    for (const id of ids) {
      const o = layers[id];
      if (!o) continue;
      lines.push(`    ${id}: {`);
      lines.push(`      publicFields: ${JSON.stringify(o.publicFields)},`);
      lines.push(`      internalExtraFields: ${JSON.stringify(o.internalExtraFields)},`);
      lines.push(`      arcgisGeneratedAt: ${JSON.stringify(o.arcgisGeneratedAt)},`);
      lines.push(`    },`);
    }
    lines.push("  },");
  }
  lines.push("};");
  lines.push("");
  return lines.join("\n");
}

function targetPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "src", "registry.fields.generated.ts");
}

async function main() {
  const checkOnly = process.argv.includes("--check");

  console.log(`[sync-registry] mode = ${checkOnly ? "check" : "write"}`);
  console.log(`[sync-registry] couches à synchroniser : ${LAYER_REGISTRY.length}`);

  const overrides: Record<string, Record<number, Override>> = {};
  let failed = 0;
  for (const entry of LAYER_REGISTRY) {
    try {
      const o = await buildOverride(entry);
      overrides[entry.serviceKey] ??= {};
      overrides[entry.serviceKey]![entry.layerId] = o;
      console.log(
        `  OK  ${entry.serviceKey}/${entry.layerId} (${entry.layerName}) ` +
          `→ public=${o.publicFields.length} internalExtra=${o.internalExtraFields.length}`,
      );
    } catch (e) {
      failed++;
      console.log(
        `  FAIL ${entry.serviceKey}/${entry.layerId} (${entry.layerName}) ` +
          `→ ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Date "stable" pour --check : on neutralise arcgisGeneratedAt côté comparaison.
  const generatedAt = new Date().toISOString();
  const rendered = renderFile(overrides, generatedAt);

  const path = targetPath();
  if (checkOnly) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = "";
    }
    // Normaliser arcgisGeneratedAt avant comparaison (champ horodaté → on le retire).
    const normalize = (s: string) =>
      s.replace(/arcgisGeneratedAt: ".*?"/g, 'arcgisGeneratedAt: "<TS>"').replace(/Synchronisé le .*\./g, "Synchronisé le <TS>.");
    if (normalize(current) === normalize(rendered)) {
      console.log("[sync-registry] registry.fields.generated.ts en phase avec ArcGIS.");
      process.exit(failed === 0 ? 0 : 1);
    }
    console.log("[sync-registry] DRIFT détecté. Lancer `npm run sync:registry` pour mettre à jour.");
    process.exit(1);
  }

  writeFileSync(path, rendered, "utf8");
  console.log(`[sync-registry] écrit : ${path}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
