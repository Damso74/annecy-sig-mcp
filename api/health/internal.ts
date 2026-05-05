/**
 * Route Vercel `/api/health/internal` — diagnostic détaillé **protégé**.
 *
 * Authentification :
 *   - `MCP_ADMIN_TOKEN` si défini ;
 *   - sinon fallback `MCP_PUBLIC_READ_TOKEN` (compromis « simple par
 *     défaut » documenté dans `SECURITY.md`).
 *   - Sans aucun de ces deux tokens en environnement remote / production,
 *     la route répond `401`.
 *
 * Aucun secret n'est jamais inclus dans le payload de réponse.
 */

import { handleHttpInternalHealthRequest } from "../../dist/runtime/httpHandler.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 5,
};

export default {
  fetch(request: Request): Promise<Response> {
    return handleHttpInternalHealthRequest(request);
  },
};
