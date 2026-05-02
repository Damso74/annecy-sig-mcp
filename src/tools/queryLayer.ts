import type { AppConfig } from "../config.js";
import { getLayerEntry } from "../registry.js";
import type { LayerRegistryEntry, VisibilityMode } from "../registry.js";
import { queryLayerRequest } from "../arcgis/client.js";
import { timestampMsToIsoString } from "../utils/dates.js";
import { geometryIsNullOrEmpty, representativeLatLon } from "../utils/geometry.js";
import { haversineMeters } from "../utils/distance.js";
import {
  assertSafeWhere,
  getEffectiveFields,
  parseLimit,
  parseOffset,
  validateOutFields,
  validateServiceLayer,
} from "../utils/validation.js";
import { sanitizePublicProperties, stripDangerousKeys } from "../utils/sanitize.js";
import { lowerPropertyKeys } from "../utils/properties.js";
import { getLayerMetadata } from "../arcgis/client.js";
import { resolveArcgisOutFields } from "../utils/arcgisFieldValidation.js";
import { withToolTracing } from "../runtime/logger.js";

function pickId(props: Record<string, unknown>): number | string | null {
  const v = props.objectid ?? props.OBJECTID;
  if (typeof v === "number" || typeof v === "string") return v;
  return null;
}

function cleanProps(
  props: Record<string, unknown>,
  entry: LayerRegistryEntry,
  mode: VisibilityMode,
): Record<string, unknown> {
  const lower = lowerPropertyKeys(props);
  const allowed = getEffectiveFields(entry, mode);
  const allowedLc = new Set([...allowed].map(s => s.toLowerCase()));
  const aligned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(lower)) {
    if (allowedLc.has(k)) aligned[k] = v;
  }
  if (mode === "public") {
    return sanitizePublicProperties(aligned, allowedLc);
  }
  return stripDangerousKeys(aligned);
}

export function normalizeEquipementFeatureStable(
  props: Record<string, unknown>,
  mode: VisibilityMode,
  layerName: string,
  geometry: unknown,
  entry: LayerRegistryEntry,
): Record<string, unknown> {
  const p = lowerPropertyKeys(props);
  const id = pickId(p);
  const name =
    (p.denomination as string) ||
    (p.nom as string) ||
    (p.titre as string) ||
    (id !== null ? `${layerName} #${id}` : layerName);
  const raw = cleanProps(props, entry, mode);
  const base: Record<string, unknown> = {
    id,
    name,
    address: p.adresse ?? null,
    commune: p.commune ?? null,
    category: p.categorie ?? null,
    subCategory: p.sous_categorie ?? null,
    open: p.ouvert ?? null,
    pmr: p.pmr ?? null,
    hours: p.horaire ?? p.horaires ?? null,
    phone: p.telephone ?? null,
    accessibility: p.accessibilite ?? null,
    geometry,
  };
  if (mode === "internal") {
    base.rawPropertiesInternal = raw;
  }
  return base;
}

export function normalizeMobiliteFeature(
  props: Record<string, unknown>,
  geometry: unknown,
): Record<string, unknown> {
  const p = lowerPropertyKeys(props);
  const id = pickId(p);
  const name =
    (p.denomination as string) ||
    (p.nom as string) ||
    (p.titre as string) ||
    (p.site as string) ||
    (id !== null ? `Mobilité #${id}` : "Mobilité");
  return {
    id,
    name,
    address: p.adresse ?? null,
    category: p.categorie ?? null,
    subCategory: p.sous_categorie ?? null,
    description: p.description ?? null,
    geometry,
  };
}

export type WorkQualityFlags = {
  missingGeometry?: boolean;
  missingAddress?: boolean;
  missingTitle?: boolean;
  invalidDateOrder?: boolean;
  emptyNumeroArrete?: boolean;
  suspiciousSpelling?: boolean;
};

export function buildWorkQualityFlags(row: Record<string, unknown>, geometry?: unknown): WorkQualityFlags {
  const p = lowerPropertyKeys(row);
  const flags: WorkQualityFlags = {};
  if (geometryIsNullOrEmpty(geometry)) flags.missingGeometry = true;
  if (!p.adresse || String(p.adresse).trim() === "") flags.missingAddress = true;
  if (!p.titre || String(p.titre).trim() === "") flags.missingTitle = true;
  const nd = Number(p.ac_date_debut);
  const nf = Number(p.ac_date_fin);
  if (Number.isFinite(nd) && Number.isFinite(nf) && nf < nd) flags.invalidDateOrder = true;
  if (!p.ac_num || String(p.ac_num).trim() === "") flags.emptyNumeroArrete = true;
  const t = JSON.stringify(p).toUpperCase();
  if (t.includes("PERMANEENT") || t.includes("PERMANENET")) flags.suspiciousSpelling = true;
  return flags;
}

export function normalizeTravauxFeature(
  props: Record<string, unknown>,
  geometry: unknown,
  includeAttachmentUrl: boolean,
): Record<string, unknown> {
  const p = lowerPropertyKeys(props);
  const d1 = timestampMsToIsoString(p.ac_date_debut);
  const d2 = timestampMsToIsoString(p.ac_date_fin);
  const flags = buildWorkQualityFlags(p, geometry);
  const out: Record<string, unknown> = {
    id: pickId(p),
    numero_arrete: p.ac_num ?? null,
    date_debut_iso: d1.value,
    date_fin_iso: d2.value,
    statut_interne: p.controle_resultat ?? null,
    titre: p.titre ?? null,
    adresse: p.adresse ?? null,
    commune_deleguee: p.commune_deleguee ?? null,
    description: p.description ?? null,
    geometry,
    qualityFlags: flags,
  };
  const w: string[] = [];
  if (d1.warning) w.push(d1.warning);
  if (d2.warning) w.push(d2.warning);
  if (w.length) out.dateWarnings = w;
  if (includeAttachmentUrl) {
    out.url_piece_jointe = p.url_pj ?? null;
  }
  return out;
}

function shapeFeature(
  entry: LayerRegistryEntry,
  mode: VisibilityMode,
  props: Record<string, unknown>,
  geometry: unknown,
): Record<string, unknown> {
  if (entry.serviceKey === "equipements") {
    return normalizeEquipementFeatureStable(props, mode, entry.layerName, geometry, entry);
  }
  if (entry.serviceKey === "mobilite") {
    return normalizeMobiliteFeature(props, geometry);
  }
  if (entry.serviceKey === "travaux") {
    return normalizeTravauxFeature(props, geometry, mode === "internal");
  }
  return { ...cleanProps(props, entry, mode), geometry };
}

export async function runQueryLayer(
  cfg: AppConfig,
  input: {
    serviceKey: string;
    layerId: number;
    where?: string;
    outFields?: string[];
    limit?: number;
    offset?: number;
    returnGeometry?: boolean;
    mode: VisibilityMode;
  },
) {
  return withToolTracing(
    "query_layer",
    { serviceKey: input.serviceKey, layerId: input.layerId, mode: input.mode },
    () => runQueryLayerInner(cfg, input),
  );
}

async function runQueryLayerInner(
  cfg: AppConfig,
  input: {
    serviceKey: string;
    layerId: number;
    where?: string;
    outFields?: string[];
    limit?: number;
    offset?: number;
    returnGeometry?: boolean;
    mode: VisibilityMode;
  },
) {
  const where = (input.where ?? "1=1").trim();
  assertSafeWhere(where);
  validateServiceLayer(input.serviceKey, input.layerId, input.mode);
  const entry = getLayerEntry(input.serviceKey, input.layerId)!;
  const limit = parseLimit(input.limit ?? cfg.defaultResultLimit, cfg.defaultResultLimit, cfg.maxResultLimit);
  const offset = parseOffset(input.offset);
  const returnGeometry = input.returnGeometry !== false;
  const allowed = getEffectiveFields(entry, input.mode);
  const outFieldsList = validateOutFields(input.outFields, allowed);
  const requestedList = outFieldsList?.length ? outFieldsList : [...allowed];

  const warnings: string[] = [];
  const meta = await getLayerMetadata(input.serviceKey, cfg, entry.servicePath, input.layerId);
  const { arcgisFieldNames, missingRegistryFields } = resolveArcgisOutFields(requestedList, meta);
  if (missingRegistryFields.length) {
    const sample = missingRegistryFields.slice(0, 12).join(", ");
    const more = missingRegistryFields.length > 12 ? "…" : "";
    warnings.push(
      `Champs du registre absents sur la couche ArcGIS (non inclus dans outFields) : ${sample}${more}`,
    );
  }
  const outFields = arcgisFieldNames.join(",");

  const parsed = await queryLayerRequest(
    {
      serviceKey: input.serviceKey,
      layerId: input.layerId,
      servicePath: entry.servicePath,
      where,
      outFields,
      returnGeometry,
      outSR: 4326,
      limit,
      offset,
    },
    cfg,
  );

  if (parsed.rawExceeded) warnings.push("La limite de transfert ArcGIS peut avoir été atteinte.");
  if (parsed.formatUsed === "json") {
    warnings.push("GeoJSON indisponible ou incomplet : réponse Esri JSON normalisée côté serveur.");
  }

  let anyNullGeometry = false;
  const features = parsed.features.map(f => {
    if (geometryIsNullOrEmpty(f.geometry)) anyNullGeometry = true;
    return shapeFeature(entry, input.mode, f.properties, f.geometry);
  });
  if (anyNullGeometry) {
    warnings.push("Au moins une entité sans géométrie utile (geometry null ou vide).");
  }

  return {
    features,
    countReturned: features.length,
    limit,
    offset: offset ?? 0,
    warnings: [...new Set(warnings)],
    source: {
      type: "annecy_sig_mcp",
      arcgisPath: `${entry.servicePath}/${entry.layerId}`,
      formatUsed: parsed.formatUsed,
    },
  };
}

export async function runSearchNearby(
  cfg: AppConfig,
  input: {
    serviceKey: string;
    layerId: number;
    lat: number;
    lon: number;
    radiusMeters: number;
    where?: string;
    limit?: number;
    mode: VisibilityMode;
  },
) {
  return withToolTracing(
    "search_nearby",
    { serviceKey: input.serviceKey, layerId: input.layerId, mode: input.mode },
    () => runSearchNearbyInner(cfg, input),
  );
}

async function runSearchNearbyInner(
  cfg: AppConfig,
  input: {
    serviceKey: string;
    layerId: number;
    lat: number;
    lon: number;
    radiusMeters: number;
    where?: string;
    limit?: number;
    mode: VisibilityMode;
  },
) {
  const where = (input.where ?? "1=1").trim();
  assertSafeWhere(where);
  validateServiceLayer(input.serviceKey, input.layerId, input.mode);
  const entry = getLayerEntry(input.serviceKey, input.layerId)!;
  const poolLimit = Math.min(cfg.maxResultLimit, Math.max(input.limit ?? cfg.defaultResultLimit, 500));
  const requestedList = [...getEffectiveFields(entry, input.mode)];
  const meta = await getLayerMetadata(input.serviceKey, cfg, entry.servicePath, input.layerId);
  const { arcgisFieldNames, missingRegistryFields } = resolveArcgisOutFields(requestedList, meta);
  const outFields = arcgisFieldNames.join(",");

  const warnings: string[] = [];
  if (missingRegistryFields.length) {
    const sample = missingRegistryFields.slice(0, 12).join(", ");
    const more = missingRegistryFields.length > 12 ? "…" : "";
    warnings.push(
      `Champs du registre absents sur la couche ArcGIS (non inclus dans outFields) : ${sample}${more}`,
    );
  }

  let spatialServerFilterUsed = true;
  let fallbackReason: string | undefined;
  let parsed: Awaited<ReturnType<typeof queryLayerRequest>>;
  try {
    parsed = await queryLayerRequest(
      {
        serviceKey: input.serviceKey,
        layerId: input.layerId,
        servicePath: entry.servicePath,
        where,
        outFields,
        returnGeometry: true,
        outSR: 4326,
        limit: poolLimit,
        geometry: `${input.lon},${input.lat}`,
        geometryType: "esriGeometryPoint",
        inSR: 4326,
        spatialRel: "esriSpatialRelIntersects",
        distance: input.radiusMeters,
        units: "esriSRUnit_Meter",
      },
      cfg,
    );
  } catch (e: unknown) {
    spatialServerFilterUsed = false;
    fallbackReason = e instanceof Error ? e.message : String(e);
    parsed = await queryLayerRequest(
      {
        serviceKey: input.serviceKey,
        layerId: input.layerId,
        servicePath: entry.servicePath,
        where,
        outFields,
        returnGeometry: true,
        outSR: 4326,
        limit: poolLimit,
      },
      cfg,
    );
  }

  if (spatialServerFilterUsed) {
    warnings.push("Filtre spatial serveur ArcGIS appliqué avant le tri Haversine local.");
  } else {
    warnings.push(
      `Filtre spatial serveur indisponible (${fallbackReason ?? "erreur"}). Fallback : requête large + filtre Haversine côté MCP.`,
    );
  }

  const withDist: { feature: Record<string, unknown>; distanceMeters: number }[] = [];
  for (const f of parsed.features) {
    const rep = representativeLatLon(f.geometry);
    if (!rep) {
      warnings.push("Entité ignorée pour la distance : géométrie non exploitable.");
      continue;
    }
    const d = haversineMeters(input.lat, input.lon, rep.lat, rep.lon);
    if (d <= input.radiusMeters) {
      withDist.push({
        feature: { ...shapeFeature(entry, input.mode, f.properties, f.geometry), distanceMeters: d },
        distanceMeters: d,
      });
    }
  }
  withDist.sort((a, b) => a.distanceMeters - b.distanceMeters);
  const limit = parseLimit(input.limit ?? cfg.defaultResultLimit, cfg.defaultResultLimit, cfg.maxResultLimit);
  const sliced = withDist.slice(0, limit).map(x => x.feature);

  return {
    features: sliced,
    countReturned: sliced.length,
    radiusMeters: input.radiusMeters,
    poolScanned: parsed.features.length,
    spatialServerFilterUsed,
    fallbackReason,
    warnings: [...new Set(warnings)],
    source: {
      type: spatialServerFilterUsed ? "annecy_sig_mcp_arcgis_spatial_filter" : "annecy_sig_mcp_arcgis_query_haversine_fallback",
      path: `${entry.servicePath}/${entry.layerId}`,
    },
  };
}
