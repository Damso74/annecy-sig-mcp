import { describe, expect, it } from "vitest";
import { checkBearer } from "../src/runtime/httpAuth.js";

const TOKEN = "test-token-not-a-secret";

function reqWith(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers,
  });
}

describe("V1.2 — checkBearer (mono-token)", () => {
  it("auth désactivée si expectedToken absent : ok=true", () => {
    const r = checkBearer(reqWith(), {});
    expect(r.ok).toBe(true);
  });

  it("sans Authorization : 401, raison `missing`", async () => {
    const r = checkBearer(reqWith(), { expectedToken: TOKEN });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing");
    expect(r.response?.status).toBe(401);
    const body = (await r.response!.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe("Authentification requise.");
    // Le message ne doit JAMAIS exposer le token attendu ni indice de format.
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("Authorization Basic : 401, raison `wrong-scheme`", async () => {
    const r = checkBearer(reqWith({ authorization: "Basic dXNlcjpwYXNz" }), {
      expectedToken: TOKEN,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("wrong-scheme");
    expect(r.response?.status).toBe(401);
    const body = (await r.response!.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe("Authentification requise.");
  });

  it("Bearer vide : 401, raison `empty`", async () => {
    const r = checkBearer(reqWith({ authorization: "Bearer " }), {
      expectedToken: TOKEN,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("empty");
    const body = (await r.response!.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe("Token Bearer invalide.");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("mauvais Bearer : 401, raison `invalid`", async () => {
    const r = checkBearer(reqWith({ authorization: "Bearer wrong-value" }), {
      expectedToken: TOKEN,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid");
    const body = (await r.response!.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe("Token Bearer invalide.");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("bon Bearer : ok=true et aucune réponse", () => {
    const r = checkBearer(reqWith({ authorization: `Bearer ${TOKEN}` }), {
      expectedToken: TOKEN,
    });
    expect(r.ok).toBe(true);
    expect(r.response).toBeUndefined();
  });

  it("comparaison constant-time : longueurs différentes refusées", () => {
    // On ne peut pas tester la propriété strictement, mais on vérifie au moins
    // qu'un préfixe valide n'est pas accepté.
    const r = checkBearer(reqWith({ authorization: `Bearer ${TOKEN.slice(0, 5)}` }), {
      expectedToken: TOKEN,
    });
    expect(r.ok).toBe(false);
  });
});
