import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildRateLimitedResponse,
  evaluateRateLimit,
  getClientIp,
  HEAVY_TOOL_NAMES,
  InMemoryRateLimitStore,
  redactIp,
  setRateLimitStoreForTests,
} from "../src/runtime/rateLimit.js";
import { handleHttpMcpRequest } from "../src/runtime/httpHandler.js";

describe("V1.2 — InMemoryRateLimitStore", () => {
  it("compte par fenêtre et expire après windowMs", async () => {
    const store = new InMemoryRateLimitStore();
    const w = 50;
    const a = await store.increment("k", w);
    const b = await store.increment("k", w);
    expect(a.count).toBe(1);
    expect(b.count).toBe(2);
    await new Promise(r => setTimeout(r, w + 10));
    const c = await store.increment("k", w);
    expect(c.count).toBe(1);
  });
});

describe("V1.2 — evaluateRateLimit", () => {
  it("désactivé → ok=true sans incrément", async () => {
    const store = new InMemoryRateLimitStore();
    const r = await evaluateRateLimit(
      store,
      { enabled: false, ipPerMinute: 1, globalPerMinute: 1, heavyToolPerHour: 1 },
      { ip: "1.1.1.1" },
    );
    expect(r.ok).toBe(true);
    expect(store.size()).toBe(0);
  });

  it("limite IP : 429 au 2e appel quand ipPerMinute=1", async () => {
    const store = new InMemoryRateLimitStore();
    const cfg = { enabled: true, ipPerMinute: 1, globalPerMinute: 100, heavyToolPerHour: 100 };
    const a = await evaluateRateLimit(store, cfg, { ip: "1.1.1.1" });
    expect(a.ok).toBe(true);
    const b = await evaluateRateLimit(store, cfg, { ip: "1.1.1.1" });
    expect(b.ok).toBe(false);
    expect(b.reason).toBe("ip-per-minute");
    expect(b.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("limite globale : indépendamment de l'IP", async () => {
    const store = new InMemoryRateLimitStore();
    const cfg = { enabled: true, ipPerMinute: 100, globalPerMinute: 1, heavyToolPerHour: 100 };
    const a = await evaluateRateLimit(store, cfg, { ip: "1.1.1.1" });
    expect(a.ok).toBe(true);
    const b = await evaluateRateLimit(store, cfg, { ip: "2.2.2.2" });
    expect(b.ok).toBe(false);
    expect(b.reason).toBe("global-per-minute");
  });

  it("limite outil lourd : 429 quand heavyToolPerHour=1", async () => {
    const store = new InMemoryRateLimitStore();
    const cfg = { enabled: true, ipPerMinute: 100, globalPerMinute: 100, heavyToolPerHour: 1 };
    const a = await evaluateRateLimit(store, cfg, {
      ip: "1.1.1.1",
      toolName: "inventory_all_layers",
    });
    expect(a.ok).toBe(true);
    const b = await evaluateRateLimit(store, cfg, {
      ip: "1.1.1.1",
      toolName: "inventory_all_layers",
    });
    expect(b.ok).toBe(false);
    expect(b.reason).toBe("heavy-tool-per-hour");
  });

  it("outil léger ne consomme pas le quota heavy", async () => {
    const store = new InMemoryRateLimitStore();
    const cfg = { enabled: true, ipPerMinute: 100, globalPerMinute: 100, heavyToolPerHour: 1 };
    const a = await evaluateRateLimit(store, cfg, { ip: "1.1.1.1", toolName: "list_services" });
    const b = await evaluateRateLimit(store, cfg, { ip: "1.1.1.1", toolName: "list_services" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe("V1.2 — getClientIp", () => {
  it("préfère x-forwarded-for premier IP", () => {
    const r = new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 8.8.8.8" } });
    expect(getClientIp(r)).toBe("9.9.9.9");
  });
  it("fallback x-real-ip", () => {
    const r = new Request("http://x", { headers: { "x-real-ip": "5.5.5.5" } });
    expect(getClientIp(r)).toBe("5.5.5.5");
  });
  it("fallback unknown", () => {
    expect(getClientIp(new Request("http://x"))).toBe("unknown");
  });
});

describe("V1.2 — redactIp", () => {
  it("hashe l'IP, ne la révèle pas", () => {
    const r = redactIp("1.2.3.4");
    expect(r).toMatch(/^ip:[a-f0-9]{8}$/);
    expect(r).not.toContain("1.2.3.4");
  });
  it("unknown reste lisible", () => {
    expect(redactIp("unknown")).toBe("unknown");
  });
});

describe("V1.2 — buildRateLimitedResponse", () => {
  it("réponse JSON-RPC -32029 conforme et n'expose pas l'IP", async () => {
    const r = buildRateLimitedResponse(42);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("42");
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.jsonrpc).toBe("2.0");
    expect((body.error as { code: number }).code).toBe(-32029);
    expect((body.error as { message: string }).message).toBe("Rate limit exceeded");
    expect(JSON.stringify(body)).not.toContain("1.2.3.4");
  });
});

describe("V1.2 — HEAVY_TOOL_NAMES couvre les outils lourds attendus", () => {
  it("contient les outils lourds canoniques", () => {
    for (const t of [
      "inventory_all_layers",
      "recommend_open_data_candidates",
      "generate_inventory_report",
      "generate_open_data_brief",
      "generate_chatbot_readiness_report",
      "generate_layer_action_plan",
    ]) {
      expect(HEAVY_TOOL_NAMES.has(t)).toBe(true);
    }
  });
});

describe("V1.2 — handleHttpMcpRequest avec rate limiting actif", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.REMOTE_PUBLIC_ONLY = "true";
    process.env.REMOTE_ALLOW_INTERNAL_TOOLS = "false";
    process.env.DEFAULT_MODE = "public";
    delete process.env.MCP_PUBLIC_READ_TOKEN;
    delete process.env.MCP_ADMIN_TOKEN;
    process.env.MCP_RATE_LIMIT_ENABLED = "true";
    process.env.MCP_RATE_LIMIT_IP_PER_MINUTE = "1";
    process.env.MCP_RATE_LIMIT_GLOBAL_PER_MINUTE = "100";
    process.env.MCP_RATE_LIMIT_HEAVY_TOOL_PER_HOUR = "100";
    setRateLimitStoreForTests(new InMemoryRateLimitStore(), "memory");
  });
  afterEach(() => {
    setRateLimitStoreForTests(null);
    for (const k of [
      "REMOTE_PUBLIC_ONLY",
      "REMOTE_ALLOW_INTERNAL_TOOLS",
      "DEFAULT_MODE",
      "MCP_PUBLIC_READ_TOKEN",
      "MCP_ADMIN_TOKEN",
      "MCP_RATE_LIMIT_ENABLED",
      "MCP_RATE_LIMIT_IP_PER_MINUTE",
      "MCP_RATE_LIMIT_GLOBAL_PER_MINUTE",
      "MCP_RATE_LIMIT_HEAVY_TOOL_PER_HOUR",
    ]) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  function rpcReq(headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-forwarded-for": "9.9.9.9",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "1" } },
      }),
    });
  }

  it("OPTIONS jamais rate-limité", async () => {
    const a = await handleHttpMcpRequest(new Request("http://localhost/api/mcp", { method: "OPTIONS" }));
    expect(a.status).toBe(204);
    const b = await handleHttpMcpRequest(new Request("http://localhost/api/mcp", { method: "OPTIONS" }));
    expect(b.status).toBe(204);
    const c = await handleHttpMcpRequest(new Request("http://localhost/api/mcp", { method: "OPTIONS" }));
    expect(c.status).toBe(204);
  });

  it("dépassement IP/min → 429 JSON-RPC -32029", async () => {
    const a = await handleHttpMcpRequest(rpcReq());
    expect(a.status).not.toBe(429);
    const b = await handleHttpMcpRequest(rpcReq());
    expect(b.status).toBe(429);
    const body = (await b.json()) as { error?: { code: number; data?: { retryAfterSeconds: number } } };
    expect(body.error?.code).toBe(-32029);
    expect(body.error?.data?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("rate limit appliqué AVANT auth (peut renvoyer 429 même si token mauvais)", async () => {
    process.env.MCP_PUBLIC_READ_TOKEN = "set-but-wrong-bearer-test";
    const a = await handleHttpMcpRequest(rpcReq({ authorization: "Bearer wrong" }));
    // Premier appel → 401 (pas encore au-dessus du quota).
    expect(a.status).toBe(401);
    const b = await handleHttpMcpRequest(rpcReq({ authorization: "Bearer wrong" }));
    // Deuxième appel → 429 (IP/min=1).
    expect(b.status).toBe(429);
  });
});
