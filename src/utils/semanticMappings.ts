import type { SemanticMappings } from "../registry.js";

export type SemanticMappingKey = keyof SemanticMappings;

const FIELD_KEYS: SemanticMappingKey[] = [
  "labelField",
  "addressField",
  "communeField",
  "categoryField",
  "subCategoryField",
  "statusField",
  "openingField",
  "accessibilityField",
  "pmrField",
  "phoneField",
  "scheduleField",
  "descriptionField",
  "capacityField",
  "identifierField",
  "startDateField",
  "endDateField",
];

function lowerSet(names: string[]): Set<string> {
  return new Set(names.map(n => n.toLowerCase()));
}

/** Aplatit les mappings pour validation (hors `geometryRequired`). */
export function flattenSemanticFieldMappings(
  semanticMappings?: SemanticMappings,
): Record<string, string | undefined> {
  if (!semanticMappings) return {};
  const out: Record<string, string | undefined> = {};
  for (const k of FIELD_KEYS) {
    const v = semanticMappings[k];
    if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
  }
  return out;
}

export function validateSemanticMappings(args: {
  semanticMappings?: SemanticMappings;
  arcgisFieldNames: string[];
  essentialKeys?: SemanticMappingKey[];
}): {
  validMappings: Record<string, string>;
  invalidMappings: Array<{ key: string; field: string; reason: string }>;
  missingEssentialMappings: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const invalidMappings: Array<{ key: string; field: string; reason: string }> = [];
  const validMappings: Record<string, string> = {};
  const arcgisLc = lowerSet(args.arcgisFieldNames);

  if (!args.semanticMappings) {
    if (args.essentialKeys?.length) {
      return {
        validMappings: {},
        invalidMappings: [],
        missingEssentialMappings: [...args.essentialKeys],
        warnings: ["Aucun semanticMappings défini pour cette couche."],
      };
    }
    return { validMappings: {}, invalidMappings: [], missingEssentialMappings: [], warnings: [] };
  }

  const flat = flattenSemanticFieldMappings(args.semanticMappings);
  for (const [key, fieldRaw] of Object.entries(flat)) {
    if (typeof fieldRaw !== "string" || fieldRaw.trim() === "") continue;
    const field = fieldRaw.trim();
    const flc = field.toLowerCase();
    if (!arcgisLc.has(flc)) {
      invalidMappings.push({
        key,
        field,
        reason: "Champ absent des métadonnées ArcGIS de la couche.",
      });
      warnings.push(`Mapping métier « ${key} » → « ${field} » : champ introuvable côté ArcGIS.`);
    } else {
      const canonical = args.arcgisFieldNames.find(n => n.toLowerCase() === flc) ?? field;
      validMappings[key] = canonical;
    }
  }

  const missingEssential: string[] = [];
  for (const ek of args.essentialKeys ?? []) {
    if (ek === "geometryRequired") continue;
    const v = args.semanticMappings[ek];
    if (typeof v !== "string" || v.trim() === "") {
      missingEssential.push(ek);
      continue;
    }
    if (!arcgisLc.has(v.toLowerCase())) {
      missingEssential.push(ek);
    }
  }

  if (missingEssential.length) {
    warnings.push(`Champs métier essentiels manquants ou invalides : ${missingEssential.join(", ")}.`);
  }

  return { validMappings, invalidMappings, missingEssentialMappings: missingEssential, warnings };
}

export function resolveSemanticValue(args: {
  properties: Record<string, unknown>;
  semanticMappings?: SemanticMappings;
  key: string;
}): unknown {
  if (!args.semanticMappings) return undefined;
  const m = args.semanticMappings as Record<string, unknown>;
  const field = m[args.key];
  if (typeof field !== "string" || field.trim() === "") return undefined;
  const lower = Object.fromEntries(
    Object.entries(args.properties).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const raw = lower[field.toLowerCase()];
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  return raw;
}

function isValuePresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  return true;
}

export function getSemanticCoverage(args: {
  features: Array<{ properties?: Record<string, unknown> }>;
  semanticMappings?: SemanticMappings;
}): {
  totalFeatures: number;
  coverageByMapping: Record<
    string,
    { field: string; nonNullCount: number; nullCount: number; coverageRatio: number }
  >;
  warnings: string[];
} {
  const warnings: string[] = [];
  const totalFeatures = args.features.length;
  const coverageByMapping: Record<
    string,
    { field: string; nonNullCount: number; nullCount: number; coverageRatio: number }
  > = {};

  if (!args.semanticMappings || totalFeatures === 0) {
    return { totalFeatures, coverageByMapping, warnings };
  }

  const flat = flattenSemanticFieldMappings(args.semanticMappings);
  for (const [key, fieldRaw] of Object.entries(flat)) {
    if (typeof fieldRaw !== "string" || fieldRaw.trim() === "") continue;
    const field = fieldRaw.trim();
    let nonNull = 0;
    let nullCount = 0;
    for (const f of args.features) {
      const props = f.properties ?? {};
      const v = resolveSemanticValue({ properties: props, semanticMappings: args.semanticMappings, key });
      if (isValuePresent(v)) nonNull++;
      else nullCount++;
    }
    const coverageRatio = totalFeatures > 0 ? Math.round((nonNull / totalFeatures) * 1000) / 1000 : 0;
    coverageByMapping[key] = { field, nonNullCount: nonNull, nullCount, coverageRatio };
  }

  return { totalFeatures, coverageByMapping, warnings };
}
