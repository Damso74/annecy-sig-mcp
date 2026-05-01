/**
 * Route Vercel `/api/mcp` — transport HTTP MCP Streamable, public-only.
 *
 * Convention de signature : `export default { fetch(request) { … } }`. C'est
 * le format Web Standard officiellement supporté par les Vercel Functions
 * Node.js (équivalent Cloudflare Workers / Hono / Bun.serve). Voir
 * https://vercel.com/docs/functions/functions-api-reference — les autres
 * formats (default function, fonctions nommées GET/POST) ne déclenchent pas
 * la même détection sur tous les runtimes : sans cet objet, le serverless
 * peut bloquer en `FUNCTION_INVOCATION_TIMEOUT`.
 *
 * Import depuis `../dist/...` (et non `../src/...`) : c'est volontaire. Le
 * bundler Vercel doit pouvoir résoudre l'import sans dépendre de la chaîne
 * TypeScript. `vercel.json` exécute `npm run build` avant le packaging des
 * fonctions, donc `dist/` est garanti présent au moment du déploiement.
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

export default {
  fetch(request: Request): Promise<Response> {
    return handleHttpMcpRequest(request);
  },
};
