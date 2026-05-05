import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { createAnnecySigMcpServer } from "../src/server.js";
import {
  getLoggerStats,
  resetLoggerStats,
  sanitizeMessage,
  roundCoord,
} from "../src/runtime/logger.js";

/**
 * Vérifie que le branchement `withToolTracing` est effectif côté server.ts
 * pour les outils qui n'ont pas de tracing interne (list_services, etc.).
 *
 * On capture stderr le temps de l'appel pour vérifier l'absence de fuites
 * (token, Authorization).
 */

function captureStderr(fn: () => Promise<void>): Promise<{ result: void; lines: string[] }> {
  return new Promise((resolveP, rejectP) => {
    const lines: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    type WriteFn = typeof process.stderr.write;
    const interceptor = ((chunk: unknown) => {
      const s = typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf8");
      lines.push(s);
      return true;
    }) as unknown as WriteFn;
    process.stderr.write = interceptor;
    fn()
      .then(() => {
        process.stderr.write = original;
        resolveP({ result: undefined, lines });
      })
      .catch(err => {
        process.stderr.write = original;
        rejectP(err);
      });
  });
}

async function connectInMemory() {
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
    { name: "tool-tracing-test", version: "1.0.0-rc.1" },
    { capabilities: {} },
  );
  await client.connect(clientT);
  return { server, client };
}

describe("V1.2 — withToolTracing branché côté server.ts", () => {
  beforeEach(() => {
    resetLoggerStats();
  });
  afterEach(() => {
    resetLoggerStats();
  });

  it("appel list_services incrémente toolCallsTotal", async () => {
    const { client, server } = await connectInMemory();
    try {
      const before = getLoggerStats().toolCallsTotal;
      const r = await client.callTool({
        name: "list_services",
        arguments: { mode: "public" },
      });
      expect(r.isError).not.toBe(true);
      const after = getLoggerStats();
      expect(after.toolCallsTotal).toBe(before + 1);
      expect(after.toolErrorsTotal).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("appel mode=internal sur outil public incrémente toolErrorsTotal", async () => {
    const { client, server } = await connectInMemory();
    try {
      const beforeErrors = getLoggerStats().toolErrorsTotal;
      const r = await client.callTool({
        name: "list_services",
        arguments: { mode: "internal" },
      });
      expect(r.isError).toBe(true);
      const after = getLoggerStats();
      expect(after.toolErrorsTotal).toBeGreaterThan(beforeErrors);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("logs stderr ne contiennent ni token, ni Authorization", async () => {
    const TOKEN_LIKE = "supertokenfake1234567890abcdef";
    const { lines } = await captureStderr(async () => {
      const { client, server } = await connectInMemory();
      try {
        await client.callTool({
          name: "list_services",
          arguments: { mode: "public" },
        });
      } finally {
        await client.close();
        await server.close();
      }
    });
    const all = lines.join("");
    expect(all.toLowerCase()).not.toContain("authorization:");
    expect(all).not.toContain(TOKEN_LIKE);
  });
});

describe("V1.2 — sanitizeMessage / roundCoord", () => {
  it("retire Authorization Bearer", () => {
    const r = sanitizeMessage("Headers: authorization: Bearer abcdef-ghijkl");
    expect(r.toLowerCase()).not.toContain("bearer abcdef");
    expect(r).toContain("<redacted>");
  });
  it("retire bearer brut", () => {
    const r = sanitizeMessage("Token bearer sk-1234567890ABCDEFGHIJKL");
    expect(r).not.toContain("sk-1234567890ABCDEFGHIJKL");
  });
  it("retire les longues chaînes alphanum", () => {
    const r = sanitizeMessage("token=abcdefghijklmnopqrstuvwxyz123456");
    expect(r).toContain("<redacted-token>");
  });
  it("roundCoord arrondit à 3 décimales", () => {
    expect(roundCoord(45.8992345)).toBe(45.899);
    expect(roundCoord(undefined)).toBeUndefined();
    expect(roundCoord(Number.NaN)).toBeUndefined();
  });
});
