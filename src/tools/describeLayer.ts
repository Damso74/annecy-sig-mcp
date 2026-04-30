import type { AppConfig } from "../config.js";
import { getLayerEntry } from "../registry.js";
import type { VisibilityMode } from "../registry.js";
import { getLayerMetadata } from "../arcgis/client.js";
import { getEffectiveFields, validateServiceLayer } from "../utils/validation.js";
import { validateRegistryFieldsAgainstArcGIS } from "../utils/arcgisFieldValidation.js";
import {
  sanitizeArcgisFields,
  sanitizeArcgisLayerMetadata,
} from "../utils/sanitizeArcgisMetadata.js";
import { SERVER_VERSION } from "../runtime/version.js";

export async function runDescribeLayer(
  cfg: AppConfig,
  serviceKey: string,
  layerId: number,
  mode: VisibilityMode,
  options?: { includeRawMetadata?: boolean },
) {
  validateServiceLayer(serviceKey, layerId, mode);
  const entry = getLayerEntry(serviceKey, layerId)!;
  const meta = await getLayerMetadata(serviceKey, cfg, entry.servicePath, layerId);
  const allowed = getEffectiveFields(entry, mode);
  const fieldsRaw = meta.fields ?? [];
  const requestedRegistryFields = [...allowed];
  const fieldAlignment = validateRegistryFieldsAgainstArcGIS(requestedRegistryFields, meta);
  const allowedLc = new Set([...allowed].map(a => a.toLowerCase()));
  const fieldsInScope = fieldsRaw.filter(f => allowedLc.has(f.name.toLowerCase()));

  const warnings: string[] = [];
  if (!meta.geometryType) warnings.push("geometryType absent des métadonnées ArcGIS.");
  if (entry.geometryType && meta.geometryType && entry.geometryType !== meta.geometryType) {
    warnings.push(
      `Écart geometryType registre (${entry.geometryType}) vs ArcGIS (${meta.geometryType}).`,
    );
  }

  const includeRawMetadata = options?.includeRawMetadata === true;
  const exposedFields = sanitizeArcgisFields(fieldsInScope, mode);
  const sanitizedLayerMetadata = sanitizeArcgisLayerMetadata(meta, { mode, includeRawMetadata });

  return {
    serviceKey,
    layerId,
    layerName: entry.layerName,
    mode,
    geometryType: fieldAlignment.geometryType ?? meta.geometryType ?? null,
    objectIdField: fieldAlignment.objectIdField ?? meta.objectIdField ?? null,
    supportsQuery: fieldAlignment.supportsQuery,
    capabilities: meta.capabilities ?? null,
    registry: {
      layerName: entry.layerName,
      visibility: entry.visibility,
      riskLevel: entry.riskLevel,
      description: entry.description,
      useCases: entry.useCases,
      semanticMappings: entry.semanticMappings,
    },
    exposedFields,
    fieldAlignment: {
      validFields: fieldAlignment.validFields,
      missingFields: fieldAlignment.missingFields,
      ignoredFieldsPreview: fieldAlignment.ignoredFields
        .filter(f => !/created_user|last_edited|url_pj|token|password|secret|attachment/i.test(f))
        .slice(0, 30),
      objectIdField: fieldAlignment.objectIdField,
      geometryType: fieldAlignment.geometryType ?? meta.geometryType ?? null,
      supportsQuery: fieldAlignment.supportsQuery,
    },
    sanitizedLayerMetadata,
    includeRawMetadata,
    warnings,
    source: { type: "arcgis_layer", path: entry.servicePath, serverVersion: SERVER_VERSION },
  };
}
