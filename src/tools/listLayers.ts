import type { AppConfig } from "../config.js";
import { layersVisibleInMode, listLayerEntriesForService, isServiceKeyAllowed } from "../registry.js";
import type { VisibilityMode } from "../registry.js";
import { AppError } from "../utils/errors.js";

export function runListLayers(serviceKey: string, mode: VisibilityMode) {
  if (!isServiceKeyAllowed(serviceKey)) {
    throw new AppError("NOT_FOUND", `Service inconnu : "${serviceKey}".`, {
      hint: "Appeler list_services pour les clés autorisées.",
    });
  }
  const all = listLayerEntriesForService(serviceKey);
  const visible = layersVisibleInMode(all, mode);
  return {
    serviceKey,
    mode,
    layers: visible.map(l => ({
      layerId: l.layerId,
      layerName: l.layerName,
      geometryType: l.geometryType ?? null,
      visibility: l.visibility,
      riskLevel: l.riskLevel,
      publicFields: l.publicFields,
      ...(mode === "internal" ? { internalFields: l.internalFields } : {}),
      useCases: l.useCases,
    })),
    source: { type: "registry" },
  };
}

export type ListLayersContext = { cfg: AppConfig };
