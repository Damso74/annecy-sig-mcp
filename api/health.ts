/**
 * Route Vercel `/api/health` — diagnostic léger.
 *
 * Ne fait **aucun appel** vers le portail ArcGIS : on confirme uniquement que
 * le serveur est monté et que la config se charge. Surveillance externe
 * possible (Better Stack, UptimeRobot, etc.).
 *
 * Format : `export default { fetch(request) { … } }` (Web Standard officiel
 * des Vercel Functions Node.js). Voir api/mcp.ts pour la rationale.
 */

// Import depuis `../dist/...` après build — voir api/mcp.ts pour la rationale.
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
