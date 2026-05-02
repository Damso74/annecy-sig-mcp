import type { AppConfig } from "../config.js";
import { layersVisibleInMode, listLayerEntriesForService, SERVICE_REGISTRY } from "../registry.js";
import type { VisibilityMode } from "../registry.js";

export function runListServices(mode: VisibilityMode) {
  return {
    mode,
    services: SERVICE_REGISTRY.map(s => {
      const all = listLayerEntriesForService(s.serviceKey);
      const visible = layersVisibleInMode(all, mode);
      const base = {
        serviceKey: s.serviceKey,
        servicePath: s.servicePath,
        description: s.description,
        visibility: s.defaultVisibility,
        riskLevel: s.defaultRisk,
        layersCount: visible.length,
      };
      /**
       * Nuance critique pour les assistants (Copilot Studio, etc.) :
       * en mode public, `layersCount === 0` pour « travaux » signifie seulement
       * que **query_layer / search_nearby / list_layers** n’exposent aucune
       * couche brute — pas que les travaux citoyens sont absents du canal.
       * La vue filtrée passe par `list_public_works` et
       * `search_public_works_nearby`.
       */
      if (mode === "public" && s.serviceKey === "travaux") {
        return {
          ...base,
          publicCitizenAccess: {
            tools: ["list_public_works", "search_public_works_nearby"] as const,
            explanation:
              "En mode public, aucune couche « travaux » n’est interrogeable via query_layer ou search_nearby (layersCount = 0). Une vue citoyenne filtrée existe néanmoins via ces deux outils MCP uniquement.",
          },
        };
      }
      return base;
    }),
    source: { type: "registry", host: "portailsig.annecy.fr" },
  };
}

export type ListServicesContext = { cfg: AppConfig };
