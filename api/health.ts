/**
 * Route Vercel `/api/health` — diagnostic léger.
 *
 * Ne fait **aucun appel** vers le portail ArcGIS : on confirme uniquement que
 * le serveur est monté et que la config se charge. Surveillance externe
 * possible (Better Stack, UptimeRobot, etc.).
 */

import { handleHttpHealthRequest } from "../src/runtime/httpHandler.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 5,
};

export default async function handler(req: Request): Promise<Response> {
  return handleHttpHealthRequest(req);
}
