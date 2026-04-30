/**
 * Auth Bearer minimaliste pour le transport HTTP distant.
 *
 * - Si aucun `MCP_PUBLIC_READ_TOKEN` n'est défini : auth désactivée. Utile en
 *   local / tests, à éviter en production Vercel.
 * - Si défini : un en-tête `Authorization: Bearer <token>` strictement égal
 *   est requis. Toute autre valeur → 401.
 *
 * On compare en *constant time* pour éviter une fuite par timing, même si
 * l'attaque pratique sur un endpoint serverless est très peu probable.
 *
 * Aucun token n'est journalisé ni renvoyé au client.
 */

export interface BearerCheckResult {
  ok: boolean;
  /** Réponse Web standard prête à renvoyer si `ok=false`. */
  response?: Response;
}

const BEARER_REQUIRED_BODY = JSON.stringify({
  jsonrpc: "2.0",
  error: {
    code: -32001,
    message:
      "Authentification requise. Fournir Authorization: Bearer <MCP_PUBLIC_READ_TOKEN>.",
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
    // Auth désactivée — tout passe.
    return { ok: true };
  }
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return { ok: false, response: unauthorizedResponse(BEARER_REQUIRED_BODY) };
  }
  const token = header.slice("bearer ".length).trim();
  if (token === "" || !constantTimeEqual(token, expected)) {
    return { ok: false, response: unauthorizedResponse(BEARER_INVALID_BODY) };
  }
  return { ok: true };
}
