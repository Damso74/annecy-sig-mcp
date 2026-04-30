import { geometryIsNullOrEmpty } from "../utils/geometry.js";
import type { GeometryStatus } from "../utils/inventoryScore.js";
import type { SampleStatus } from "./types.js";

export function deriveGeometryStatus(
  sampleStatus: SampleStatus,
  features: { geometry: unknown }[],
): GeometryStatus {
  if (sampleStatus === "failed") return "unknown";
  if (sampleStatus === "empty") return "unknown";
  if (!features.length) return "unknown";
  const anyGeom = features.some(f => !geometryIsNullOrEmpty(f.geometry));
  return anyGeom ? "present" : "missing";
}

export function fillRate(rows: Record<string, unknown>[], keys: string[]): number {
  if (!rows.length || !keys.length) return 0;
  let sum = 0;
  for (const r of rows) {
    let ok = 0;
    for (const k of keys) {
      const v = r[k];
      if (v !== null && v !== undefined && String(v).trim() !== "") ok++;
    }
    sum += ok / keys.length;
  }
  return sum / rows.length;
}

export function nullRateOnKeys(rows: Record<string, unknown>[], keys: string[]): number {
  if (!rows.length || !keys.length) return 0;
  let total = 0;
  for (const k of keys) {
    let nulls = 0;
    for (const r of rows) {
      const v = r[k];
      if (v === null || v === undefined || String(v).trim() === "") nulls++;
    }
    total += nulls / rows.length;
  }
  return total / keys.length;
}

export function nullRateSummary(
  rows: Record<string, unknown>[],
  fieldKeys: string[],
): Record<string, number> {
  if (!rows.length) return {};
  const out: Record<string, number> = {};
  for (const k of fieldKeys) {
    let nulls = 0;
    for (const r of rows) {
      const v = r[k];
      if (v === null || v === undefined || String(v).trim() === "") nulls++;
    }
    const rate = nulls / rows.length;
    if (rate > 0) out[k] = Math.round(rate * 1000) / 1000;
  }
  return out;
}

export function dateFreshnessProxy(
  rows: Record<string, unknown>[],
  dateKeys: string[],
): number {
  return fillRate(rows, dateKeys);
}
