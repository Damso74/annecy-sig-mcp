import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AppConfig } from "../src/config.js";
import type { LayerRegistryEntry } from "../src/registry.js";
import * as client from "../src/arcgis/client.js";
import { fetchInventorySampleWithFallbacks } from "../src/utils/inventorySampleArcgis.js";
import type { RegistryArcgisFieldValidation } from "../src/utils/arcgisFieldValidation.js";

describe("fetchInventorySampleWithFallbacks", () => {
  const cfg = {} as AppConfig;
  const entry = {
    serviceKey: "equipements",
    servicePath: "X/MapServer",
    layerId: 5,
    layerName: "Test",
    visibility: "public",
    riskLevel: "green",
    publicFields: ["objectid"],
    internalFields: ["objectid"],
    description: "",
    useCases: [],
  } as unknown as LayerRegistryEntry;

  const validation: RegistryArcgisFieldValidation = {
    validFields: ["bad_field_only_x"],
    missingFields: ["bad_field_only_x"],
    ignoredFields: [],
    objectIdField: "OBJECTID",
    geometryType: "esriGeometryPoint",
    supportsQuery: true,
  };

  const spy = vi.spyOn(client, "queryLayerRequest");

  beforeEach(() => {
    spy.mockReset();
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it("passe à objectId après échec des champs registre et de *", async () => {
    spy
      .mockRejectedValueOnce(new Error("Failed to execute query"))
      .mockRejectedValueOnce(new Error("Failed to execute query"))
      .mockResolvedValueOnce({
        formatUsed: "json" as const,
        features: [
          {
            geometry: { type: "Point", coordinates: [6.12, 45.9] },
            properties: { OBJECTID: 1 },
          },
        ],
      });

    const r = await fetchInventorySampleWithFallbacks(cfg, entry, 5, validation);

    expect(r.sampleStatus).toBe("ok");
    expect(r.sampleFallbackUsed).toBe("objectid_only");
    expect(spy).toHaveBeenCalledTimes(3);
    const third = spy.mock.calls[2]?.[0];
    expect(third?.outFields).toBe("OBJECTID");
  });
});
