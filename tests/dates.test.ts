import { describe, expect, it } from "vitest";
import { timestampMsToIso, timestampMsToIsoString, utcDayBoundsMs } from "../src/utils/dates.js";

describe("timestampMsToIso", () => {
  it("convertit les ms en ISO", () => {
    const ms = Date.parse("2023-12-31T00:00:00.000Z");
    const r = timestampMsToIso(ms);
    expect(r).not.toBeNull();
    expect(r!.isoUtc.startsWith("2023-12-31")).toBe(true);
  });

  it("retourne null pour valeur vide", () => {
    expect(timestampMsToIso(null)).toBeNull();
    expect(timestampMsToIso(undefined)).toBeNull();
  });
});

describe("timestampMsToIsoString", () => {
  it("retourne une chaîne ISO ou null", () => {
    const r = timestampMsToIsoString(0);
    expect(r.value).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("utcDayBoundsMs", () => {
  it("borne une date YYYY-MM-DD", () => {
    const { startMs, endMs } = utcDayBoundsMs("2026-04-30");
    expect(endMs - startMs).toBe(86_400_000 - 1);
  });
});
