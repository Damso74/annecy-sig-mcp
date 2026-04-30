/** Réponses ArcGIS / GeoJSON minimales côté serveur. */

export type EsriField = {
  name: string;
  type?: string;
  alias?: string;
};

export type EsriLayerMetadata = {
  id?: number;
  name?: string;
  type?: string;
  geometryType?: string;
  capabilities?: string;
  maxRecordCount?: number;
  objectIdField?: string;
  globalIdField?: string;
  fields?: EsriField[];
  extent?: unknown;
  description?: string;
};

export type EsriServiceMetadata = {
  serviceDescription?: string;
  mapName?: string;
  layers?: { id: number; name: string }[];
  tables?: { id: number; name: string }[];
  spatialReference?: unknown;
  initialExtent?: unknown;
  fullExtent?: unknown;
};

export type GeoJSONFeature = {
  type: "Feature";
  geometry: unknown;
  properties: Record<string, unknown> | null;
};

export type GeoJSONFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
};

export type EsriQueryFeature = {
  attributes?: Record<string, unknown>;
  geometry?: unknown;
};

export type EsriQueryResponse = {
  features?: EsriQueryFeature[];
  exceededTransferLimit?: boolean;
  error?: { code?: number; message?: string };
};
