import type { AppConfig } from "../config.js";
import type { LayerRegistryEntry } from "../registry.js";
import { queryLayerRequest, type ParsedQueryResult } from "../arcgis/client.js";
import { isAppError } from "./errors.js";
import type { RegistryArcgisFieldValidation } from "./arcgisFieldValidation.js";

export type InventorySampleFallbackUsed = "registry_valid" | "star" | "objectid_only" | "none";
export type InventorySampleStatus = "ok" | "empty" | "failed";

/**
 * Échantillon ArcGIS pour l’inventaire : champs registre validés, puis fallbacks `*` et `objectIdField`.
 * Les fallbacks ne s’enchaînent qu’en cas d’**erreur** de requête ; un résultat vide reste `empty`.
 */
export async function fetchInventorySampleWithFallbacks(
  cfg: AppConfig,
  entry: LayerRegistryEntry,
  sampleLimit: number,
  validation: RegistryArcgisFieldValidation,
): Promise<{
  parsed: ParsedQueryResult | null;
  sampleStatus: InventorySampleStatus;
  sampleError?: string;
  sampleFallbackUsed: InventorySampleFallbackUsed;
}> {
  if (!validation.supportsQuery) {
    return {
      parsed: null,
      sampleStatus: "failed",
      sampleError: "Couche sans capacité Query (métadonnées ArcGIS) : échantillon non exécuté.",
      sampleFallbackUsed: "none",
    };
  }

  type AttemptLabel = Exclude<InventorySampleFallbackUsed, "none">;
  const attempts: { label: AttemptLabel; outFields: string }[] = [];
  if (validation.validFields.length > 0) {
    attempts.push({ label: "registry_valid", outFields: validation.validFields.join(",") });
  }
  attempts.push({ label: "star", outFields: "*" });
  const oid = validation.objectIdField;
  if (oid) {
    attempts.push({ label: "objectid_only", outFields: oid });
  }

  let lastError = "";
  for (const att of attempts) {
    try {
      const parsed = await queryLayerRequest(
        {
          serviceKey: entry.serviceKey,
          layerId: entry.layerId,
          servicePath: entry.servicePath,
          where: "1=1",
          outFields: att.outFields,
          returnGeometry: true,
          outSR: 4326,
          limit: sampleLimit,
        },
        cfg,
      );
      if (parsed.features.length > 0) {
        return { parsed, sampleStatus: "ok", sampleFallbackUsed: att.label };
      }
      return { parsed, sampleStatus: "empty", sampleFallbackUsed: att.label };
    } catch (e) {
      lastError = isAppError(e) ? e.message : String(e);
    }
  }

  return {
    parsed: null,
    sampleStatus: "failed",
    sampleError:
      lastError ||
      "Échantillon indisponible après fallbacks (champs registre validés, *, objectIdField) ; comptage / métadonnées seuls.",
    sampleFallbackUsed: "none",
  };
}
