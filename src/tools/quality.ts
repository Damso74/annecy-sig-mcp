import type { AppConfig } from "../config.js";
import { getLayerEntry } from "../registry.js";
import type { VisibilityMode } from "../registry.js";
import { getSampleFeatures } from "../arcgis/client.js";
import { clampSampleLimit, getEffectiveFields, validateServiceLayer } from "../utils/validation.js";
import { lowerPropertyKeys } from "../utils/properties.js";
import { buildWorkQualityFlags } from "./queryLayer.js";
import { geometryIsNullOrEmpty } from "../utils/geometry.js";
import { timestampMsToIsoString } from "../utils/dates.js";

const KNOWN_TRAVAUX_STATUSES = new Set([
  "en cours",
  "terminé",
  "termine",
  "planifié",
  "planifie",
  "en cours hors délai",
  "suspendu",
  "annulé",
  "annule",
]);

function duplicateCandidates(rows: Record<string, unknown>[], key: string): number {
  const seen = new Map<string, number>();
  for (const r of rows) {
    const v = String(r[key] ?? "").trim().toLowerCase();
    if (!v) continue;
    seen.set(v, (seen.get(v) ?? 0) + 1);
  }
  let d = 0;
  for (const c of seen.values()) if (c > 1) d += c - 1;
  return d;
}

export async function runDetectDataQualityIssues(
  cfg: AppConfig,
  input: { serviceKey: string; layerId: number; sampleLimit?: number; mode: VisibilityMode },
) {
  validateServiceLayer(input.serviceKey, input.layerId, input.mode);
  const entry = getLayerEntry(input.serviceKey, input.layerId)!;
  const sampleLimit = clampSampleLimit(input.sampleLimit ?? 500, 500, cfg.maxResultLimit);
  const fields = [...getEffectiveFields(entry, input.mode)].join(",");

  const parsed = await getSampleFeatures(cfg, entry.servicePath, input.layerId, sampleLimit, fields);
  const rows = parsed.features.map(f => lowerPropertyKeys(f.properties));

  const nullCounts: Record<string, number> = {};
  const fieldKeys = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) fieldKeys.add(k);
  }
  for (const k of fieldKeys) nullCounts[k] = 0;
  for (const r of rows) {
    for (const k of fieldKeys) {
      const v = r[k];
      if (v === null || v === undefined || v === "") nullCounts[k]++;
    }
  }
  const nullRateByField: Record<string, number> = {};
  for (const [k, c] of Object.entries(nullCounts)) {
    nullRateByField[k] = rows.length ? c / rows.length : 0;
  }

  let missingGeometryCount = 0;
  let missingAddressCount = 0;
  let missingTitleCount = 0;
  let suspiciousDateCount = 0;
  const suspiciousValues: string[] = [];

  const addrKey = [...fieldKeys].find(k => k.includes("adresse"));
  const titleKey = [...fieldKeys].find(k => k === "titre" || k === "denomination");

  for (const f of parsed.features) {
    if (geometryIsNullOrEmpty(f.geometry)) missingGeometryCount++;
    const r = lowerPropertyKeys(f.properties);
    if (addrKey && (!r[addrKey] || String(r[addrKey]).trim() === "")) missingAddressCount++;
    if (titleKey && (!r[titleKey] || String(r[titleKey]).trim() === "")) missingTitleCount++;

    const d1 = timestampMsToIsoString(r.ac_date_debut);
    const d2 = timestampMsToIsoString(r.ac_date_fin);
    if (d1.warning || d2.warning) suspiciousDateCount++;
    const nd = Number(r.ac_date_debut);
    const nf = Number(r.ac_date_fin);
    if (Number.isFinite(nd) && Number.isFinite(nf) && nf < nd) suspiciousDateCount++;
  }

  for (const r of rows) {
    const num = String(r.ac_num ?? "").trim();
    if (num === "" && entry.serviceKey === "travaux") suspiciousValues.push("ac_num vide");
    const s = JSON.stringify(r).toUpperCase();
    if (s.includes("PERMANEENT") || s.includes("PERMANENET")) suspiciousValues.push("Orthographe suspecte PERMANEENT");
  }

  let unknownStatusCount = 0;
  if (entry.serviceKey === "travaux") {
    for (const r of rows) {
      const st = String(r.controle_resultat ?? "")
        .trim()
        .toLowerCase();
      if (st && !KNOWN_TRAVAUX_STATUSES.has(st)) unknownStatusCount++;
    }
  }

  const dupKey = fieldKeys.has("ac_num") ? "ac_num" : "objectid";
  const duplicateCandidateCount = fieldKeys.has(dupKey)
    ? duplicateCandidates(rows as Record<string, unknown>[], dupKey)
    : 0;

  const recommendations: string[] = [];
  for (const [k, rate] of Object.entries(nullRateByField)) {
    if (rate > 0.5 && k !== "description") {
      recommendations.push(
        `Champ "${k}" souvent vide (${(rate * 100).toFixed(0)} %) : prévoir valeur par défaut ou masquage UI.`,
      );
    }
  }
  if (missingGeometryCount > rows.length * 0.2) {
    recommendations.push(
      "Géométrie manquante fréquente : vérifier la saisie terrain ou la généralisation côté publication.",
    );
  }
  if (unknownStatusCount > 0) {
    recommendations.push(
      "Statuts travaux hors liste connue : harmoniser la nomenclature ou étendre le référentiel.",
    );
  }

  return {
    serviceKey: input.serviceKey,
    layerId: input.layerId,
    mode: input.mode,
    totalSampled: rows.length,
    nullRateByField,
    missingGeometryCount,
    missingAddressCount: addrKey ? missingAddressCount : null,
    missingTitleCount: titleKey ? missingTitleCount : null,
    suspiciousDateCount,
    duplicateCandidateCount,
    suspiciousValues: [...new Set(suspiciousValues)].slice(0, 50),
    unknownStatusCount: entry.serviceKey === "travaux" ? unknownStatusCount : null,
    qualityFlagsSample: rows.slice(0, 3).map((r, i) => buildWorkQualityFlags(r, parsed.features[i]?.geometry)),
    recommendations,
    source: { type: "annecy_sig_mcp_quality", path: `${entry.servicePath}/${entry.layerId}` },
  };
}

export function detectGeometryNullInSample(
  features: { geometry: unknown }[],
): { missingGeometryCount: number } {
  let missingGeometryCount = 0;
  for (const f of features) {
    if (geometryIsNullOrEmpty(f.geometry)) missingGeometryCount++;
  }
  return { missingGeometryCount };
}
