import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { createAnnecySigMcpServer } from "../src/server.js";
import {
  REMOTE_INTERNAL_TOOLS_EXCLUDED,
  REMOTE_PUBLIC_TOOLS,
} from "../src/runtime/httpHandler.js";

/**
 * Tests anti-fuite V1.2 — garantissent que le remote public n'expose jamais
 * de chemin vers les données internes.
 *
 * Stratégie : on instancie un serveur MCP en config remote stricte
 * (publicOnly + allowInternalTools=false) et on vérifie via InMemoryTransport :
 *  - tools/list expose exactement le périmètre public (17 outils) ;
 *  - aucun outil internal n'apparaît ;
 *  - mode=internal sur un outil mode-aware → erreur FORBIDDEN claire ;
 *  - list_services en mode public → travaux/layersCount=0 + publicCitizenAccess.
 */

async function connect() {
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
    { name: "anti-leak-test", version: "1.0.0-rc.1" },
    { capabilities: {} },
  );
  await client.connect(clientT);
  return { client, server };
}

describe("V1.2 — anti-fuite outils internal", () => {
  it("tools/list expose strictement le périmètre public", async () => {
    const { client, server } = await connect();
    try {
      const list = await client.listTools();
      const names = list.tools.map(t => t.name).sort();
      expect(names).toEqual([...REMOTE_PUBLIC_TOOLS].sort());
      for (const t of REMOTE_INTERNAL_TOOLS_EXCLUDED) {
        expect(names).not.toContain(t);
      }
      // Vérification dure du compte.
      expect(names.length).toBe(REMOTE_PUBLIC_TOOLS.length);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("citizen_query est présent dans le périmètre public", async () => {
    const { client, server } = await connect();
    try {
      const list = await client.listTools();
      const names = list.tools.map(t => t.name);
      expect(names).toContain("citizen_query");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("mode=internal sur list_services → FORBIDDEN", async () => {
    const { client, server } = await connect();
    try {
      const r = await client.callTool({
        name: "list_services",
        arguments: { mode: "internal" },
      });
      expect(r.isError).toBe(true);
      const text = JSON.stringify(r);
      expect(text).toContain("FORBIDDEN");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("mode=internal sur query_layer → FORBIDDEN", async () => {
    const { client, server } = await connect();
    try {
      const r = await client.callTool({
        name: "query_layer",
        arguments: {
          serviceKey: "equipements",
          layerId: 5,
          mode: "internal",
        },
      });
      expect(r.isError).toBe(true);
      const text = JSON.stringify(r);
      expect(text).toContain("FORBIDDEN");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("query_layer sur service hors registre → erreur explicite", async () => {
    const { client, server } = await connect();
    try {
      const r = await client.callTool({
        name: "query_layer",
        arguments: {
          serviceKey: "service-inexistant",
          layerId: 999,
          mode: "public",
        },
      });
      expect(r.isError).toBe(true);
      const text = JSON.stringify(r);
      expect(text).toMatch(/NOT_FOUND|inconnu|non autorisé/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("list_services en mode public : travaux a layersCount=0 et publicCitizenAccess", async () => {
    const { client, server } = await connect();
    try {
      const r = await client.callTool({
        name: "list_services",
        arguments: { mode: "public" },
      });
      expect(r.isError).not.toBe(true);
      const text = (r.content as { type: string; text: string }[])[0]!.text;
      const payload = JSON.parse(text) as {
        services: {
          serviceKey: string;
          layersCount?: number;
          publicCitizenAccess?: { tools: string[] };
        }[];
      };
      const travaux = payload.services.find(s => s.serviceKey === "travaux");
      expect(travaux?.layersCount).toBe(0);
      expect(travaux?.publicCitizenAccess?.tools).toContain("list_public_works");
      expect(travaux?.publicCitizenAccess?.tools).toContain("search_public_works_nearby");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
