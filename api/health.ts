/**
 * Route Vercel `/api/health` — diagnostic léger **public minimal**.
 *
 * Ne fait **aucun appel** vers le portail ArcGIS et n'expose ni uptime, ni
 * stats cache, ni compteurs d'erreurs. Voir `/api/health/internal` pour le
 * diagnostic complet (protégé par Bearer).
 *
 * Format : `export default { fetch(request) { … } }` (Web Standard officiel
 * des Vercel Functions Node.js). Voir api/mcp.ts pour la rationale.
 */

import { handleHttpHealthRequest } from "../dist/runtime/httpHandler.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 5,
};

export default {
  fetch(request: Request): Response {
    return handleHttpHealthRequest(request);
  },
};
