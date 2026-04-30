import type { AppConfig } from "../config.js";
import { layersVisibleInMode, listLayerEntriesForService, SERVICE_REGISTRY } from "../registry.js";
import type { VisibilityMode } from "../registry.js";

export function runListServices(mode: VisibilityMode) {
  return {
    mode,
    services: SERVICE_REGISTRY.map(s => {
      const all = listLayerEntriesForService(s.serviceKey);
      const visible = layersVisibleInMode(all, mode);
      return {
        serviceKey: s.serviceKey,
        servicePath: s.servicePath,
        description: s.description,
        visibility: s.defaultVisibility,
        riskLevel: s.defaultRisk,
        layersCount: visible.length,
      };
    }),
    source: { type: "registry", host: "portailsig.annecy.fr" },
  };
}

export type ListServicesContext = { cfg: AppConfig };
