import { z } from "zod";
import { AppError } from "./errors.js";
import type { AppConfig } from "../config.js";
import { getLayerEntry, isServiceKeyAllowed, listLayerEntriesForService } from "../registry.js";

export const modeSchema = z.enum(["public", "internal"]);

const DANGEROUS_WHERE = /(;|\bDROP\b|\bDELETE\b|\bUPDATE\b|\bINSERT\b|\bALTER\b|\btoken\b|\bpassword\b)/i;

export function assertSafeWhere(where: string): void {
  if (where.length > 500) {
    throw new AppError("VALIDATION_ERROR", "Clause WHERE trop longue (max 500 caractères).", {
      hint: "Réduire le filtre ou découper la requête.",
    });
  }
  if (DANGEROUS_WHERE.test(where)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Clause WHERE refusée : motif ou mot-clé non autorisé.",
      { details: { pattern: "interdit" }, hint: "Éviter ; DROP DELETE UPDATE INSERT ALTER token password." },
    );
  }
}

export function parseLimit(raw: unknown, fallback: number, maxResultLimit: number): number {
  const n = raw === undefined || raw === null ? fallback : Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new AppError("VALIDATION_ERROR", "limit doit être un entier ≥ 1.", {});
  }
  if (n > maxResultLimit) {
    throw new AppError(
      "VALIDATION_ERROR",
      `limit ne peut pas dépasser MAX_RESULT_LIMIT (${maxResultLimit}).`,
      { hint: "Utiliser l'outil de comptage côté ArcGIS (count) ou réduire la pagination." },
    );
  }
  return Math.floor(n);
}

export function parseOffset(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError("VALIDATION_ERROR", "offset doit être un entier ≥ 0.", {});
  }
  return Math.floor(n);
}

export function validateServiceLayer(
  serviceKey: string,
  layerId: number,
  mode: "public" | "internal",
): void {
  if (!isServiceKeyAllowed(serviceKey)) {
    throw new AppError("NOT_FOUND", `Service inconnu ou non autorisé : "${serviceKey}".`, {
      details: { serviceKey },
      hint: "Utiliser list_services pour les clés autorisées.",
    });
  }
  const entry = getLayerEntry(serviceKey, layerId);
  if (!entry) {
    const allowed = listLayerEntriesForService(serviceKey).map(e => e.layerId);
    throw new AppError("NOT_FOUND", `Couche ${layerId} non autorisée pour le service "${serviceKey}".`, {
      details: { serviceKey, layerId, allowedLayerIds: allowed },
    });
  }
  if (mode === "public" && entry.visibility === "internal") {
    throw new AppError(
      "FORBIDDEN",
      `La couche "${entry.layerName}" est réservée au mode internal.`,
      {
        details: { serviceKey, layerId },
        hint: "Passer mode=internal (données internes non destinées au grand public).",
      },
    );
  }
}

export function parseLatLon(lat: unknown, lon: unknown): { lat: number; lon: number } {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || la < -90 || la > 90) {
    throw new AppError("VALIDATION_ERROR", "lat invalide (attendu entre -90 et 90).", {});
  }
  if (!Number.isFinite(lo) || lo < -180 || lo > 180) {
    throw new AppError("VALIDATION_ERROR", "lon invalide (attendu entre -180 et 180).", {});
  }
  return { lat: la, lon: lo };
}

export function parseRadiusMeters(raw: unknown, fallback = 500, maxMeters = 5000): number {
  const n = raw === undefined || raw === null ? fallback : Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > maxMeters) {
    throw new AppError(
      "VALIDATION_ERROR",
      `radiusMeters doit être entre 1 et ${maxMeters} (plafond MAX_SEARCH_RADIUS_METERS).`,
      {},
    );
  }
  return n;
}

/** Parallélisation inventaire / rapports : défaut 3, plage 1–6. */
export function clampInventoryConcurrency(raw: unknown): number {
  const n = raw === undefined || raw === null ? 3 : Number(raw);
  if (!Number.isFinite(n)) {
    throw new AppError("VALIDATION_ERROR", "concurrency doit être un entier entre 1 et 6.", {});
  }
  const i = Math.floor(n);
  if (i < 1 || i > 6) {
    throw new AppError("VALIDATION_ERROR", "concurrency doit être entre 1 et 6.", {});
  }
  return i;
}

export function validateOutFields(
  outFields: string[] | undefined,
  allowed: Set<string>,
): string[] | undefined {
  if (!outFields || outFields.length === 0) return undefined;
  const mapLc = new Map<string, string>();
  for (const a of allowed) mapLc.set(a.toLowerCase(), a);
  const resolved: string[] = [];
  const bad: string[] = [];
  for (const f of outFields) {
    const canon = mapLc.get(f.toLowerCase());
    if (canon) resolved.push(canon);
    else bad.push(f);
  }
  if (bad.length) {
    throw new AppError("VALIDATION_ERROR", "outFields contient des champs non autorisés pour ce mode.", {
      details: { rejected: bad },
    });
  }
  return resolved;
}

export function clampSampleLimit(raw: unknown, fallback: number, max: number): number {
  return parseLimit(raw === undefined ? fallback : raw, fallback, max);
}

export function getEffectiveFields(
  entry: { publicFields: string[]; internalFields: string[] },
  mode: "public" | "internal",
): Set<string> {
  if (mode === "internal") {
    return new Set([...entry.publicFields, ...entry.internalFields]);
  }
  return new Set(entry.publicFields);
}

/** Vérifie la config max >= default (appel au démarrage). */
export function assertConfigLimits(cfg: AppConfig): void {
  if (cfg.defaultResultLimit > cfg.maxResultLimit) {
    throw new Error("DEFAULT_RESULT_LIMIT ne peut pas dépasser MAX_RESULT_LIMIT.");
  }
}
