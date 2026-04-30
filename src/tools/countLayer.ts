import type { AppConfig } from "../config.js";
import { getLayerEntry } from "../registry.js";
import type { VisibilityMode } from "../registry.js";
import { countLayerRequest } from "../arcgis/client.js";
import { assertSafeWhere, validateServiceLayer } from "../utils/validation.js";

export async function runCountLayer(
  cfg: AppConfig,
  input: { serviceKey: string; layerId: number; where?: string; mode: VisibilityMode },
) {
  const where = (input.where ?? "1=1").trim();
  assertSafeWhere(where);
  validateServiceLayer(input.serviceKey, input.layerId, input.mode);
  const entry = getLayerEntry(input.serviceKey, input.layerId)!;
  const count = await countLayerRequest(cfg, entry.servicePath, input.layerId, where);
  return {
    serviceKey: input.serviceKey,
    layerId: input.layerId,
    layerName: entry.layerName,
    where,
    count,
    source: {
      type: "arcgis_count_only",
      path: `${entry.servicePath}/${entry.layerId}`,
    },
  };
}
