import { describe, expect, it } from "vitest";
import { sanitizePublicProperties, stripDangerousKeys } from "../src/utils/sanitize.js";

describe("sanitizePublicProperties", () => {
  it("retire les champs d’édition interne même s’ils sont dans l’allowlist", () => {
    const allowed = new Set(["objectid", "created_user", "denomination"]);
    const out = sanitizePublicProperties(
      {
        objectid: 1,
        created_user: "admin",
        denomination: "WC",
        last_edited_date: 123,
      },
      allowed,
    );
    expect(out).toEqual({ objectid: 1, denomination: "WC" });
  });

  it("supprime les clés interdites par motif", () => {
    const allowed = new Set(["objectid", "user_password_hint"]);
    const out = sanitizePublicProperties({ objectid: 1, user_password_hint: "x" }, allowed);
    expect(out).toEqual({ objectid: 1 });
  });
});

describe("stripDangerousKeys", () => {
  it("retire token et champs édition", () => {
    const out = stripDangerousKeys({ token_arcgis: "x", nom: "ok", last_edited_user: "u" });
    expect(out).toEqual({ nom: "ok" });
  });
});
