import type { VisibilityMode } from "../registry.js";
import type { EsriField, EsriLayerMetadata } from "../arcgis/types.js";

const STRIP_TOP_LEVEL_KEYS = new Set([
  "editingInfo",
  "templates",
  "types",
  "relationships",
  "indexes",
  "drawingInfo",
  "editorTrackingInfo",
  "ownershipBasedAccessControlForFeatures",
]);

function sensitiveKeyFragment(key: string): boolean {
  const k = key.toLowerCase();
  const needles = [
    "password",
    "token",
    "secret",
    "credential",
    "auth",
    "created_user",
    "created_date",
    "creator",
    "editor",
    "last_edited",
    "globalid",
    "attachment",
    "url_pj",
    "url_piece_jointe",
    "piece_jointe",
  ];
  return needles.some(n => k.includes(n));
}

/** Clé métadonnée sensible ou défensive (nom de propriété). */
export function isSensitiveMetadataKey(key: string): boolean {
  return sensitiveKeyFragment(key);
}

/**
 * Parcourt récursivement un JSON-like et supprime les clés sensibles / listées.
 * Ne jette pas d’exception.
 */
export function sanitizeDeepObject(value: unknown, depth = 0): unknown {
  if (depth > 24) return null;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(v => sanitizeDeepObject(v, depth + 1));
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (isSensitiveMetadataKey(k) || STRIP_TOP_LEVEL_KEYS.has(k)) continue;
      out[k] = sanitizeDeepObject(v, depth + 1);
    }
    return out;
  }
  return value;
}

export type SanitizedArcgisField = {
  name: string;
  type?: string;
  alias?: string;
  nullable?: boolean;
};

/** Réduit la liste de champs ArcGIS exposée (pas de workflow sensible). */
export function sanitizeArcgisFields(
  fields: EsriField[] | undefined,
  mode: VisibilityMode,
): SanitizedArcgisField[] {
  if (!fields?.length) return [];
  const out: SanitizedArcgisField[] = [];
  for (const f of fields) {
    const name = f.name;
    if (!name || isSensitiveMetadataKey(name)) continue;
    if (mode === "public" && name.toLowerCase() === "globalid") continue;
    const row: SanitizedArcgisField = {
      name,
      type: f.type,
      alias: f.alias,
    };
    const n = (f as { nullable?: boolean }).nullable;
    if (typeof n === "boolean") row.nullable = n;
    out.push(row);
  }
  return out;
}

export type SanitizeLayerMetaOptions = {
  mode: VisibilityMode;
  /** Si true, retourne une copie profonde sanitisée du métadonnées-layer (toujours filtrée). */
  includeRawMetadata?: boolean;
};

/**
 * Métadonnées couche ArcGIS réduites et sanitisées pour exposition MCP.
 */
export function sanitizeArcgisLayerMetadata(
  meta: EsriLayerMetadata,
  opts: SanitizeLayerMetaOptions,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: meta.id,
    name: meta.name,
    type: meta.type,
    geometryType: meta.geometryType ?? null,
    capabilities: meta.capabilities ?? null,
    maxRecordCount: meta.maxRecordCount ?? null,
    objectIdField: meta.objectIdField ?? null,
    description: typeof meta.description === "string" ? meta.description : undefined,
    extent: meta.extent,
  };
  if (opts.mode === "internal" && meta.globalIdField && !isSensitiveMetadataKey(String(meta.globalIdField))) {
    base.globalIdField = meta.globalIdField;
  }
  const cleaned = sanitizeDeepObject(base) as Record<string, unknown>;
  if (opts.includeRawMetadata) {
    const raw = { ...meta } as Record<string, unknown>;
    for (const k of STRIP_TOP_LEVEL_KEYS) delete raw[k];
    delete raw.fields;
    cleaned.sanitizedMetadataBundle = sanitizeDeepObject(raw);
  }
  return cleaned;
}
