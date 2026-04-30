import { describe, expect, it } from "vitest";
import { parseLimit } from "../src/utils/validation.js";
import { validateServiceLayer } from "../src/utils/validation.js";

describe("validateServiceLayer", () => {
  it("refuse un service inconnu", () => {
    expect(() => validateServiceLayer("unknown", 0, "public")).toThrow(/Service inconnu/);
  });

  it("refuse une couche non allowlistée", () => {
    expect(() => validateServiceLayer("equipements", 99, "public")).toThrow(/non autorisée/);
  });

  it("refuse une couche internal en mode public", () => {
    expect(() => validateServiceLayer("mobilite", 4, "public")).toThrow(/internal/);
  });
});

describe("parseLimit", () => {
  it("refuse une limite supérieure au max", () => {
    expect(() => parseLimit(2000, 100, 1000)).toThrow(/MAX_RESULT_LIMIT/);
  });

  it("accepte la limite max", () => {
    expect(parseLimit(1000, 100, 1000)).toBe(1000);
  });
});
