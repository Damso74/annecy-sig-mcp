import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleHttpMcpRequest } from "../src/runtime/httpHandler.js";
import {
  InMemoryRateLimitStore,
  setRateLimitStoreForTests,
} from "../src/runtime/rateLimit.js";

describe("V1.2 — CORS configurable via MCP_CORS_ALLOWED_ORIGINS", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.REMOTE_PUBLIC_ONLY = "true";
    process.env.REMOTE_ALLOW_INTERNAL_TOOLS = "false";
    process.env.DEFAULT_MODE = "public";
    process.env.MCP_RATE_LIMIT_ENABLED = "false";
    setRateLimitStoreForTests(new InMemoryRateLimitStore(), "memory");
  });
  afterEach(() => {
    setRateLimitStoreForTests(null);
    for (const k of [
      "REMOTE_PUBLIC_ONLY",
      "REMOTE_ALLOW_INTERNAL_TOOLS",
      "DEFAULT_MODE",
      "MCP_RATE_LIMIT_ENABLED",
      "MCP_CORS_ALLOWED_ORIGINS",
    ]) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("CORS=* (défaut) → Allow-Origin: * et pas de credentials", async () => {
    delete process.env.MCP_CORS_ALLOWED_ORIGINS;
    const res = await handleHttpMcpRequest(
      new Request("http://localhost/api/mcp", {
        method: "OPTIONS",
        headers: { origin: "https://copilot.example.com" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe(
      "Authorization, Content-Type, MCP-Protocol-Version",
    );
  });

  it("origine autorisée via liste explicite : echo-back avec Vary: Origin", async () => {
    process.env.MCP_CORS_ALLOWED_ORIGINS =
      "https://copilot.microsoft.com,https://chat.openai.com";
    const res = await handleHttpMcpRequest(
      new Request("http://localhost/api/mcp", {
        method: "OPTIONS",
        headers: { origin: "https://copilot.microsoft.com" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://copilot.microsoft.com");
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("origine non autorisée : pas d'Allow-Origin émis", async () => {
    process.env.MCP_CORS_ALLOWED_ORIGINS = "https://copilot.microsoft.com";
    const res = await handleHttpMcpRequest(
      new Request("http://localhost/api/mcp", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example.com" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
