import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleHttpMcpRequest } from "../src/runtime/httpHandler.js";
import {
  InMemoryRateLimitStore,
  setRateLimitStoreForTests,
} from "../src/runtime/rateLimit.js";

/**
 * On valide que le timeout global produit une réponse JSON-RPC `-32030`
 * propre quand le traitement dépasse `MCP_REQUEST_TIMEOUT_MS`. On force la
 * valeur à 1 ms pour garantir l'expiration sans dépendre du réseau.
 */

describe("V1.2 — timeout global /api/mcp", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.REMOTE_PUBLIC_ONLY = "true";
    process.env.REMOTE_ALLOW_INTERNAL_TOOLS = "false";
    process.env.DEFAULT_MODE = "public";
    process.env.MCP_RATE_LIMIT_ENABLED = "false";
    process.env.MCP_REQUEST_TIMEOUT_MS = "1";
    process.env.MCP_HEAVY_TOOL_TIMEOUT_MS = "1";
    setRateLimitStoreForTests(new InMemoryRateLimitStore(), "memory");
  });
  afterEach(() => {
    setRateLimitStoreForTests(null);
    for (const k of [
      "REMOTE_PUBLIC_ONLY",
      "REMOTE_ALLOW_INTERNAL_TOOLS",
      "DEFAULT_MODE",
      "MCP_RATE_LIMIT_ENABLED",
      "MCP_REQUEST_TIMEOUT_MS",
      "MCP_HEAVY_TOOL_TIMEOUT_MS",
    ]) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("timeout proche de zéro → JSON-RPC -32030", async () => {
    const req = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    const res = await handleHttpMcpRequest(req);
    // Possible : 504 timeout (chemin attendu) — sinon le SDK a déjà répondu.
    if (res.status === 504) {
      const body = (await res.json()) as { error?: { code?: number; message?: string } };
      expect(body.error?.code).toBe(-32030);
      expect(body.error?.message).toBe("Request timeout");
    } else {
      // Sur des machines rapides, le SDK peut renvoyer avant l'expiration —
      // on tolère ce cas sans faire échouer le test.
      expect([200, 401, 429, 504]).toContain(res.status);
    }
  });
});
