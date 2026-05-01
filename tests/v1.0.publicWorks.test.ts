import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { createAnnecySigMcpServer } from "../src/server.js";
import {
  REMOTE_PUBLIC_TOOLS,
  REMOTE_INTERNAL_TOOLS_EXCLUDED,
  handleHttpMcpRequest,
} from "../src/runtime/httpHandler.js";
import {
  PUBLIC_WORKS_ALLOWED_OUT_FIELDS,
  PUBLIC_WORKS_FORBIDDEN_KEY_SUBSTRINGS,
  assertNoSensitivePublicWorkKeys,
  buildPublicWorkSector,
  buildPublicWorkTitle,
  normalizePublicWorkFeature,
  redactPublicWorkGeometry,
  runListPublicWorks,
  runSearchPublicWorksNearby,
  simplifyWorkStatus,
} from "../src/tools/publicWorks.js";
import { buildPublicWorkId } from "../src/utils/publicId.js";
import {
  PublicWorksNearbyResultSchema,
  PublicWorksResultSchema,
} from "../src/contracts/publicWorksContracts.js";
import {
  installMockArcgisClient,
  loadFixture,
  queryMatcher,
} from "./helpers/mockArcgisClient.js";

/**
 * V1.0 — Tests « travaux public-light ».
 *
 * Garanties vérifiées :
 *   1. `normalizePublicWorkFeature` retire systématiquement tout champ sensible.
 *   2. Les sorties JSON ne contiennent **aucun** des marqueurs interdits.
 *   3. `runListPublicWorks` refuse `mode=internal`.
 *   4. La source porte `schemaVersion=public_works.v1` + `rawLayerExposed=false`.
 *   5. `runSearchPublicWorksNearby` plafonne le rayon (cf. parseRadiusMeters).
 *   6. La recherche ne plante pas sur des features sans géométrie.
 *   7. Les outils sont exposés dans le périmètre HTTP public et **pas** comptés
 *      parmi les outils internal exclus.
 */

const TRAVAUX_PATH = "TRAVAUX/MapServer";
const TRAVAUX_LAYER = 3;

/**
 * Liste de marqueurs interdits dans `JSON.stringify(payload)`. Le test compare
 * en lower-case, ce qui couvre `OBJECTID` (vu comme `objectid`).
 */
const SENSITIVE_NEEDLES = [
  "url_pj",
  "url_piece_jointe",
  "attachment",
  "ac_odp_ref",
  "created_user",
  "created_date",
  "last_edited_user",
  "last_edited_date",
  "token",
  "password",
  "secret",
  "bearer",
  "objectid",
] as const;

function expectNoSensitive(label: string, content: string): void {
  const low = content.toLowerCase();
  for (const n of SENSITIVE_NEEDLES) {
    expect(low.includes(n), `${label} doit éviter "${n}"`).toBe(false);
  }
}

describe("V1.0 — normalizePublicWorkFeature (filtrage strict)", () => {
  it("ne retourne aucune clé sensible même si la source en injecte (fixture sensible)", () => {
    const fixture = loadFixture("travaux-sensitive-query-esri") as {
      features: { attributes: Record<string, unknown>; geometry: unknown }[];
    };
    const f = fixture.features[0]!;
    const item = normalizePublicWorkFeature({
      properties: f.attributes,
      geometry: f.geometry,
      includeGeometry: false,
    });
    expectNoSensitive("normalizePublicWorkFeature", JSON.stringify(item));
    // Vérifie aussi qu'aucun champ interdit n'apparaît même comme clé.
    for (const forbidden of PUBLIC_WORKS_FORBIDDEN_KEY_SUBSTRINGS) {
      const keys = Object.keys(item).join("|").toLowerCase();
      expect(keys.includes(forbidden), `clé sensible "${forbidden}" présente`).toBe(false);
    }
    // Champs autorisés présents — id_public opaque, jamais préfixe "pw-" hérité.
    expect(item.id_public).toMatch(/^pw_[0-9a-f]{12}$/);
    expect(item.statut_public).toBe("En cours");
    expect(item.titre_public).toBeTruthy();
    expect(item.qualityFlags.missingGeometry).toBe(true);
  });

  it("id_public est opaque, ne contient pas l'OBJECTID brut, et est stable + déterministe", () => {
    process.env.PUBLIC_WORK_ID_SALT = "test-salt-fixed-for-determinism";
    const make = (objectid: number) =>
      normalizePublicWorkFeature({
        properties: {
          OBJECTID: objectid,
          titre: "Travaux test",
          ac_date_debut: 1764547200000,
          ac_date_fin: 1767139200000,
          controle_resultat: "En cours",
          adresse: "Test",
          commune_deleguee: "Annecy",
        },
        geometry: null,
        includeGeometry: false,
      });

    const a = make(424242);
    const b = make(99999);
    const aBis = make(424242);

    expect(a.id_public).toMatch(/^pw_[0-9a-f]{12}$/);
    expect(b.id_public).toMatch(/^pw_[0-9a-f]{12}$/);
    // Stable pour le même OBJECTID.
    expect(aBis.id_public).toBe(a.id_public);
    // Deux entités différentes => deux ids différents.
    expect(a.id_public).not.toBe(b.id_public);
    // Aucune partie de l'OBJECTID brut n'apparaît dans l'id ni dans le payload.
    expect(a.id_public).not.toContain("424242");
    expect(b.id_public).not.toContain("99999");
    expect(JSON.stringify(a)).not.toContain("424242");
    expect(JSON.stringify(a).toLowerCase()).not.toContain("objectid");
    delete process.env.PUBLIC_WORK_ID_SALT;
  });

  it("id_public dépend du salt — un salt différent change le hash", () => {
    process.env.PUBLIC_WORK_ID_SALT = "salt-A";
    const a = buildPublicWorkId("travaux", 3, 12345);
    process.env.PUBLIC_WORK_ID_SALT = "salt-B";
    const b = buildPublicWorkId("travaux", 3, 12345);
    delete process.env.PUBLIC_WORK_ID_SALT;
    expect(a).toMatch(/^pw_[0-9a-f]{12}$/);
    expect(b).toMatch(/^pw_[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it("ne retourne pas url_pj / url_piece_jointe / attachment", () => {
    const item = normalizePublicWorkFeature({
      properties: {
        OBJECTID: 1,
        url_pj: "https://x/file.pdf",
        url_piece_jointe: "https://x/file2.pdf",
        attachment: "https://x/file3.pdf",
        titre: "Test",
        ac_date_debut: 1764547200000,
        ac_date_fin: 1767139200000,
        controle_resultat: "En cours",
        adresse: "Test",
        commune_deleguee: "Annecy",
      },
      geometry: { type: "Point", coordinates: [6.13, 45.9] },
      includeGeometry: false,
    });
    const text = JSON.stringify(item).toLowerCase();
    expect(text).not.toContain("url_pj");
    expect(text).not.toContain("url_piece_jointe");
    expect(text).not.toContain("attachment");
  });

  it("ne retourne pas created_user / last_edited_user / token / password / secret / bearer", () => {
    const item = normalizePublicWorkFeature({
      properties: {
        OBJECTID: 2,
        created_user: "AGENT_X",
        last_edited_user: "AGENT_Y",
        token: "leaked-token",
        password: "leaked-password",
        secret: "leaked-secret",
        bearer: "Bearer leaked",
        titre: "Test",
        controle_resultat: "Pas commencé",
        ac_date_debut: 1767139200000,
        ac_date_fin: 1769817600000,
      },
      geometry: null,
    });
    const text = JSON.stringify(item).toLowerCase();
    for (const forbidden of [
      "created_user",
      "last_edited_user",
      "token",
      "password",
      "secret",
      "bearer",
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(item.statut_public).toBe("À venir");
  });

  it("assertNoSensitivePublicWorkKeys lève si une clé interdite est insérée à dessein", () => {
    expect(() =>
      assertNoSensitivePublicWorkKeys({ id_public: "pw_aaaaaaaaaaaa", url_pj: "x" }),
    ).toThrow(/Fuite potentielle/);
    expect(() =>
      assertNoSensitivePublicWorkKeys({
        id_public: "pw_aaaaaaaaaaaa",
        nested: { token: "x" },
      }),
    ).toThrow(/Fuite potentielle/);
  });
});

describe("V1.0 — helpers public-light", () => {
  it("simplifyWorkStatus mappe les statuts métiers connus", () => {
    expect(simplifyWorkStatus("En cours")).toBe("En cours");
    expect(simplifyWorkStatus("Pas commencé")).toBe("À venir");
    expect(simplifyWorkStatus("En cours hors délai")).toBe("En retard");
    expect(simplifyWorkStatus("En réfection provisoire")).toBe("Réfection provisoire");
    expect(simplifyWorkStatus("En réfection définitive")).toBe("Réfection définitive");
    expect(simplifyWorkStatus("statut bizarre")).toBe("Statut non renseigné");
    expect(simplifyWorkStatus(undefined)).toBe("Statut non renseigné");
  });

  it("buildPublicWorkTitle masque les titres génériques avec numéro d’arrêté", () => {
    expect(buildPublicWorkTitle("Travaux suivant l’arrêté 12345")).toBe("Travaux sur voirie");
    expect(buildPublicWorkTitle("")).toBe("Travaux sur voirie");
    expect(buildPublicWorkTitle("Réfection trottoir Albigny")).toBe("Réfection trottoir Albigny");
  });

  it("buildPublicWorkSector retombe sur commune si adresse manquante", () => {
    expect(buildPublicWorkSector("12 rue X", "Annecy")).toBe("12 rue X");
    expect(buildPublicWorkSector("", "Annecy")).toBe("Annecy");
    expect(buildPublicWorkSector(null, "")).toBeNull();
  });

  it("redactPublicWorkGeometry retire la géométrie si includeGeometry=false", () => {
    expect(redactPublicWorkGeometry({ type: "Point", coordinates: [1, 2] }, false).include).toBe(false);
    expect(redactPublicWorkGeometry({ type: "Point", coordinates: [1, 2] }, true).include).toBe(true);
    expect(redactPublicWorkGeometry(null, true).include).toBe(false);
  });
});

describe("V1.0 — runListPublicWorks (intégration via mock ArcGIS)", () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it("refuse explicitement mode=internal", async () => {
    const cfg = loadConfig();
    await expect(
      // @ts-expect-error : on force volontairement le mauvais mode.
      runListPublicWorks(cfg, { mode: "internal" }),
    ).rejects.toThrow(/n’acceptent que mode=public|mode=public/);
  });

  it("retourne un payload conforme au contrat public_works.v1 (schémaVersion + rawLayerExposed)", async () => {
    const { restore } = installMockArcgisClient([
      {
        match: queryMatcher(TRAVAUX_PATH, TRAVAUX_LAYER),
        fixture: "travaux-query-esri.json",
        label: "travaux-public",
      },
    ]);
    teardown = restore;
    const cfg = loadConfig();
    const r = await runListPublicWorks(cfg, { mode: "public", status: "all", limit: 5 });
    const parsed = PublicWorksResultSchema.safeParse(r);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.format())).toBe(true);
    expect(r.source.schemaVersion).toBe("public_works.v1");
    expect(r.source.rawLayerExposed).toBe(false);
    expect(r.source.filtered).toBe(true);
    expect(r.source.mode).toBe("public");
    expect(r.items.length).toBeGreaterThan(0);
    // Aucun marqueur sensible dans le payload sérialisé.
    expectNoSensitive("runListPublicWorks payload", JSON.stringify(r));
  });

  it("plafonne limit à 100", async () => {
    const { restore } = installMockArcgisClient([
      {
        match: queryMatcher(TRAVAUX_PATH, TRAVAUX_LAYER),
        body: { type: "FeatureCollection", features: [] },
        label: "travaux-empty",
      },
    ]);
    teardown = restore;
    const cfg = loadConfig();
    const r = await runListPublicWorks(cfg, { mode: "public", limit: 9999, status: "all" });
    expect(r.count).toBe(0);
    // On ne peut pas observer la limite envoyée à ArcGIS depuis ici, mais le
    // code clamp à 100 dans `clampLimit`. Le test garantit au moins l’absence
    // de plantage et la conformité du payload.
    expect(r.source.schemaVersion).toBe("public_works.v1");
  });
});

describe("V1.0 — runSearchPublicWorksNearby", () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it("plafonne le rayon par MAX_SEARCH_RADIUS_METERS", async () => {
    const cfg = loadConfig();
    await expect(
      runSearchPublicWorksNearby(cfg, {
        latitude: 45.9,
        longitude: 6.13,
        radiusMeters: 999_999,
      }),
    ).rejects.toThrow(/radiusMeters/);
  });

  it("ne plante pas si certaines features ont une géométrie nulle, et retourne des distances valides pour les autres", async () => {
    const { restore } = installMockArcgisClient([
      {
        match: queryMatcher(TRAVAUX_PATH, TRAVAUX_LAYER),
        fixture: "travaux-query-esri.json",
        label: "travaux-nearby",
      },
    ]);
    teardown = restore;
    const cfg = loadConfig();
    const r = await runSearchPublicWorksNearby(cfg, {
      latitude: 45.903,
      longitude: 6.14,
      radiusMeters: 5000,
      includeGeometry: false,
    });
    const parsed = PublicWorksNearbyResultSchema.safeParse(r);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.format())).toBe(true);
    expect(r.source.schemaVersion).toBe("public_works.v1");
    expect(r.source.rawLayerExposed).toBe(false);
    expectNoSensitive("runSearchPublicWorksNearby payload", JSON.stringify(r));
    // L'entité avec geometry null doit avoir été ignorée → on garde au moins
    // une entité (la première de la fixture, polygone exploitable).
    expect(r.items.length).toBeGreaterThan(0);
    for (const item of r.items) {
      expect(typeof item.distance_m).toBe("number");
      expect(item.distance_m).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("V1.0 — registration dans le serveur MCP", () => {
  async function listToolsForRuntime(opts: {
    publicOnly: boolean;
    allowInternalTools: boolean;
  }): Promise<string[]> {
    const cfg = loadConfig();
    const server = createAnnecySigMcpServer(cfg, {
      transport: opts.publicOnly ? "http" : "stdio",
      publicOnly: opts.publicOnly,
      allowInternalTools: opts.allowInternalTools,
      defaultMode: "public",
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client(
      { name: "publicworks-test", version: "1.0.0-rc.1" },
      { capabilities: {} },
    );
    await client.connect(clientT);
    try {
      const list = await client.listTools();
      return list.tools.map(t => t.name);
    } finally {
      await client.close();
      await server.close();
    }
  }

  it("expose list_public_works et search_public_works_nearby sur le remote public", async () => {
    const names = await listToolsForRuntime({ publicOnly: true, allowInternalTools: false });
    expect(names).toContain("list_public_works");
    expect(names).toContain("search_public_works_nearby");
    // Et toujours pas les outils internal-only.
    for (const t of REMOTE_INTERNAL_TOOLS_EXCLUDED) {
      expect(names).not.toContain(t);
    }
    // Confirme que le périmètre public attendu (15 outils) est présent.
    for (const t of REMOTE_PUBLIC_TOOLS) {
      expect(names, `outil public manquant : ${t}`).toContain(t);
    }
  });

  it("expose aussi les deux outils en stdio local sans toucher aux internal", async () => {
    const names = await listToolsForRuntime({ publicOnly: false, allowInternalTools: true });
    expect(names).toContain("list_public_works");
    expect(names).toContain("search_public_works_nearby");
    expect(names).toContain("list_current_works");
    expect(names).toContain("list_late_works");
    expect(names).toContain("generate_internal_dashboard_brief");
  });

  it("le call list_public_works refuse mode=internal côté remote public", async () => {
    const cfg = loadConfig();
    const server = createAnnecySigMcpServer(cfg, {
      transport: "http",
      publicOnly: true,
      allowInternalTools: false,
      defaultMode: "public",
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client(
      { name: "publicworks-test-internal", version: "1.0.0-rc.1" },
      { capabilities: {} },
    );
    await client.connect(clientT);
    try {
      const r = await client.callTool({
        name: "list_public_works",
        arguments: { mode: "internal" },
      });
      // Note : Zod côté SDK rejette d’abord le mode (z.literal("public")).
      expect(r.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("V1.0 — allowlist outFields", () => {
  it("ne contient que des champs sûrs (pas de motif sensible)", () => {
    // `objectid` est volontairement demandé à ArcGIS (en INPUT) pour calculer
    // le hash `id_public`, mais il n'est jamais ré-émis en OUTPUT — la sortie
    // est verrouillée par `assertNoSensitivePublicWorkKeys` et les checks
    // `JSON.stringify` plus haut. On l'exclut donc de cette assertion qui
    // porte sur l'allowlist d'inputs.
    const FORBIDDEN_INPUT_SUBSTRINGS = PUBLIC_WORKS_FORBIDDEN_KEY_SUBSTRINGS.filter(
      s => s !== "objectid",
    );
    for (const field of PUBLIC_WORKS_ALLOWED_OUT_FIELDS) {
      const lower = field.toLowerCase();
      for (const forbidden of FORBIDDEN_INPUT_SUBSTRINGS) {
        expect(
          lower.includes(forbidden),
          `outField "${field}" contient un motif sensible "${forbidden}"`,
        ).toBe(false);
      }
    }
  });
});

describe("V1.0 — CORS / OPTIONS sur /api/mcp", () => {
  it("OPTIONS /api/mcp retourne les headers CORS attendus (sans cookies, sans DELETE)", async () => {
    const req = new Request("https://mcp.example.test/api/mcp", {
      method: "OPTIONS",
      headers: {
        origin: "https://copilot.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type, mcp-protocol-version",
      },
    });
    const res = await handleHttpMcpRequest(req);
    expect(res.status).toBe(204);

    const allowOrigin = res.headers.get("access-control-allow-origin");
    const allowHeaders = res.headers.get("access-control-allow-headers");
    const allowMethods = res.headers.get("access-control-allow-methods");
    const allowCreds = res.headers.get("access-control-allow-credentials");

    expect(allowOrigin).toBe("*");
    expect(allowHeaders).toBe("Authorization, Content-Type, MCP-Protocol-Version");
    expect(allowMethods).toBe("GET, POST, OPTIONS");
    // Pas de cookies autorisés sur le transport public.
    expect(allowCreds).toBeNull();
    // Pas de DELETE (stateless, aucune session à fermer).
    expect(allowMethods?.toUpperCase()).not.toContain("DELETE");
    // Pas de mcp-session-id (inutile en stateless).
    expect(allowHeaders?.toLowerCase()).not.toContain("mcp-session-id");
  });

  it("les vraies réponses (POST) propagent aussi les headers CORS", async () => {
    // Requête JSON-RPC vide, mal formée volontairement : le handler doit
    // quand même répondre avec les headers CORS, sans logger le Authorization.
    const req = new Request("https://mcp.example.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const res = await handleHttpMcpRequest(req);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});
