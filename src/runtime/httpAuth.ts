/**
 * Auth Bearer minimaliste pour le transport HTTP distant.
 *
 * Système **mono-token** assumé : une seule variable d'env
 * `MCP_PUBLIC_READ_TOKEN` (ou `MCP_ADMIN_TOKEN` pour `/api/health/internal`).
 * Pas de multi-token, pas de tokenId, pas d'expiration par token, pas de
 * révocation par token — on s'en remet à la rotation côté Vercel
 * (cf. `SECURITY.md § Rotation`).
 *
 * - Si aucun token n'est défini : auth désactivée. Utile en local / tests, à
 *   éviter en production Vercel.
 * - Si défini : un en-tête `Authorization: Bearer <token>` strictement égal
 *   est requis. Toute autre valeur → 401.
 *
 * On compare en *constant time* pour éviter une fuite par timing, même si
 * l'attaque pratique sur un endpoint serverless est très peu probable.
 *
 * Aucun token n'est journalisé ni renvoyé au client. Les messages publics
 * restent volontairement génériques (« Authentification requise. » /
 * « Token Bearer invalide. ») afin de ne révéler aucune information sur la
 * valeur attendue ou le format.
 */

export interface BearerCheckResult {
  ok: boolean;
  /** Réponse Web standard prête à renvoyer si `ok=false`. */
  response?: Response;
  /** Détail interne (logs/health) — jamais renvoyé au client tel quel. */
  reason?: "missing" | "invalid" | "empty" | "wrong-scheme";
}

const BEARER_REQUIRED_BODY = JSON.stringify({
  jsonrpc: "2.0",
  error: {
    code: -32001,
    message: "Authentification requise.",
  },
  id: null,
});

const BEARER_INVALID_BODY = JSON.stringify({
  jsonrpc: "2.0",
  error: {
    code: -32001,
    message: "Token Bearer invalide.",
  },
  id: null,
});

function unauthorizedResponse(body: string): Response {
  return new Response(body, {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": 'Bearer realm="annecy-sig-mcp"',
    },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface CheckBearerOptions {
  /** Token attendu (sera comparé strictement). `undefined` → auth désactivée. */
  expectedToken?: string;
}

export function checkBearer(req: Request, options: CheckBearerOptions): BearerCheckResult {
  const expected = options.expectedToken;
  if (!expected) {
    // Auth désactivée — tout passe (contrat existant, conservé pour compat
    // local / tests).
    return { ok: true };
  }
  const header = req.headers.get("authorization") ?? "";
  if (header.length === 0) {
    return {
      ok: false,
      reason: "missing",
      response: unauthorizedResponse(BEARER_REQUIRED_BODY),
    };
  }
  const lower = header.toLowerCase();
  // Cas particulier : `fetch`/Node peut normaliser `Bearer ` (avec espace
  // final) en `Bearer` (sans espace) — on traite comme « Bearer vide ».
  if (lower === "bearer") {
    return {
      ok: false,
      reason: "empty",
      response: unauthorizedResponse(BEARER_INVALID_BODY),
    };
  }
  if (!lower.startsWith("bearer ")) {
    return {
      ok: false,
      reason: "wrong-scheme",
      response: unauthorizedResponse(BEARER_REQUIRED_BODY),
    };
  }
  const token = header.slice("bearer ".length).trim();
  if (token === "") {
    return {
      ok: false,
      reason: "empty",
      response: unauthorizedResponse(BEARER_INVALID_BODY),
    };
  }
  if (!constantTimeEqual(token, expected)) {
    return {
      ok: false,
      reason: "invalid",
      response: unauthorizedResponse(BEARER_INVALID_BODY),
    };
  }
  return { ok: true };
}
