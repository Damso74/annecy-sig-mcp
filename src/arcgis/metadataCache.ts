import type { AppConfig } from "../config.js";
import type { EsriLayerMetadata } from "./types.js";
import { getLayerMetadata } from "./client.js";

/**
 * Cache en mémoire pour une passe d’inventaire : évite les GET métadonnées dupliqués
 * pour la même couche dans le même run (les rapports réutilisent `runInventoryAllLayers`).
 */
export function createLayerMetadataRunCache() {
  const inflight = new Map<string, Promise<EsriLayerMetadata>>();
  return {
    get(serviceKey: string, cfg: AppConfig, servicePath: string, layerId: number): Promise<EsriLayerMetadata> {
      const key = `${serviceKey}\0${layerId}`;
      let p = inflight.get(key);
      if (!p) {
        p = getLayerMetadata(serviceKey, cfg, servicePath, layerId);
        inflight.set(key, p);
      }
      return p;
    },
  };
}
