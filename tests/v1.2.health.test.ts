import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handleHttpHealthRequest,
  handleHttpInternalHealthRequest,
} from "../src/runtime/httpHandler.js";
import {
  InMemoryRateLimitStore,
  setRateLimitStoreForTests,
} from "../src/runtime/rateLimit.js";

const SMOKE_TOKEN = "smoke-token-not-a-secret";
const ADMIN_TOKEN = "admin-token-not-a-secret";

describe("V1.2 — /api/health public minimal", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.REMOTE_PUBLIC_ONLY = "true";
    process.env.DEFAULT_MODE = "public";
    delete process.env.MCP_PUBLIC_READ_TOKEN;
    delete process.env.MCP_ADMIN_TOKEN;
  });
  afterEach(() => {
    for (const k of [
      "REMOTE_PUBLIC_ONLY",
      "DEFAULT_MODE",
      "MCP_PUBLIC_READ_TOKEN",
      "MCP_ADMIN_TOKEN",
    ]) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("payload public minimal — pas de stats détaillées ni d'uptime", async () => {
    const res = handleHttpHealthRequest(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.transport).toBe("http");
    expect(body.publicOnly).toBe(true);
    expect(body.bearerRequired).toBe(false);
    // Champs interdits côté public.
    for (const k of [
      "uptimeMs",
      "runtime",
      "internalToolsAllowed",
      "rateLimit",
      "config",
    ]) {
      expect(body[k]).toBeUndefined();
    }
  });

  it("OPTIONS sur /api/health renvoie 204 sans body", async () => {
    const res = handleHttpHealthRequest(
      new Request("http://localhost/api/health", { method: "OPTIONS" }),
    );
    expect(res.status).toBe(204);
  });
});

describe("V1.2 — /api/health/internal protégé", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.REMOTE_PUBLIC_ONLY = "true";
    process.env.DEFAULT_MODE = "public";
    process.env.MCP_RATE_LIMIT_ENABLED = "false";
    setRateLimitStoreForTests(new InMemoryRateLimitStore(), "memory");
  });
  afterEach(() => {
    setRateLimitStoreForTests(null);
    for (const k of [
      "REMOTE_PUBLIC_ONLY",
      "DEFAULT_MODE",
      "MCP_PUBLIC_READ_TOKEN",
      "MCP_ADMIN_TOKEN",
      "MCP_RATE_LIMIT_ENABLED",
      "VERCEL",
      "VERCEL_ENV",
    ]) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("avec MCP_ADMIN_TOKEN : 401 sans Authorization, 200 avec bon token", async () => {
    process.env.MCP_ADMIN_TOKEN = ADMIN_TOKEN;
    const noAuth = await handleHttpInternalHealthRequest(
      new Request("http://localhost/api/health/internal"),
    );
    expect(noAuth.status).toBe(401);
    const withAuth = await handleHttpInternalHealthRequest(
      new Request("http://localhost/api/health/internal", {
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      }),
    );
    expect(withAuth.status).toBe(200);
    const body = (await withAuth.json()) as Record<string, unknown>;
    expect(typeof body.uptimeMs).toBe("number");
    expect(body.config).toBeTruthy();
    expect(body.rateLimit).toBeTruthy();
    expect(body.runtime).toBeTruthy();
    // Aucun secret dans le payload.
    const text = JSON.stringify(body);
    expect(text).not.toContain(ADMIN_TOKEN);
    expect(text).not.toContain(SMOKE_TOKEN);
  });

  it("fallback MCP_PUBLIC_READ_TOKEN si MCP_ADMIN_TOKEN absent", async () => {
    process.env.MCP_PUBLIC_READ_TOKEN = SMOKE_TOKEN;
    delete process.env.MCP_ADMIN_TOKEN;
    const wrongAuth = await handleHttpInternalHealthRequest(
      new Request("http://localhost/api/health/internal", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(wrongAuth.status).toBe(401);
    const ok = await handleHttpInternalHealthRequest(
      new Request("http://localhost/api/health/internal", {
        headers: { authorization: `Bearer ${SMOKE_TOKEN}` },
      }),
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, unknown>;
    expect((body.config as Record<string, unknown>).bearerRequired).toBe(true);
    expect((body.config as Record<string, unknown>).adminTokenConfigured).toBe(false);
  });

  it("aucun token + environnement remote → 401", async () => {
    delete process.env.MCP_PUBLIC_READ_TOKEN;
    delete process.env.MCP_ADMIN_TOKEN;
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    const res = await handleHttpInternalHealthRequest(
      new Request("http://localhost/api/health/internal"),
    );
    expect(res.status).toBe(401);
  });

  it("aucun token + environnement local → 200 (compromis confort dev)", async () => {
    delete process.env.MCP_PUBLIC_READ_TOKEN;
    delete process.env.MCP_ADMIN_TOKEN;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const res = await handleHttpInternalHealthRequest(
      new Request("http://localhost/api/health/internal"),
    );
    expect(res.status).toBe(200);
  });
});
