import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ContractViolationError,
  resolveContractPolicy,
  validateContract,
} from "../src/contracts/index.js";

/**
 * V0.9 — `CONTRACT_POLICY=strict|warn|silent`
 *
 * Ces tests modifient `process.env.CONTRACT_POLICY` et `process.env.STRICT_CONTRACTS`
 * pour simuler les trois politiques. Comme `resolveContractPolicy()` lit l’env à
 * chaque appel, aucun reset de module n’est nécessaire.
 *
 * Important — vérification stdout : la suite tourne en parallèle ; on capture
 * `process.stdout.write` localement pour vérifier qu’aucun écart de contrat
 * ne fuit jamais sur stdout (le transport MCP étant stdio).
 */

const SCHEMA = z.object({ a: z.string(), b: z.number().int() }).strict();
const INVALID = { a: 42 } as unknown as { a: string; b: number };

describe("V0.9 — CONTRACT_POLICY (strict | warn | silent)", () => {
  const originalPolicy = process.env.CONTRACT_POLICY;
  const originalLegacy = process.env.STRICT_CONTRACTS;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalVitest = process.env.VITEST;

  beforeEach(() => {
    delete process.env.CONTRACT_POLICY;
    delete process.env.STRICT_CONTRACTS;
  });

  afterEach(() => {
    process.env.CONTRACT_POLICY = originalPolicy;
    process.env.STRICT_CONTRACTS = originalLegacy;
    process.env.NODE_ENV = originalNodeEnv;
    if (originalVitest !== undefined) process.env.VITEST = originalVitest;
    vi.restoreAllMocks();
  });

  it("résolution : par défaut sous vitest → strict", () => {
    expect(resolveContractPolicy()).toBe("strict");
  });

  it("résolution : CONTRACT_POLICY=warn force warn", () => {
    process.env.CONTRACT_POLICY = "warn";
    expect(resolveContractPolicy()).toBe("warn");
  });

  it("résolution : CONTRACT_POLICY=silent force silent", () => {
    process.env.CONTRACT_POLICY = "silent";
    expect(resolveContractPolicy()).toBe("silent");
  });

  it("résolution : compat STRICT_CONTRACTS=true ↔ strict", () => {
    process.env.STRICT_CONTRACTS = "true";
    expect(resolveContractPolicy()).toBe("strict");
  });

  it("résolution : compat STRICT_CONTRACTS=false ↔ warn", () => {
    process.env.STRICT_CONTRACTS = "false";
    expect(resolveContractPolicy()).toBe("warn");
  });

  it("strict : un payload invalide jette ContractViolationError", () => {
    process.env.CONTRACT_POLICY = "strict";
    expect(() => validateContract(SCHEMA, INVALID, "TestStrict")).toThrowError(
      ContractViolationError,
    );
  });

  it("warn : ne jette pas, mais log sur stderr (jamais stdout)", () => {
    process.env.CONTRACT_POLICY = "warn";
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((..._args: unknown[]) => true as unknown as boolean);

    expect(() => validateContract(SCHEMA, INVALID, "TestWarn")).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0]?.[0]).toMatch(/TestWarn/);
    expect(stdoutSpy).not.toHaveBeenCalled();

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("silent : ne jette pas et n’écrit ni sur stdout ni sur stderr", () => {
    process.env.CONTRACT_POLICY = "silent";
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((..._args: unknown[]) => true as unknown as boolean);

    expect(() => validateContract(SCHEMA, INVALID, "TestSilent")).not.toThrow();
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("payload valide : retourné inchangé quel que soit le mode", () => {
    process.env.CONTRACT_POLICY = "strict";
    const payload = { a: "ok", b: 1 };
    expect(validateContract(SCHEMA, payload, "TestValidStrict")).toBe(payload);

    process.env.CONTRACT_POLICY = "warn";
    expect(validateContract(SCHEMA, payload, "TestValidWarn")).toBe(payload);

    process.env.CONTRACT_POLICY = "silent";
    expect(validateContract(SCHEMA, payload, "TestValidSilent")).toBe(payload);
  });
});
