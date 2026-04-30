import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  countLayerRequest,
  getLayerMetadata,
  queryLayerRequest,
} from "../src/arcgis/client.js";
import { fetchInventorySampleWithFallbacks } from "../src/utils/inventorySampleArcgis.js";
import { runInventoryAllLayers } from "../src/tools/inventoryAllLayers.js";
import { runDescribeLayer } from "../src/tools/describeLayer.js";
import { runGenerateInventoryReport } from "../src/tools/generateInventoryReport.js";
import { runGenerateOpenDataBrief } from "../src/tools/generateOpenDataBrief.js";
import { runGenerateChatbotReadinessReport } from "../src/tools/generateChatbotReadinessReport.js";
import { runGenerateLayerActionPlan } from "../src/tools/generateLayerActionPlan.js";
import { validateRegistryFieldsAgainstArcGIS } from "../src/utils/arcgisFieldValidation.js";
import {
  defaultRegistryMatchers,
  installMockArcgisClient,
  loadFixture,
  metaMatcher,
  queryMatcher,
} from "./helpers/mockArcgisClient.js";
import type { EsriLayerMetadata } from "../src/arcgis/types.js";

const SENSITIVE_NEEDLES = [
  "created_user",
  "last_edited_user",
  "last_edited_date",
  "token",
  "password",
  "url_piece_jointe",
  "url_pj",
];

function expectNoSensitive(s: string): void {
  const low = s.toLowerCase();
  for (const n of SENSITIVE_NEEDLES) {
    expect(low, `payload doit éviter "${n}"`).not.toContain(n);
  }
}

describe("V0.8 — client ArcGIS injectable / parsing", () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it("parse correctement une réponse GeoJSON", async () => {
    const { restore } = installMockArcgisClient([
      {
        match: queryMatcher("EQUIPEMENTS/MapServer", 5),
        fixture: "equipements-wc-query-geojson.json",
      },
    ]);
    teardown = restore;
    const cfg = loadConfig();
    const r = await queryLayerRequest(
      {
        serviceKey: "equipements",
        layerId: 5,
        servicePath: "FLUX_SITE_INTERNET/EQUIPEMENTS/MapServer",
        where: "1=1",
        outFields: "*",
        returnGeometry: true,
        outSR: 4326,
        limit: 5,
      },
      cfg,
    );
    expect(r.formatUsed).toBe("geojson");
    expect(r.features.length).toBe(3);
    expect(r.features[0]?.properties.denomination).toBe("WC Hôtel de Ville");
  });

  it("parse correctement une réponse Esri JSON", async () => {
    const { restore } = installMockArcgisClient([
      {
        match: queryMatcher("EQUIPEMENTS/MapServer", 5),
        body: { features: undefined, error: { message: "Not GeoJSON" } },
        label: "geojson-attempt-fail",
      },
    ]);
    // Le client tente d’abord f=geojson : on simule une erreur, puis on installe une fixture esri sur l’URL f=json.
    teardown = restore;
    const cfg = loadConfig();
    // Insérer une réponse esri pour le second appel (f=json)
    // On utilise un matcher plus spécifique : f=json
    const { restore: restore2, client } = installMockArcgisClient([
      {
        match: (url: string) => url.includes("/5/query") && url.includes("f=json"),
        fixture: "equipements-wc-query-esri.json",
        label: "esri",
      },
      {
        match: (url: string) => url.includes("/5/query") && url.includes("f=geojson"),
        body: { error: { message: "GeoJSON unsupported" } },
        label: "geojson-fail",
      },
    ]);
    teardown = restore2;
    const r = await queryLayerRequest(
      {
        serviceKey: "equipements",
        layerId: 5,
        servicePath: "FLUX_SITE_INTERNET/EQUIPEMENTS/MapServer",
        where: "1=1",
        outFields: "*",
        returnGeometry: true,
        outSR: 4326,
        limit: 5,
      },
      cfg,
    );
    expect(r.formatUsed).toBe("json");
    expect(r.features.length).toBe(2);
    expect(client.callCount()).toBe(2);
  });

  it("transforme une erreur ArcGIS en AppError structurée", async () => {
    const { restore } = installMockArcgisClient([
      {
        match: queryMatcher("EQUIPEMENTS/MapServer", 5),
        fixture: "error-failed-query.json",
        label: "always-fail",
      },
    ]);
    teardown = restore;
    const cfg = loadConfig();
    await expect(
      queryLayerRequest(
        {
          serviceKey: "equipements",
          layerId: 5,
          servicePath: "FLUX_SITE_INTERNET/EQUIPEMENTS/MapServer",
          where: "1=1",
          outFields: "*",
          returnGeometry: false,
          outSR: 4326,
          limit: 5,
        },
        cfg,
      ),
    ).rejects.toThrow(/Failed to execute query/i);
  });

  it("expose exceededTransferLimit en mode Esri JSON", async () => {
    const { restore } = installMockArcgisClient([
      {
        match: (url: string) => url.includes("/query") && url.includes("f=geojson"),
        body: { error: { message: "no geojson" } },
      },
      {
        match: (url: string) => url.includes("/query") && url.includes("f=json"),
        fixture: "exceeded-transfer-limit.json",
      },
    ]);
    teardown = restore;
    const cfg = loadConfig();
    const r = await queryLayerRequest(
      {
        serviceKey: "equipements",
        layerId: 5,
        servicePath: "FLUX_SITE_INTERNET/EQUIPEMENTS/MapServer",
        where: "1=1",
        outFields: "*",
        returnGeometry: false,
        outSR: 4326,
        limit: 5,
      },
      cfg,
    );
    expect(r.rawExceeded).toBe(true);
  });

  it("count_layer renvoie le compteur ArcGIS", async () => {
    const { restore } = installMockArcgisClient([
      {
        match: (url: string) => url.includes("/5/query") && url.includes("returnCountOnly=true"),
        fixture: "equipements-wc-count.json",
      },
    ]);
    teardown = restore;
    const cfg = loadConfig();
    const n = await countLayerRequest(cfg, "FLUX_SITE_INTERNET/EQUIPEMENTS/MapServer", 5, "1=1");
    expect(n).toBe(42);
  });

  it("getLayerMetadata renvoie une fixture conforme", async () => {
    const { restore } = installMockArcgisClient([
      { match: metaMatcher("EQUIPEMENTS/MapServer", 5), fixture: "equipements-wc-metadata.json" },
    ]);
    teardown = restore;
    const cfg = loadConfig();
    const m = await getLayerMetadata("equipements", cfg, "FLUX_SITE_INTERNET/EQUIPEMENTS/MapServer", 5);
    expect(m.geometryType).toBe("esriGeometryPoint");
    expect(m.objectIdField).toBe("OBJECTID");
  });
});

describe("V0.8 — fetchInventorySampleWithFallbacks (offline)", () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  const cfg = loadConfig();
  const entry = {
    serviceKey: "equipements",
    servicePath: "FLUX_SITE_INTERNET/EQUIPEMENTS/MapServer",
    layerId: 5,
    layerName: "WC publics",
    visibility: "public" as const,
    riskLevel: "green" as const,
    publicFields: ["objectid", "denomination"],
    internalFields: ["objectid", "denomination"],
    description: "",
    useCases: [],
  };

  it("sampleStatus = empty quand la requête renvoie 0 entité", async () => {
    const { restore } = installMockArcgisClient([
      { match: queryMatcher("EQUIPEMENTS/MapServer", 5), fixture: "empty-sample.json" },
    ]);
    teardown = restore;
    const meta = loadFixture("equipements-wc-metadata.json") as EsriLayerMetadata;
    const validation = validateRegistryFieldsAgainstArcGIS(["objectid", "denomination"], meta);
    const r = await fetchInventorySampleWithFallbacks(cfg, entry, 5, validation);
    expect(r.sampleStatus).toBe("empty");
  });

  it("sampleStatus = failed après épuisement des fallbacks", async () => {
    const { restore } = installMockArcgisClient([
      { match: queryMatcher("EQUIPEMENTS/MapServer", 5), fixture: "error-failed-query.json" },
    ]);
    teardown = restore;
    const meta = loadFixture("equipements-wc-metadata.json") as EsriLayerMetadata;
    const validation = validateRegistryFieldsAgainstArcGIS(["objectid", "denomination"], meta);
    const r = await fetchInventorySampleWithFallbacks(cfg, entry, 5, validation);
    expect(r.sampleStatus).toBe("failed");
    expect(r.sampleFallbackUsed).toBe("none");
  });

  it("ne fait aucun appel réseau si le matcher est absent", async () => {
    const { restore, client } = installMockArcgisClient([]);
    teardown = restore;
    const meta = loadFixture("equipements-wc-metadata.json") as EsriLayerMetadata;
    const validation = validateRegistryFieldsAgainstArcGIS(["objectid"], meta);
    const r = await fetchInventorySampleWithFallbacks(cfg, entry, 5, validation);
    expect(r.sampleStatus).toBe("failed");
    expect(client.callCount()).toBeGreaterThan(0);
  });
});

describe("V0.8 — runInventoryAllLayers (offline, périmètre ciblé)", () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it("inventaire targets = WC publics retourne une couche cohérente", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const inv = await runInventoryAllLayers(cfg, {
      mode: "public",
      sampleLimit: 5,
      targets: [{ serviceKey: "equipements", layerId: 5 }],
    });
    expect(inv.layers).toHaveLength(1);
    const row = inv.layers[0]!;
    expect(row.serviceKey).toBe("equipements");
    expect(row.layerId).toBe(5);
    expect(row.sampleStatus).toBe("ok");
    expect(row.geometryStatus).toBe("present");
    expect(row.count).toBe(42);
    expect(inv.source.schemaVersion).toBe("inventory.v1");
    expect(inv.source.serverVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(inv.source.execution.requestedSampleLimit).toBe(5);
  });

  it("serviceKeys filtre l’inventaire sur un service entier", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const inv = await runInventoryAllLayers(cfg, {
      mode: "public",
      sampleLimit: 3,
      serviceKeys: ["equipements"],
    });
    expect(inv.layers.every(l => l.serviceKey === "equipements")).toBe(true);
    expect(inv.layers.length).toBeGreaterThan(0);
  });

  it("conflit serviceKeys + targets refuse proprement", async () => {
    const cfg = loadConfig();
    await expect(
      runInventoryAllLayers(cfg, {
        mode: "public",
        serviceKeys: ["equipements"],
        targets: [{ serviceKey: "mobilite", layerId: 10 }],
      }),
    ).rejects.toThrow(/Ne pas combiner/i);
  });

  it("fast=true réduit l’échantillon effectif à 1", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const inv = await runInventoryAllLayers(cfg, {
      mode: "public",
      sampleLimit: 12,
      fast: true,
      targets: [{ serviceKey: "equipements", layerId: 5 }],
    });
    expect(inv.requestedSampleLimit).toBe(12);
    expect(inv.effectiveSampleLimit).toBe(1);
    expect(inv.source.execution.effectiveSampleLimit).toBe(1);
  });

  it("aggrège diagnostics quand une couche est en échec", async () => {
    const { restore } = installMockArcgisClient(
      defaultRegistryMatchers({ failForLayer: { servicePath: "EQUIPEMENTS/MapServer", layerId: 5 } }),
    );
    teardown = restore;
    const cfg = loadConfig();
    const inv = await runInventoryAllLayers(cfg, {
      mode: "public",
      sampleLimit: 3,
      targets: [{ serviceKey: "equipements", layerId: 5 }],
    });
    expect(inv.source.diagnostics.failedSamples).toBe(1);
    expect(inv.layers[0]?.sampleStatus).toBe("failed");
  });

  it("aucun champ sensible dans le payload sérialisé", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const inv = await runInventoryAllLayers(cfg, {
      mode: "public",
      sampleLimit: 3,
      serviceKeys: ["equipements"],
    });
    expectNoSensitive(JSON.stringify(inv));
  });
});

describe("V0.8 — rapports offline", () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it("generate_inventory_report fonctionne hors réseau", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const r = await runGenerateInventoryReport(cfg, {
      mode: "public",
      sampleLimit: 3,
      serviceKeys: ["equipements"],
      format: "json",
    });
    expect(r.structured.layersAnalyzed).toBeGreaterThan(0);
    expect(r.structured.source.schemaVersion).toBe("report.v1");
    expectNoSensitive(JSON.stringify(r.structured));
    expectNoSensitive(r.body);
  });

  it("generate_open_data_brief fonctionne hors réseau", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const r = await runGenerateOpenDataBrief(cfg, {
      mode: "public",
      sampleLimit: 3,
      serviceKeys: ["equipements"],
      format: "json",
    });
    expect(r.structured.source.schemaVersion).toBe("open_data.v1");
    expectNoSensitive(JSON.stringify(r.structured));
  });

  it("generate_chatbot_readiness_report fonctionne hors réseau", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const r = await runGenerateChatbotReadinessReport(cfg, {
      mode: "public",
      sampleLimit: 3,
      targets: [
        { serviceKey: "equipements", layerId: 5 },
        { serviceKey: "equipements", layerId: 0 },
      ],
      format: "json",
    });
    expect(r.structured.source.schemaVersion).toBe("chatbot_readiness.v1");
    expectNoSensitive(JSON.stringify(r.structured));
  });

  it("generate_layer_action_plan fonctionne hors réseau", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const r = await runGenerateLayerActionPlan(cfg, {
      serviceKey: "equipements",
      layerId: 5,
      mode: "public",
      sampleLimit: 3,
      format: "json",
    });
    expect(r.structured.source.schemaVersion).toBe("layer_action_plan.v1");
    expect(r.structured.serviceKey).toBe("equipements");
    expectNoSensitive(JSON.stringify(r.structured));
  });
});

describe("V0.8 — describe_layer sanitation (offline)", () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it("describe_layer ne fuit pas les champs sensibles même avec metadata-with-sensitive-fields", async () => {
    // On force la métadonnée WC à pointer sur la fixture sensible (couche 5 du registre).
    const { restore } = installMockArcgisClient([
      {
        match: metaMatcher("EQUIPEMENTS/MapServer", 5),
        fixture: "metadata-with-sensitive-fields.json",
      },
    ]);
    teardown = restore;
    const cfg = loadConfig();
    const r = await runDescribeLayer(cfg, "equipements", 5, "public", { includeRawMetadata: true });
    const s = JSON.stringify(r);
    expectNoSensitive(s);
    // editingInfo et templates retirés du sanitizedMetadataBundle
    expect(s).not.toContain("editingInfo");
    expect(s).not.toContain("internal-template");
  });
});
