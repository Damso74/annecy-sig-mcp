import type { LayerRegistryEntry } from "../registry.js";
import { getSemanticEssentialKeys } from "../registry.js";
import type { RegistryArcgisFieldValidation } from "./arcgisFieldValidation.js";
import type { GeometryStatus } from "./inventoryScore.js";
import type { SemanticMappingKey } from "./semanticMappings.js";

export type UsageStatus =
  | "ready"
  | "usable_now"
  | "usable_with_caution"
  | "needs_field_mapping"
  | "needs_data_cleaning"
  | "to_investigate_technically"
  | "internal_only"
  | "not_usable";

export type SampleStatusLite = "ok" | "empty" | "failed";

export type SemanticValidationLite = {
  validMappings: Record<string, string>;
  invalidMappings: Array<{ key: string; field: string; reason: string }>;
  missingEssentialMappings: string[];
  warnings: string[];
};

export type SemanticCoverageLite = {
  totalFeatures: number;
  coverageByMapping: Record<
    string,
    { field: string; nonNullCount: number; nullCount: number; coverageRatio: number }
  >;
  warnings: string[];
};

export { getSemanticEssentialKeys };

function geometryRequired(entry: LayerRegistryEntry): boolean {
  return entry.semanticMappings?.geometryRequired === true;
}

function minCoverageForKey(
  cov: SemanticCoverageLite,
  mappingKey: string,
): number | null {
  const row = cov.coverageByMapping[mappingKey];
  if (!row) return null;
  return row.coverageRatio;
}

export function deriveUsageStatus(args: {
  entry: LayerRegistryEntry;
  sampleStatus: SampleStatusLite;
  geometryStatus: GeometryStatus;
  fieldValidation: RegistryArcgisFieldValidation;
  semanticValidation: SemanticValidationLite;
  semanticCoverage: SemanticCoverageLite;
  preliminaryQualityScore: number;
  warnings: string[];
}): { usageStatus: UsageStatus; usageWarnings: string[] } {
  const usageWarnings = [...args.semanticValidation.warnings, ...args.semanticCoverage.warnings];
  const { entry } = args;

  if (entry.visibility === "internal") {
    return { usageStatus: "internal_only", usageWarnings };
  }

  if (
    args.sampleStatus === "failed" ||
    args.sampleStatus === "empty" ||
    !args.fieldValidation.supportsQuery
  ) {
    return { usageStatus: "to_investigate_technically", usageWarnings };
  }

  const essential = getSemanticEssentialKeys(entry);
  const sem = args.semanticValidation;
  if (essential.length > 0) {
    if (sem.missingEssentialMappings.length > 0) {
      return { usageStatus: "needs_field_mapping", usageWarnings };
    }
    const invalidEssential = sem.invalidMappings.some(im => essential.includes(im.key as SemanticMappingKey));
    if (invalidEssential) {
      return { usageStatus: "needs_field_mapping", usageWarnings };
    }
  }

  const geomReq = geometryRequired(entry);
  if (geomReq && args.geometryStatus === "missing") {
    usageWarnings.push("Géométrie requise pour l’usage métier mais absente sur l’échantillon.");
    return { usageStatus: "needs_data_cleaning", usageWarnings };
  }

  if (entry.riskLevel === "red") {
    return { usageStatus: "not_usable", usageWarnings };
  }

  const labelCov = minCoverageForKey(args.semanticCoverage, "labelField");
  const idCov = minCoverageForKey(args.semanticCoverage, "identifierField");
  const addrCov = minCoverageForKey(args.semanticCoverage, "addressField");
  const catCov = minCoverageForKey(args.semanticCoverage, "categoryField");

  const hasLabelSignal =
    labelCov !== null ? labelCov >= 0.45 : idCov !== null ? idCov >= 0.45 : essential.length === 0;
  const addrWeak = essential.includes("addressField") && (addrCov === null || addrCov < 0.35);
  const catWeak = essential.includes("categoryField") && (catCov === null || catCov < 0.35);

  if (essential.length > 0 && !hasLabelSignal) {
    usageWarnings.push("Libellé ou identifiant souvent absent sur l’échantillon (couverture sémantique faible).");
    return { usageStatus: "needs_data_cleaning", usageWarnings };
  }

  if (addrWeak) {
    usageWarnings.push("Adresse souvent absente alors qu’elle est attendue pour cet usage.");
    return { usageStatus: "needs_data_cleaning", usageWarnings };
  }

  if (catWeak) {
    usageWarnings.push("Catégorie souvent absente alors qu’elle est attendue pour cet usage.");
    return { usageStatus: "needs_data_cleaning", usageWarnings };
  }

  const score = args.preliminaryQualityScore;
  const schedCov = minCoverageForKey(args.semanticCoverage, "scheduleField");
  const openCov = minCoverageForKey(args.semanticCoverage, "openingField");
  const secondaryGap =
    (schedCov !== null && schedCov < 0.25) || (openCov !== null && openCov < 0.25);

  if (score >= 78 && args.geometryStatus === "present" && !secondaryGap && entry.riskLevel === "green") {
    return { usageStatus: "ready", usageWarnings };
  }
  if (score >= 68 && args.geometryStatus === "present") {
    return { usageStatus: "usable_now", usageWarnings };
  }
  if (score >= 52 && args.geometryStatus !== "missing") {
    return { usageStatus: "usable_with_caution", usageWarnings };
  }

  if (args.geometryStatus === "missing" && !geomReq) {
    return { usageStatus: "usable_with_caution", usageWarnings };
  }

  return { usageStatus: "not_usable", usageWarnings };
}
