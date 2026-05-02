import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { createAnnecySigMcpServer } from "../src/server.js";
import {
  REMOTE_PUBLIC_TOOLS,
  REMOTE_INTERNAL_TOOLS_EXCLUDED,
  handleHttpHealthRequest,
  handleHttpMcpRequest,
} from "../src/runtime/httpHandler.js";

/**
 * V1.0 — Transport HTTP remote (Vercel)
 *
 * Couvre :
 *   1. La fabrique `createAnnecySigMcpServer({ publicOnly: true })` :
 *      - n'enregistre PAS les outils internal (`generate_internal_dashboard_brief`,
 *        `list_current_works`, `list_late_works`) si `allowInternalTools=false` ;
 *      - refuse explicitement `mode=internal` sur les outils acceptant `mode`.
 *   2. `/api/health` ne fait aucun appel ArcGIS et renvoie l'enveloppe attendue.
 *   3. L'auth Bearer du handler HTTP :
 *      - sans token configuré → tout passe ;
 *      - avec token configuré → 401 sans en-tête, 401 si mauvais token,
 *        2xx avec le bon token.
 *
 * On utilise `InMemoryTransport` pour les vérifs MCP (couvre serveur + outils),
 * et un Request Web standard pour les vérifs HTTP (auth, health).
 */

const SMOKE_TOKEN = "test-token-not-a-secret";

async function connectInMemory(server: Awaited<ReturnType<typeof createAnnecySigMcpServer>>) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client(
    { name: "remote-http-test", version: "1.0.0-rc.1" },
    { capabilities: {} },
  );
  await client.connect(clientT);
  return { client, server };
}

describe("V1.0 — createAnnecySigMcpServer en mode remote public", () => {
  it("n'enregistre pas les outils internal-only quand allowInternalTools=false", async () => {
    const cfg = loadConfig();
    const server = createAnnecySigMcpServer(cfg, {
      transport: "http",
      publicOnly: true,
      allowInternalTools: false,
      defaultMode: "public",
    });
    const { client } = await connectInMemory(server);
    try {
      const list = await client.listTools();
      const names = list.tools.map(t => t.name);

      for (const t of REMOTE_PUBLIC_TOOLS) {
        expect(names, `outil public manquant : ${t}`).toContain(t);
      }
      for (const t of REMOTE_INTERNAL_TOOLS_EXCLUDED) {
        expect(names, `outil internal exposé alors qu'il devrait être masqué : ${t}`).not.toContain(t);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("refuse explicitement mode=internal côté outil avec un message clair", async () => {
    const cfg = loadConfig();
    const server = createAnnecySigMcpServer(cfg, {
      transport: "http",
      publicOnly: true,
      allowInternalTools: false,
      defaultMode: "public",
    });
    const { client } = await connectInMemory(server);
    try {
      const r = await client.callTool({
        name: "list_services",
        arguments: { mode: "internal" },
      });
      expect(r.isError).toBe(true);
      const text = JSON.stringify(r);
      expect(text).toMatch(/HTTP public n'autorise pas le mode internal/);
      expect(text).toMatch(/MCP local stdio/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("laisse passer mode=public et délivre le payload list_services attendu", async () => {
    const cfg = loadConfig();
    const server = createAnnecySigMcpServer(cfg, {
      transport: "http",
      publicOnly: true,
      allowInternalTools: false,
      defaultMode: "public",
    });
    const { client } = await connectInMemory(server);
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
          publicCitizenAccess?: { tools: string[]; explanation: string };
        }[];
      };
      const keys = payload.services.map(s => s.serviceKey);
      // En mode public, le service `travaux` n'a aucune couche visible mais
      // peut être listé selon `runListServices` ; on vérifie au moins
      // équipements et mobilité.
      expect(keys).toContain("equipements");
      expect(keys).toContain("mobilite");
      const travaux = payload.services.find(s => s.serviceKey === "travaux");
      expect(travaux?.layersCount).toBe(0);
      expect(travaux?.publicCitizenAccess?.tools).toEqual([
        "list_public_works",
        "search_public_works_nearby",
      ]);
      expect(travaux?.publicCitizenAccess?.explanation).toMatch(/vue citoyenne filtrée/i);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("expose les outils internal quand allowInternalTools=true (mode local)", async () => {
    const cfg = loadConfig();
    const server = createAnnecySigMcpServer(cfg, {
      transport: "stdio",
      publicOnly: false,
      allowInternalTools: true,
      defaultMode: "public",
    });
    const { client } = await connectInMemory(server);
    try {
      const list = await client.listTools();
      const names = list.tools.map(t => t.name);
      for (const t of REMOTE_INTERNAL_TOOLS_EXCLUDED) {
        expect(names, `outil internal absent en mode local : ${t}`).toContain(t);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("V1.0 — handleHttpHealthRequest", () => {
  const original = { ...process.env };
  beforeEach(() => {
    delete process.env.MCP_PUBLIC_READ_TOKEN;
    delete process.env.REMOTE_ALLOW_INTERNAL_TOOLS;
    process.env.REMOTE_PUBLIC_ONLY = "true";
    process.env.DEFAULT_MODE = "public";
  });
  afterEach(() => {
    for (const k of [
      "MCP_PUBLIC_READ_TOKEN",
      "REMOTE_ALLOW_INTERNAL_TOOLS",
      "REMOTE_PUBLIC_ONLY",
      "DEFAULT_MODE",
    ]) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("retourne status=ok sans appeler ArcGIS et sans exiger d'auth", async () => {
    const res = handleHttpHealthRequest(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.transport).toBe("http");
    expect(body.server).toBe("annecy-sig-mcp");
    expect(body.publicOnly).toBe(true);
    expect(body.internalToolsAllowed).toBe(false);
    expect(body.bearerRequired).toBe(false);
    expect(typeof body.serverVersion).toBe("string");
  });

  it("indique bearerRequired=true quand MCP_PUBLIC_READ_TOKEN est défini", async () => {
    process.env.MCP_PUBLIC_READ_TOKEN = SMOKE_TOKEN;
    const res = handleHttpHealthRequest(new Request("http://localhost/api/health"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.bearerRequired).toBe(true);
  });
});

describe("V1.0 — handleHttpMcpRequest auth Bearer", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.REMOTE_PUBLIC_ONLY = "true";
    process.env.REMOTE_ALLOW_INTERNAL_TOOLS = "false";
    process.env.DEFAULT_MODE = "public";
  });
  afterEach(() => {
    for (const k of [
      "MCP_PUBLIC_READ_TOKEN",
      "REMOTE_ALLOW_INTERNAL_TOOLS",
      "REMOTE_PUBLIC_ONLY",
      "DEFAULT_MODE",
    ]) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  function jsonRpcRequest(body: unknown, headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  it("sans MCP_PUBLIC_READ_TOKEN : laisse passer (utile en local)", async () => {
    delete process.env.MCP_PUBLIC_READ_TOKEN;
    const req = jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "noauth", version: "1.0.0-rc.1" },
      },
    });
    const res = await handleHttpMcpRequest(req);
    // Doit être un succès JSON-RPC (200), pas un 401.
    expect(res.status).not.toBe(401);
  });

  it("avec MCP_PUBLIC_READ_TOKEN : 401 sans Authorization", async () => {
    process.env.MCP_PUBLIC_READ_TOKEN = SMOKE_TOKEN;
    const req = jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "1" } },
    });
    const res = await handleHttpMcpRequest(req);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("avec MCP_PUBLIC_READ_TOKEN : 401 si mauvais Bearer", async () => {
    process.env.MCP_PUBLIC_READ_TOKEN = SMOKE_TOKEN;
    const req = jsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "1" } },
      },
      { authorization: "Bearer wrong-token" },
    );
    const res = await handleHttpMcpRequest(req);
    expect(res.status).toBe(401);
  });

  it("avec MCP_PUBLIC_READ_TOKEN : succès si bon Bearer", async () => {
    process.env.MCP_PUBLIC_READ_TOKEN = SMOKE_TOKEN;
    const req = jsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "1" } },
      },
      { authorization: `Bearer ${SMOKE_TOKEN}` },
    );
    const res = await handleHttpMcpRequest(req);
    expect(res.status).not.toBe(401);
  });

  it("OPTIONS (CORS preflight) : 204 sans appel MCP", async () => {
    process.env.MCP_PUBLIC_READ_TOKEN = SMOKE_TOKEN;
    const req = new Request("http://localhost/api/mcp", { method: "OPTIONS" });
    const res = await handleHttpMcpRequest(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});
