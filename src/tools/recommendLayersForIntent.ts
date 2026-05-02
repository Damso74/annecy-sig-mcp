/**
 * `recommend_layers_for_intent` — outil MCP V1.1 d'aide à la découverte.
 *
 * Reçoit une intention citoyenne en français libre et renvoie une liste classée
 * de couches pertinentes, accompagnée d'exemples d'appels prêts à l'emploi
 * (`tool` + `args`) pour `query_layer` ou `search_nearby`.
 *
 * Implémentation volontairement **simple** (matching lexical pondéré) :
 *
 * - tokenise la requête (FR, accents/casse-insensible) ;
 * - score chaque couche allowlistée selon les mots-clés présents dans
 *   `layerName`, `description`, `useCases`, `serviceKey` et un dictionnaire
 *   sémantique mince ;
 * - filtre selon `mode` (les couches `internal-only` sortent en mode public) ;
 * - garantit qu'aucune couche `riskLevel: "red"` n'apparaît en mode public ;
 * - propose un appel `search_nearby` quand `lat`/`lon` sont fournis,
 *   sinon `query_layer`.
 *
 * Pas de dépendance NLP, pas de modèle externe → réponse instantanée et
 * 100% offline / déterministe.
 */
import type { AppConfig } from "../config.js";
import { LAYER_REGISTRY, type LayerRegistryEntry, type VisibilityMode } from "../registry.js";

export type IntentRecommendation = {
  serviceKey: string;
  layerId: number;
  layerName: string;
  score: number;
  reasons: string[];
  riskLevel: string;
  visibility: VisibilityMode;
  suggestedCall: {
    tool: "query_layer" | "search_nearby";
    args: Record<string, unknown>;
  };
};

export type RecommendIntentResult = {
  intent: string;
  mode: VisibilityMode;
  recommendations: IntentRecommendation[];
  source: { type: "annecy_sig_mcp_intent_router" };
};

/**
 * Mots-clés métier injectés en fallback : étend la couverture du matching
 * au-delà du libellé de la couche (ex. "voiture" → couches stationnement).
 * Volontairement court et explicite — toute extension future doit rester
 * vérifiable manuellement (pas de NLP probabiliste).
 */
const KEYWORD_BOOSTS: Array<{
  pattern: RegExp;
  matches: Array<{ serviceKey: string; layerId: number; reason: string; weight?: number }>;
}> = [
  {
    pattern: /\b(borne|recharg|electriqu|ve(?:hicul)?|ev|voiture[ -]?electriqu)/i,
    matches: [{ serviceKey: "mobilite", layerId: 9, reason: "intention véhicule électrique" }],
  },
  {
    pattern: /\b(velo|cycle|cyclis|vae|trottinet)/i,
    matches: [
      { serviceKey: "mobilite", layerId: 10, reason: "intention vélo / stationnement deux-roues" },
      { serviceKey: "mobilite", layerId: 3, reason: "stations vélonecy" },
    ],
  },
  {
    pattern: /\b(pmr|handicap|accessib|fauteuil)/i,
    matches: [
      { serviceKey: "mobilite", layerId: 8, reason: "intention places PMR" },
      { serviceKey: "equipements", layerId: 5, reason: "WC publics PMR" },
    ],
  },
  {
    pattern: /\b(parking|park|gar(?:er|age)|stationn|place(?:r)?(?:s)?[ -]?(?:de )?stationnement)/i,
    matches: [
      { serviceKey: "mobilite", layerId: 16, reason: "Annecy Parking" },
      { serviceKey: "mobilite", layerId: 2, reason: "parkings relais" },
      { serviceKey: "mobilite", layerId: 7, reason: "parking moto" },
    ],
  },
  {
    pattern: /\b(toilet|wc|sanitair|urinoir)/i,
    matches: [{ serviceKey: "equipements", layerId: 5, reason: "WC publics", weight: 4 }],
  },
  {
    pattern: /\b(ecole|college|scolair|enfan|creche|maternelle|primair)/i,
    matches: [
      { serviceKey: "equipements", layerId: 1, reason: "établissements scolaires" },
      { serviceKey: "equipements", layerId: 2, reason: "accueils petite enfance" },
    ],
  },
  {
    pattern: /\b(culture|musee|theatre|concert|spectacle|expo)/i,
    matches: [{ serviceKey: "equipements", layerId: 6, reason: "équipements culturels" }],
  },
  {
    pattern: /\b(sport|gymnase|piscine|stade|terrain)/i,
    matches: [{ serviceKey: "equipements", layerId: 9, reason: "équipements sport" }],
  },
  {
    pattern: /\b(travau|chantier|voirie|deviation|arret(?:é| de) voirie)/i,
    matches: [{ serviceKey: "travaux", layerId: 3, reason: "couche travaux internes" }],
  },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ");
}

function tokenize(s: string): string[] {
  return normalize(s).split(/\s+/).filter(t => t.length >= 3);
}

function scoreLayer(
  entry: LayerRegistryEntry,
  intent: string,
  intentTokens: string[],
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const haystack = normalize(
    `${entry.layerName} ${entry.description} ${entry.useCases.join(" ")} ${entry.serviceKey}`,
  );

  for (const tok of intentTokens) {
    if (haystack.includes(tok)) {
      score += 1;
      reasons.push(`mot-clé « ${tok} » présent dans la couche`);
    }
  }

  for (const boost of KEYWORD_BOOSTS) {
    if (!boost.pattern.test(intent)) continue;
    for (const m of boost.matches) {
      if (m.serviceKey === entry.serviceKey && m.layerId === entry.layerId) {
        score += m.weight ?? 3;
        reasons.push(m.reason);
      }
    }
  }

  return { score, reasons: [...new Set(reasons)] };
}

function suggestCall(
  entry: LayerRegistryEntry,
  input: RecommendIntentInput,
): IntentRecommendation["suggestedCall"] {
  if (
    typeof input.lat === "number" &&
    typeof input.lon === "number" &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lon)
  ) {
    return {
      tool: "search_nearby",
      args: {
        serviceKey: entry.serviceKey,
        layerId: entry.layerId,
        lat: input.lat,
        lon: input.lon,
        radiusMeters: input.radiusMeters ?? 1000,
        limit: input.limit ?? 10,
        mode: input.mode ?? "public",
      },
    };
  }
  return {
    tool: "query_layer",
    args: {
      serviceKey: entry.serviceKey,
      layerId: entry.layerId,
      limit: input.limit ?? 25,
      mode: input.mode ?? "public",
    },
  };
}

export type RecommendIntentInput = {
  intent: string;
  mode: VisibilityMode;
  lat?: number;
  lon?: number;
  radiusMeters?: number;
  limit?: number;
  maxRecommendations?: number;
};

export function runRecommendLayersForIntent(
  _cfg: AppConfig,
  input: RecommendIntentInput,
): RecommendIntentResult {
  const intent = input.intent.trim();
  if (!intent) {
    return {
      intent,
      mode: input.mode,
      recommendations: [],
      source: { type: "annecy_sig_mcp_intent_router" },
    };
  }
  const tokens = tokenize(intent);
  const max = Math.min(Math.max(input.maxRecommendations ?? 5, 1), 10);

  const scored: IntentRecommendation[] = [];
  for (const entry of LAYER_REGISTRY) {
    if (input.mode === "public" && entry.visibility !== "public") continue;
    if (input.mode === "public" && entry.riskLevel === "red") continue;
    const { score, reasons } = scoreLayer(entry, intent, tokens);
    if (score <= 0) continue;
    scored.push({
      serviceKey: entry.serviceKey,
      layerId: entry.layerId,
      layerName: entry.layerName,
      score,
      reasons,
      riskLevel: entry.riskLevel,
      visibility: entry.visibility,
      suggestedCall: suggestCall(entry, input),
    });
  }

  scored.sort((a, b) => b.score - a.score || a.layerId - b.layerId);

  return {
    intent,
    mode: input.mode,
    recommendations: scored.slice(0, max),
    source: { type: "annecy_sig_mcp_intent_router" },
  };
}
