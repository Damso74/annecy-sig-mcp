import type { AppConfig } from "../config.js";
import { getLayerEntry } from "../registry.js";
import { getLayerMetadata, queryLayerRequest } from "../arcgis/client.js";
import { resolveArcgisOutFields } from "../utils/arcgisFieldValidation.js";
import { withToolTracing } from "../runtime/logger.js";
import { AppError } from "../utils/errors.js";
import { assertSafeWhere, parseLimit, validateServiceLayer } from "../utils/validation.js";
import { geometryIsNullOrEmpty } from "../utils/geometry.js";
import { normalizeTravauxFeature } from "./queryLayer.js";

const TRAVAUX_SERVICE = "travaux";
const TRAVAUX_LAYER = 3;

function isoDateOrToday(raw?: string): string {
  if (!raw || !raw.trim()) {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const p = Date.parse(t);
  if (!Number.isFinite(p)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Date invalide : fournir une date ISO (YYYY-MM-DD ou chaîne ISO 8601).",
      {},
    );
  }
  return new Date(p).toISOString().slice(0, 10);
}

function whereActiveOnDate(isoDay: string): string {
  return `ac_date_debut <= date '${isoDay}' AND ac_date_fin >= date '${isoDay}'`;
}

function aggregateStats(rows: Record<string, unknown>[]) {
  const byStatus: Record<string, number> = {};
  let withoutGeometry = 0;
  let withoutAddress = 0;
  let withoutTitle = 0;
  for (const r of rows) {
    const g = r.geometry;
    if (g === null || g === undefined || geometryIsNullOrEmpty(g)) withoutGeometry++;
    if (!r.adresse || String(r.adresse).trim() === "") withoutAddress++;
    if (!r.titre || String(r.titre).trim() === "") withoutTitle++;
    const s = String(r.statut_interne ?? "INCONNU");
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  return {
    totalReturned: rows.length,
    withoutGeometry,
    withoutAddress,
    withoutTitle,
    byStatus,
  };
}

export async function runListCurrentWorks(
  cfg: AppConfig,
  input: { date?: string; includeGeometry?: boolean; limit?: number },
) {
  return withToolTracing("list_current_works", { mode: "internal" }, () =>
    runListCurrentWorksInner(cfg, input),
  );
}

async function runListCurrentWorksInner(
  cfg: AppConfig,
  input: { date?: string; includeGeometry?: boolean; limit?: number },
) {
  const mode = "internal" as const;
  validateServiceLayer(TRAVAUX_SERVICE, TRAVAUX_LAYER, mode);
  const entry = getLayerEntry(TRAVAUX_SERVICE, TRAVAUX_LAYER)!;
  const isoDay = isoDateOrToday(input.date);
  const where = whereActiveOnDate(isoDay);
  assertSafeWhere(where);
  const limit = parseLimit(input.limit ?? cfg.defaultResultLimit, cfg.defaultResultLimit, cfg.maxResultLimit);
  const returnGeometry = input.includeGeometry !== false;

  const requestedFields = [...new Set([...entry.publicFields, ...entry.internalFields])];
  const meta = await getLayerMetadata(TRAVAUX_SERVICE, cfg, entry.servicePath, TRAVAUX_LAYER);
  const { arcgisFieldNames, missingRegistryFields } = resolveArcgisOutFields(requestedFields, meta);
  const outFields =
    arcgisFieldNames.length > 0 ? arcgisFieldNames.join(",") : requestedFields.join(",") || "*";

  const parsed = await queryLayerRequest(
    {
      serviceKey: TRAVAUX_SERVICE,
      layerId: TRAVAUX_LAYER,
      servicePath: entry.servicePath,
      where,
      outFields,
      returnGeometry,
      outSR: 4326,
      limit,
    },
    cfg,
  );

  const warnings = new Set<string>();
  if (missingRegistryFields.length) {
    const sample = missingRegistryFields.slice(0, 12).join(", ");
    const more = missingRegistryFields.length > 12 ? "…" : "";
    warnings.add(
      `Champs registre absents sur la couche ArcGIS (non inclus dans outFields) : ${sample}${more}`,
    );
  }
  if (parsed.formatUsed === "json") warnings.add("Réponse Esri JSON (pas GeoJSON).");
  const rows = parsed.features.map(f => normalizeTravauxFeature(f.properties, f.geometry, true));

  return {
    date: isoDay,
    travaux: rows,
    warnings: [...warnings],
    stats: aggregateStats(rows),
    source: { type: "annecy_sig_mcp_travaux", filter: where },
  };
}

export async function runListLateWorks(
  cfg: AppConfig,
  input: { limit?: number; includeGeometry?: boolean },
) {
  return withToolTracing("list_late_works", { mode: "internal" }, () =>
    runListLateWorksInner(cfg, input),
  );
}

async function runListLateWorksInner(
  cfg: AppConfig,
  input: { limit?: number; includeGeometry?: boolean },
) {
  const mode = "internal" as const;
  validateServiceLayer(TRAVAUX_SERVICE, TRAVAUX_LAYER, mode);
  const entry = getLayerEntry(TRAVAUX_SERVICE, TRAVAUX_LAYER)!;
  const where = `controle_resultat = 'En cours hors délai'`;
  assertSafeWhere(where);
  const limit = parseLimit(input.limit ?? cfg.defaultResultLimit, cfg.defaultResultLimit, cfg.maxResultLimit);
  const returnGeometry = input.includeGeometry !== false;

  const requestedFields = [...new Set([...entry.publicFields, ...entry.internalFields])];
  const meta = await getLayerMetadata(TRAVAUX_SERVICE, cfg, entry.servicePath, TRAVAUX_LAYER);
  const { arcgisFieldNames, missingRegistryFields } = resolveArcgisOutFields(requestedFields, meta);
  const outFields =
    arcgisFieldNames.length > 0 ? arcgisFieldNames.join(",") : requestedFields.join(",") || "*";

  const parsed = await queryLayerRequest(
    {
      serviceKey: TRAVAUX_SERVICE,
      layerId: TRAVAUX_LAYER,
      servicePath: entry.servicePath,
      where,
      outFields,
      returnGeometry,
      outSR: 4326,
      limit,
    },
    cfg,
  );

  const warnings: string[] = [];
  if (missingRegistryFields.length) {
    const sample = missingRegistryFields.slice(0, 12).join(", ");
    const more = missingRegistryFields.length > 12 ? "…" : "";
    warnings.push(
      `Champs registre absents sur la couche ArcGIS (non inclus dans outFields) : ${sample}${more}`,
    );
  }
  const rows = parsed.features.map(f => normalizeTravauxFeature(f.properties, f.geometry, true));

  return {
    travaux: rows,
    warnings,
    stats: aggregateStats(rows),
    source: { type: "annecy_sig_mcp_travaux", filter: where },
  };
}
