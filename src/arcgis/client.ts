import type { AppConfig } from "../config.js";
import { AppError } from "../utils/errors.js";
import { layerMetadataUrl, layerQueryUrl, serviceMetadataUrl } from "./urls.js";
import { getArcgisHttpClient } from "./httpClient.js";
import type {
  EsriLayerMetadata,
  EsriQueryResponse,
  EsriServiceMetadata,
  GeoJSONFeatureCollection,
} from "./types.js";

export type ParsedQueryResult = {
  features: { geometry: unknown; properties: Record<string, unknown> }[];
  rawExceeded?: boolean;
  formatUsed: "geojson" | "json";
};

/** Wrapper interne — délègue au client HTTP actif (réseau ou mock). */
async function arcgisGet(url: string, cfg: AppConfig): Promise<unknown> {
  return getArcgisHttpClient().getJson(url, cfg);
}

function assertNoArcgisError(body: unknown, context: string): void {
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error?: { message?: string; code?: number } }).error;
    throw new AppError("ARCGIS_ERROR", e?.message ?? "Erreur ArcGIS.", {
      details: { code: e?.code, context },
    });
  }
}

export async function getServiceMetadata(serviceKey: string, cfg: AppConfig, servicePath: string) {
  const url = serviceMetadataUrl(cfg.annecySigBaseUrl, servicePath);
  const body = await arcgisGet(url, cfg);
  assertNoArcgisError(body, `service ${serviceKey}`);
  return body as EsriServiceMetadata;
}

export async function getLayerMetadata(
  serviceKey: string,
  cfg: AppConfig,
  servicePath: string,
  layerId: number,
) {
  const url = layerMetadataUrl(cfg.annecySigBaseUrl, servicePath, layerId);
  const body = await arcgisGet(url, cfg);
  assertNoArcgisError(body, `layer ${serviceKey}/${layerId}`);
  return body as EsriLayerMetadata;
}

function parseQueryBody(body: unknown, format: "geojson" | "json"): ParsedQueryResult {
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error?: { message?: string; code?: number } }).error;
    throw new AppError("ARCGIS_ERROR", e?.message ?? "Erreur query ArcGIS.", {
      details: { code: e?.code },
    });
  }
  if (format === "geojson" && body && typeof body === "object") {
    const fc = body as GeoJSONFeatureCollection;
    if (fc.type === "FeatureCollection" && Array.isArray(fc.features)) {
      return {
        formatUsed: "geojson",
        features: fc.features.map(f => ({
          geometry: f.geometry,
          properties: f.properties ?? {},
        })),
      };
    }
  }
  const q = body as EsriQueryResponse;
  if (q.error) {
    throw new AppError("ARCGIS_ERROR", q.error.message ?? "Erreur query ArcGIS.", {
      details: { code: q.error.code },
    });
  }
  const feats = q.features ?? [];
  return {
    formatUsed: "json",
    rawExceeded: q.exceededTransferLimit === true,
    features: feats.map(f => ({
      geometry: f.geometry ?? null,
      properties: f.attributes ?? {},
    })),
  };
}

export type QueryLayerParams = {
  serviceKey: string;
  layerId: number;
  servicePath: string;
  where: string;
  outFields: string;
  returnGeometry: boolean;
  outSR: number;
  limit: number;
  offset?: number;
  geometry?: string;
  geometryType?: string;
  inSR?: number;
  spatialRel?: string;
  distance?: number;
  units?: string;
};

export async function queryLayerRequest(params: QueryLayerParams, cfg: AppConfig): Promise<ParsedQueryResult> {
  const baseParams: Record<string, string | number | boolean | undefined> = {
    where: params.where,
    outFields: params.outFields,
    returnGeometry: params.returnGeometry,
    outSR: params.outSR,
    resultRecordCount: params.limit,
    resultOffset: params.offset,
    geometry: params.geometry,
    geometryType: params.geometryType,
    inSR: params.inSR,
    spatialRel: params.spatialRel,
    distance: params.distance,
    units: params.units,
  };
  const tryGeojson = layerQueryUrl(
    cfg.annecySigBaseUrl,
    params.servicePath,
    params.layerId,
    baseParams,
    "geojson",
  );
  const body = await arcgisGet(tryGeojson, cfg);
  try {
    return parseQueryBody(body, "geojson");
  } catch {
    const fallbackUrl = layerQueryUrl(
      cfg.annecySigBaseUrl,
      params.servicePath,
      params.layerId,
      baseParams,
      "json",
    );
    const bodyJson = await arcgisGet(fallbackUrl, cfg);
    return parseQueryBody(bodyJson, "json");
  }
}

export async function countLayerRequest(
  cfg: AppConfig,
  servicePath: string,
  layerId: number,
  where: string,
): Promise<number> {
  const params: Record<string, string | number | boolean | undefined> = {
    where,
    returnCountOnly: true,
    returnGeometry: false,
  };
  const url = layerQueryUrl(cfg.annecySigBaseUrl, servicePath, layerId, params, "json");
  const body = (await arcgisGet(url, cfg)) as { count?: number; error?: { message?: string } };
  if (body.error) {
    throw new AppError("ARCGIS_ERROR", body.error.message ?? "Erreur count ArcGIS.", {});
  }
  if (typeof body.count !== "number") {
    throw new AppError("ARCGIS_ERROR", "Réponse count ArcGIS invalide.", {});
  }
  return body.count;
}

export async function getSampleFeatures(
  cfg: AppConfig,
  servicePath: string,
  layerId: number,
  limit: number,
  outFields: string,
) {
  return queryLayerRequest(
    {
      serviceKey: "sample",
      layerId,
      servicePath,
      where: "1=1",
      outFields,
      returnGeometry: true,
      outSR: 4326,
      limit,
    },
    cfg,
  );
}
