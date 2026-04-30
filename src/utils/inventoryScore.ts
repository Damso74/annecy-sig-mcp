import type { RiskLevel, VisibilityMode } from "../registry.js";

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export type GeometryStatus = "present" | "missing" | "unknown";

export type SampleFallbackUsedLite = "registry_valid" | "star" | "objectid_only" | "none";

export type InventoryScoreInput = {
  visibility: VisibilityMode;
  serviceKey: string;
  riskLevel: RiskLevel;
  /** @deprecated préférer geometryStatus ; conservé pour compatibilité. */
  hasGeometryInSample: boolean;
  /** Présence réelle de géométrie sur l’échantillon exploitable ; `unknown` si échec ou vide. */
  geometryStatus?: GeometryStatus;
  /** Si false, l’échantillon n’est pas fiable pour juger nulls / lisibilité (score neutralisé partiellement). */
  sampleReliable?: boolean;
  /** 0–1 : remplissage moyen des champs « lisibles » (libellés, adresse, etc.). */
  readableFillRate: number;
  /** 0–1 : taux de null moyen sur champs métiers clés (plus haut = pire). */
  keyFieldNullRate: number;
  /** 0–1 : présence / cohérence de dates ou horaires dans l’échantillon. */
  dateFreshnessProxy: number;
  /** V0.6 — capacité Query ArcGIS. */
  supportsQuery?: boolean;
  /** V0.6 — ratio champs registre absents / champs demandés (0–1). */
  missingRegistryFieldRatio?: number;
  /** V0.6 — chaîne de fallback d’échantillon. */
  sampleFallbackUsed?: SampleFallbackUsedLite;
};

/**
 * Score technique 0–100 : fiabilité de l’accès aux données (Query, échantillon, géométrie, alignement registre).
 */
export function computeTechnicalScore(input: InventoryScoreInput): number {
  const sampleReliable = input.sampleReliable !== false;
  const geom: GeometryStatus =
    input.geometryStatus ??
    (input.hasGeometryInSample ? "present" : sampleReliable ? "missing" : "unknown");

  let s = 0;
  if (input.supportsQuery === false) s += 10;
  else s += 25;

  if (!sampleReliable) s += 15;
  else if (geom === "present") s += 35;
  else if (geom === "missing") s += 18;
  else s += 22;

  const fb = input.sampleFallbackUsed ?? "none";
  if (sampleReliable) {
    if (fb === "registry_valid") s += 20;
    else if (fb === "star") s += 12;
    else if (fb === "objectid_only") s += 8;
    else s += 5;
  } else {
    s += 5;
  }

  const miss = clamp01(input.missingRegistryFieldRatio ?? 0);
  s += 20 * (1 - miss);

  return Math.round(Math.min(100, Math.max(0, s)));
}

/**
 * Score qualité data 0–100 : contenu attributaire sur un échantillon fiable.
 * Si l’échantillon n’est pas fiable, score neutre-bas (ne pas conclure « mauvaises données »).
 */
export function computeDataQualityScore(input: InventoryScoreInput): number {
  const sampleReliable = input.sampleReliable !== false;
  if (!sampleReliable) return 38;

  const readable = 40 * clamp01(input.readableFillRate);
  const lowNull = 35 * clamp01(1 - input.keyFieldNullRate);
  const freshness = 15 * clamp01(input.dateFreshnessProxy);
  let risk = 10;
  if (input.riskLevel === "orange") risk = 6;
  if (input.riskLevel === "red") risk = 2;

  return Math.round(Math.min(100, readable + lowNull + freshness + risk));
}

/**
 * Score préliminaire 0–100 (inventaire / open data) — **inchangé V0.5** pour compatibilité (`preliminaryQualityScore`).
 * V0.6 ajoute `technicalScore` et `dataQualityScore`.
 */
export function computePreliminaryQualityScore(input: InventoryScoreInput): {
  score: number;
  technicalScore: number;
  dataQualityScore: number;
  breakdown: Record<string, number>;
} {
  let citizenPilot = 0;
  if (input.visibility === "public") citizenPilot = 20;
  else if (input.serviceKey === "travaux") citizenPilot = 15;
  else citizenPilot = 8;

  const sampleReliable = input.sampleReliable !== false;
  const geomStatus: GeometryStatus =
    input.geometryStatus ??
    (input.hasGeometryInSample ? "present" : sampleReliable ? "missing" : "unknown");

  let geometry: number;
  if (!sampleReliable) {
    geometry = 10;
  } else if (geomStatus === "present") {
    geometry = 20;
  } else if (geomStatus === "missing") {
    geometry = 0;
  } else {
    geometry = 10;
  }

  const readable = sampleReliable ? 20 * clamp01(input.readableFillRate) : 10;
  const lowNull = sampleReliable ? 15 * clamp01(1 - input.keyFieldNullRate) : 7.5;
  const risk = input.riskLevel === "green" ? 15 : input.riskLevel === "orange" ? 8 : 0;
  const freshness = sampleReliable ? 10 * clamp01(input.dateFreshnessProxy) : 5;

  const raw = citizenPilot + geometry + readable + lowNull + risk + freshness;
  const score = Math.round(Math.min(100, raw));
  const technicalScore = computeTechnicalScore(input);
  const dataQualityScore = computeDataQualityScore(input);
  return {
    score,
    technicalScore,
    dataQualityScore,
    breakdown: {
      citizenPilot,
      geometry,
      readable,
      lowNullOnKeys: lowNull,
      lowRisk: risk,
      freshness,
    },
  };
}
