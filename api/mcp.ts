/**
 * Route Vercel `/api/mcp` — transport HTTP MCP Streamable, public-only.
 *
 * Convention de signature : Web standard `Request → Response`. Vercel
 * détecte ce format automatiquement (Fluid Compute / Node fetch handler) et
 * route la requête vers ce handler en mode serverless.
 *
 * Import depuis `../dist/...` (et non `../src/...`) : c'est volontaire. Le
 * bundler Vercel doit pouvoir résoudre l'import sans dépendre de la chaîne
 * TypeScript. `vercel.json` exécute `npm run build` avant le packaging des
 * fonctions, donc `dist/` est garanti présent au moment du déploiement. Cela
 * évite la classe d'erreurs `FUNCTION_INVOCATION_FAILED` due à un `.js`
 * pointé vers un fichier `.ts` non compilé.
 *
 * Toute la logique (auth, verrou public-only, montage MCP) est dans
 * `src/runtime/httpHandler.ts` ; ce fichier est volontairement minimal pour
 * faciliter la maintenance et le test.
 */

import { handleHttpMcpRequest } from "../dist/runtime/httpHandler.js";

export const config = {
  runtime: "nodejs",
  // Plafond généreux : `inventory_all_layers` peut prendre plusieurs secondes
  // sur le portail Annecy. On reste sous la limite hobby plan (~10 s) ; à
  // ajuster en pro/entreprise si besoin.
  maxDuration: 30,
};

export default async function handler(req: Request): Promise<Response> {
  return handleHttpMcpRequest(req);
}
