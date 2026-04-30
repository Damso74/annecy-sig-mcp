import type { LayerRegistryEntry, VisibilityMode } from "../registry.js";
import { SERVICE_INVENTORY_DEFAULTS } from "../registry.js";
import { flattenSemanticFieldMappings } from "../utils/semanticMappings.js";
import { lowerPropertyKeys } from "../utils/properties.js";
import { getEffectiveFields } from "../utils/validation.js";
import { sanitizePublicProperties, stripDangerousKeys } from "../utils/sanitize.js";

function alignToAllowed(
  props: Record<string, unknown>,
  allowedLc: Set<string>,
): Record<string, unknown> {
  const lower = lowerPropertyKeys(props);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(lower)) {
    if (allowedLc.has(k)) out[k] = v;
  }
  return out;
}

/** Champs « lisibles » pour ratios inventaire : priorité aux `semanticMappings`, puis défaut service. */
export function getReadableKeysForInventory(entry: LayerRegistryEntry): string[] {
  const flat = flattenSemanticFieldMappings(entry.semanticMappings);
  const fromSem = [
    flat.labelField,
    flat.addressField,
    flat.categoryField,
    flat.subCategoryField,
    flat.identifierField,
    flat.openingField,
    flat.communeField,
  ].filter((x): x is string => typeof x === "string" && x.trim() !== "");
  if (fromSem.length) {
    return [...new Set(fromSem.map(k => k.toLowerCase()))];
  }
  const def = SERVICE_INVENTORY_DEFAULTS[entry.serviceKey];
  return def?.readableKeys?.length ? [...def.readableKeys] : ["denomination", "adresse"];
}

/** Champs date / horaire pour proxy de fraîcheur inventaire. */
export function getDateKeysForInventory(entry: LayerRegistryEntry): string[] {
  const flat = flattenSemanticFieldMappings(entry.semanticMappings);
  if (flat.startDateField && flat.endDateField) {
    return [flat.startDateField.toLowerCase(), flat.endDateField.toLowerCase()];
  }
  if (flat.scheduleField) return [flat.scheduleField.toLowerCase()];
  const def = SERVICE_INVENTORY_DEFAULTS[entry.serviceKey];
  return def?.dateKeys?.length ? [...def.dateKeys] : ["horaire"];
}

/** Propriétés nettoyées pour stats (sanitize prioritaire en public). */
export function preparePropsForInventoryStats(
  props: Record<string, unknown>,
  entry: LayerRegistryEntry,
  mode: VisibilityMode,
): Record<string, unknown> {
  const allowed = getEffectiveFields(entry, mode);
  const allowedLc = new Set([...allowed].map(f => f.toLowerCase()));
  const aligned = alignToAllowed(props, allowedLc);
  if (mode === "public") {
    return sanitizePublicProperties(aligned, allowedLc);
  }
  return stripDangerousKeys(aligned);
}

export function getInventoryFieldsForMode(
  entry: LayerRegistryEntry,
  mode: VisibilityMode,
): { publicFields: string[]; internalFields?: string[] } {
  if (mode === "public") {
    return { publicFields: [...entry.publicFields] };
  }
  return {
    publicFields: [...entry.publicFields],
    internalFields: [...entry.internalFields],
  };
}
