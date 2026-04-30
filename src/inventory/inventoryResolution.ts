import {
  LAYER_REGISTRY,
  layersVisibleInMode,
  isServiceKeyAllowed,
  getLayerEntry,
  type LayerRegistryEntry,
  type VisibilityMode,
} from "../registry.js";
import { AppError } from "../utils/errors.js";
import { validateServiceLayer } from "../utils/validation.js";
import type { InventoryTarget } from "./types.js";

/**
 * Résout la liste des entrées registre à inventorier.
 * `targets` et `serviceKeys` sont mutuellement exclusifs (erreur si les deux sont présents dans l’input).
 */
export function resolveInventoryLayerEntries(
  mode: VisibilityMode,
  serviceKeys: string[] | undefined,
  targets: InventoryTarget[] | undefined,
): LayerRegistryEntry[] {
  const hasServiceKeys = serviceKeys !== undefined;
  const hasTargets = targets !== undefined;
  if (hasServiceKeys && hasTargets) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Ne pas combiner `serviceKeys` et `targets` : choisir un seul mode de filtrage.",
      { hint: "Utiliser soit `serviceKeys` (toutes les couches visibles de ces services), soit `targets` (sélection fine par couche)." },
    );
  }

  const visible = layersVisibleInMode(LAYER_REGISTRY, mode);

  if (hasTargets) {
    if (!targets!.length) return [];
    const seen = new Set<string>();
    const out: LayerRegistryEntry[] = [];
    for (const t of targets!) {
      if (!isServiceKeyAllowed(t.serviceKey)) {
        throw new AppError("NOT_FOUND", `Service non autorisé : "${t.serviceKey}".`, {
          details: { serviceKey: t.serviceKey },
        });
      }
      if (t.layerId !== undefined) {
        validateServiceLayer(t.serviceKey, t.layerId, mode);
        const entry = getLayerEntry(t.serviceKey, t.layerId);
        if (!entry) {
          throw new AppError("NOT_FOUND", `Couche ${t.serviceKey} / ${t.layerId} introuvable dans le registre.`, {});
        }
        const k = `${entry.serviceKey}:${entry.layerId}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push(entry);
        }
        continue;
      }
      for (const e of visible) {
        if (e.serviceKey !== t.serviceKey) continue;
        const k = `${e.serviceKey}:${e.layerId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e);
      }
    }
    return out;
  }

  if (serviceKeys?.length) {
    for (const sk of serviceKeys) {
      if (!isServiceKeyAllowed(sk)) {
        throw new AppError("NOT_FOUND", `Service non autorisé dans l'allowlist : "${sk}".`, {
          details: { serviceKey: sk },
          hint: "Utiliser list_services pour les clés autorisées.",
        });
      }
    }
    const skSet = new Set(serviceKeys);
    return visible.filter(e => skSet.has(e.serviceKey));
  }

  return visible;
}
