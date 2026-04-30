import type { EsriField, EsriLayerMetadata } from "../arcgis/types.js";

/** Résultat de la confrontation champs registre ↔ métadonnées couche ArcGIS. */
export type RegistryArcgisFieldValidation = {
  /** Noms de champs tels qu’ArcGIS les expose, utilisables dans `outFields`. */
  validFields: string[];
  /** Champs demandés par le registre mais absents de la couche (insensible à la casse). */
  missingFields: string[];
  /**
   * Champs présents sur la couche ArcGIS mais non demandés par le registre pour cet inventaire
   * (informatif, liste plafonnée pour éviter les payloads énormes).
   */
  ignoredFields: string[];
  objectIdField: string | null;
  geometryType: string | null;
  supportsQuery: boolean;
};

function layerSupportsQuery(meta: EsriLayerMetadata): boolean {
  const caps = (meta.capabilities ?? "").toLowerCase();
  if (!caps.trim()) return true;
  return caps.includes("query") || caps.includes("data");
}

/**
 * Compare les champs souhaités (registre / mode) avec `fields` issus du `f=pjson` de la couche.
 */
export function validateRegistryFieldsAgainstArcGIS(
  requestedRegistryFields: string[],
  meta: EsriLayerMetadata,
): RegistryArcgisFieldValidation {
  const arcgisFields = meta.fields ?? [];
  const lowerToCanonical = new Map<string, string>();
  for (const f of arcgisFields) {
    if (f?.name) lowerToCanonical.set(f.name.toLowerCase(), f.name);
  }

  const validFields: string[] = [];
  const missingFields: string[] = [];
  const seen = new Set<string>();
  for (const rf of requestedRegistryFields) {
    const canon = lowerToCanonical.get(rf.toLowerCase());
    if (canon) {
      if (!seen.has(canon.toLowerCase())) {
        seen.add(canon.toLowerCase());
        validFields.push(canon);
      }
    } else {
      missingFields.push(rf);
    }
  }

  const requestedLc = new Set(requestedRegistryFields.map(x => x.toLowerCase()));
  const ignoredFields = arcgisFields
    .map((f: EsriField) => f.name)
    .filter((n): n is string => Boolean(n) && !requestedLc.has(n.toLowerCase()))
    .slice(0, 80);

  const oid = meta.objectIdField?.trim() ? meta.objectIdField.trim() : null;

  return {
    validFields,
    missingFields,
    ignoredFields,
    objectIdField: oid,
    geometryType: meta.geometryType ?? null,
    supportsQuery: layerSupportsQuery(meta),
  };
}
