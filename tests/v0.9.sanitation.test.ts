import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { runGenerateInventoryReport } from "../src/tools/generateInventoryReport.js";
import { runGenerateOpenDataBrief } from "../src/tools/generateOpenDataBrief.js";
import { runGenerateChatbotReadinessReport } from "../src/tools/generateChatbotReadinessReport.js";
import { runGenerateLayerActionPlan } from "../src/tools/generateLayerActionPlan.js";
import { runGenerateInternalDashboardBrief } from "../src/tools/generateInternalDashboardBrief.js";
import {
  defaultRegistryMatchers,
  installMockArcgisClient,
  queryMatcher,
} from "./helpers/mockArcgisClient.js";

/**
 * V0.9 — Sanitation renforcée.
 *
 * On vérifie qu’**aucun** des marqueurs sensibles ne fuit dans :
 * - le payload structuré (JSON)
 * - le rendu Markdown
 * - le `body` final exporté
 *
 * pour chacun des cinq rapports `generate_*`. Le test du dashboard interne
 * utilise une fixture travaux qui injecte volontairement créateur, dates
 * d’édition, pièces jointes, token, password, secret, bearer, attachment —
 * et confirme qu’aucun ne ressort.
 */
const SENSITIVE_NEEDLES = [
  "created_user",
  "created_date",
  "last_edited_user",
  "last_edited_date",
  "token",
  "password",
  "secret",
  "url_piece_jointe",
  "url_pj",
  "attachment",
  "bearer",
] as const;

function expectNoSensitive(label: string, content: string): void {
  const low = content.toLowerCase();
  for (const n of SENSITIVE_NEEDLES) {
    expect(low.includes(n), `${label} doit éviter "${n}"`).toBe(false);
  }
}

describe("V0.9 — sanitation des exports (json + markdown)", () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it("generate_inventory_report : ni JSON ni Markdown ne contiennent de marqueur sensible", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const json = await runGenerateInventoryReport(cfg, {
      mode: "public",
      sampleLimit: 3,
      serviceKeys: ["equipements"],
      format: "json",
    });
    expectNoSensitive("inventory-report.json (structured)", JSON.stringify(json.structured));
    expectNoSensitive("inventory-report.json (body)", json.body);
    const md = await runGenerateInventoryReport(cfg, {
      mode: "public",
      sampleLimit: 3,
      serviceKeys: ["equipements"],
      format: "markdown",
    });
    expectNoSensitive("inventory-report.md", md.body);
  });

  it("generate_open_data_brief : ni JSON ni Markdown ne contiennent de marqueur sensible", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const r = await runGenerateOpenDataBrief(cfg, {
      mode: "public",
      sampleLimit: 3,
      serviceKeys: ["equipements"],
      format: "json",
    });
    expectNoSensitive("open-data-brief.json (structured)", JSON.stringify(r.structured));
    expectNoSensitive("open-data-brief.json (body)", r.body);
    const md = await runGenerateOpenDataBrief(cfg, {
      mode: "public",
      sampleLimit: 3,
      serviceKeys: ["equipements"],
      format: "markdown",
    });
    expectNoSensitive("open-data-brief.md", md.body);
  });

  it("generate_chatbot_readiness_report : ni JSON ni Markdown ne contiennent de marqueur sensible", async () => {
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
    expectNoSensitive("chatbot.json (structured)", JSON.stringify(r.structured));
    expectNoSensitive("chatbot.json (body)", r.body);
    const md = await runGenerateChatbotReadinessReport(cfg, {
      mode: "public",
      sampleLimit: 3,
      targets: [
        { serviceKey: "equipements", layerId: 5 },
        { serviceKey: "equipements", layerId: 0 },
      ],
      format: "markdown",
    });
    expectNoSensitive("chatbot.md", md.body);
  });

  it("generate_layer_action_plan : ni JSON ni Markdown ne contiennent de marqueur sensible", async () => {
    const { restore } = installMockArcgisClient(defaultRegistryMatchers());
    teardown = restore;
    const cfg = loadConfig();
    const r = await runGenerateLayerActionPlan(cfg, {
      serviceKey: "equipements",
      layerId: 5,
      mode: "public",
      sampleLimit: 3,
      fast: true,
      format: "json",
    });
    expectNoSensitive("layer-action-plan.json (structured)", JSON.stringify(r.structured));
    expectNoSensitive("layer-action-plan.json (body)", r.body);
    const md = await runGenerateLayerActionPlan(cfg, {
      serviceKey: "equipements",
      layerId: 5,
      mode: "public",
      sampleLimit: 3,
      fast: true,
      format: "markdown",
    });
    expectNoSensitive("layer-action-plan.md", md.body);
  });

  it("generate_internal_dashboard_brief : aucune fuite même avec fixture travaux ‘sensitive’", async () => {
    // Fixture qui inclut volontairement created_user, last_edited_user, url_pj, token, password,
    // secret, bearer, attachment — la chaîne de redaction `normalizeTravauxFeature` +
    // `redactTravail` doit tout retirer du brief.
    const { restore } = installMockArcgisClient([
      {
        match: queryMatcher("TRAVAUX/MapServer", 3),
        fixture: "travaux-sensitive-query-esri.json",
        label: "travaux-sensitive",
      },
    ]);
    teardown = restore;
    const cfg = loadConfig();
    const json = await runGenerateInternalDashboardBrief(cfg, {
      mode: "internal",
      date: "2026-04-30",
      format: "json",
    });
    expectNoSensitive("dashboard.json (structured)", JSON.stringify(json.structured));
    expectNoSensitive("dashboard.json (body)", json.body);

    const md = await runGenerateInternalDashboardBrief(cfg, {
      mode: "internal",
      date: "2026-04-30",
      format: "markdown",
    });
    expectNoSensitive("dashboard.md", md.body);
  });
});
