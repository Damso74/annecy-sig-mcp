/**
 * `citizen_query` — outil MCP V1.2 « haut niveau citoyen ».
 *
 * Objectif :
 *   Éviter qu'un assistant (Copilot Studio, Claude, etc.) demande
 *   `serviceKey` / `layerId` / `mode` à l'usager. L'outil prend une question
 *   citoyenne en français libre, choisit la meilleure couche via
 *   `recommend_layers_for_intent`, puis exécute le bon outil sous-jacent
 *   (`search_nearby` si lat/lon fournis, `query_layer` sinon).
 *
 * Garde-fous :
 *   - Toujours en mode public (jamais d'élévation).
 *   - Jamais d'invention (horaires, disponibilités, réglementation, etc.).
 *   - Si la question semble localisée mais sans coordonnées : statut
 *     `needs_location` avec un message citoyen clair, pas de fallback risqué.
 *   - Si aucune couche ne matche : statut `out_of_scope` avec une
 *     orientation explicite vers les canaux officiels.
 *   - Jamais d'`OBJECTID` brut côté travaux : on délègue aux outils
 *     existants qui appliquent déjà la sanitisation de sortie.
 *
 * On reste dans les 17 outils publics — pas de nouvelle dépendance.
 */

import type { AppConfig } from "../config.js";
import { runRecommendLayersForIntent } from "./recommendLayersForIntent.js";
import { runQueryLayer, runSearchNearby } from "./queryLayer.js";
import { runSearchPublicWorksNearby, runListPublicWorks } from "./publicWorks.js";
import { isAppError } from "../utils/errors.js";

/**
 * Disclaimers récurrents dans la sortie. On les concentre ici pour rester
 * cohérent et facilement testable.
 */
const DISCLAIMER =
  "Données indicatives issues du SIG public d'Annecy, à vérifier via les canaux officiels pour une démarche administrative.";

const NO_INVENTION_NOTE =
  "Cet outil ne renseigne ni les horaires en temps réel, ni la disponibilité, ni les informations réglementaires opposables.";

const NEEDS_LOCATION_HINT =
  "Précisez un lieu (adresse, quartier, point GPS) pour que je puisse chercher les éléments les plus proches.";

const OUT_OF_SCOPE_HINT =
  "Ce service expose uniquement les couches SIG publiques d'Annecy (équipements, mobilité, vue travaux citoyenne). Pour toute autre demande, consulter les canaux officiels de la Ville d'Annecy.";

/**
 * Message dédié aux refus RGPD / données nominatives / documents opposables.
 * Réponse sobre, non technique, oriente vers les canaux officiels.
 */
const OUT_OF_SCOPE_PERSONAL_DATA_MESSAGE =
  "Cette demande sort du périmètre du SIG public d'Annecy. Le service ne donne pas accès aux coordonnées personnelles, aux données internes ou aux informations nominatives d'agents. Pour une demande officielle, utilisez les canaux de contact de la Ville d'Annecy.";

export interface CitizenQueryInput {
  query: string;
  lat?: number;
  lon?: number;
  radiusMeters?: number;
  limit?: number;
}

export type CitizenQueryStatus =
  | "answered"
  | "needs_location"
  | "out_of_scope"
  | "error";

export interface CitizenQueryItem {
  /** Libellé court (mappé sur `labelField` de la couche si dispo). */
  label?: string;
  /** Adresse / commune si disponibles. */
  address?: string;
  /** Distance (m) si l'outil sous-jacent l'a calculée. */
  distance_m?: number;
  /** Bloc de propriétés sanitisé (déjà filtré par les outils existants). */
  properties?: Record<string, unknown>;
  /** Géométrie GeoJSON si fournie par l'outil sous-jacent. */
  geometry?: unknown;
}

export interface CitizenQueryResult {
  query: string;
  status: CitizenQueryStatus;
  citizenAnswer: string;
  recommendedTool?: string;
  recommendedArguments?: Record<string, unknown>;
  items: CitizenQueryItem[];
  limitations: string[];
  source: { type: "annecy_sig_mcp_citizen_router"; mode: "public" };
}

/**
 * Heuristique légère : la question contient-elle une intention spatiale
 * (« près de … », « proche », « à proximité », « autour », etc.) ?
 *
 * On accepte les variantes morphologiques (pluriels, féminins) en s'appuyant
 * sur des préfixes plutôt que des mots stricts.
 */
function hasSpatialIntent(query: string): boolean {
  const normalised = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  // Préfixes plutôt que mots stricts : capture "proche" / "proches" /
  // "proximite" / "alentour" / "alentours" / "abord" / "abords" /
  // "près" → "pres".
  return /(?:^|\s)(pres|proch|proxim|autour|alentour|abord|nearby|near|a cote|cote de)/i.test(
    normalised,
  );
}

/**
 * Heuristique : la question vise-t-elle l'univers travaux ?
 * On préfère router vers `list_public_works` / `search_public_works_nearby`
 * plutôt que vers la couche brute (qui n'est pas exposée en public).
 *
 * On n'utilise pas `\b` pour autoriser les variantes morphologiques
 * (« travaux », « chantiers », « perturbations », « déviations » après NFD).
 */
export function isWorksIntent(query: string): boolean {
  const norm = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return (
    /(travau|chantier|voirie|deviation|perturbation)/.test(norm) ||
    /(rue|route|voie)\s+(barr|ferm|coup)/.test(norm) ||
    /(circulation\s+pertur)/.test(norm)
  );
}

/**
 * Heuristique : la question demande-t-elle des données hors-périmètre du SIG
 * public (données nominatives d'agents, contact direct, RGPD, documents
 * officiels opposables) ?
 *
 * Détectée AVANT tout routing couche pour éviter de retourner des résultats
 * absurdes (ex. couche « Cimetière » en réponse à une question sur les
 * coordonnées d'un agent municipal).
 */
export function isOutOfScopeIntent(query: string): boolean {
  const norm = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const hasMunicipalContext =
    /(mairie|municipa|ville d'annecy|ville annecy|commune|service|sig|voirie|technique|administratif|rh)/.test(
      norm,
    );
  const hasPersonRole =
    /(agent|employe|personnel|salarie|fonctionnaire|elu|cadre|directeur|responsable)/.test(
      norm,
    );
  const hasContactField =
    /(telephone|portable|mobile|email|mail|adresse|contact|coordonnee)/.test(norm);

  // Combo « rôle municipal + champ contact » → contact d'agent (cas type
  // « téléphone d'un agent municipal », « email d'un employé de la mairie »,
  // « coordonnées personnelles des agents de la voirie »).
  if (hasPersonRole && hasContactField) return true;
  // Variante : le contexte municipal + un champ de contact direct sans le
  // mot « agent » (ex. « téléphone du service voirie en direct »).
  if (hasMunicipalContext && /(coordonnees personnelles?|contact direct|telephone (personnel|prive)|email personnel|adresse personnelle|adresse privee|domicile)/.test(norm)) {
    return true;
  }
  // Données nominatives / RH / rémunération.
  if (
    /(donnees? nominatives?|donnees? personnelles?|donnees? rh|salaire|remuneration|fiche de paie|contrat de travail|ressources humaines)/.test(
      norm,
    )
  ) {
    return true;
  }
  // Documents officiels opposables — hors périmètre d'un SIG indicatif.
  if (
    /(certificat|attestation officielle|document officiel|decision administrative|arrete officiel|piece justificative)/.test(
      norm,
    )
  ) {
    return true;
  }
  return false;
}

interface ItemFromArcgisFeature {
  properties?: Record<string, unknown>;
  geometry?: unknown;
}

function extractLabel(props: Record<string, unknown> | undefined): string | undefined {
  if (!props) return undefined;
  for (const key of ["denomination", "nom", "titre", "titre_public", "site", "label"]) {
    const v = props[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return undefined;
}

function extractAddress(props: Record<string, unknown> | undefined): string | undefined {
  if (!props) return undefined;
  const adresse = props["adresse"];
  const commune = props["commune"] ?? props["commune_deleguee"] ?? props["secteur_public"];
  const parts: string[] = [];
  if (typeof adresse === "string" && adresse.trim().length > 0) parts.push(adresse);
  if (typeof commune === "string" && commune.trim().length > 0) parts.push(commune);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function buildItem(feature: ItemFromArcgisFeature, distance?: number): CitizenQueryItem {
  const props = feature.properties ?? undefined;
  return {
    label: extractLabel(props),
    address: extractAddress(props),
    distance_m: typeof distance === "number" ? distance : undefined,
    properties: props,
    geometry: feature.geometry,
  };
}

/**
 * Si l'utilisateur cible explicitement les travaux, on déroule la vue
 * public-light (jamais la couche brute).
 */
async function handleWorksIntent(
  cfg: AppConfig,
  input: CitizenQueryInput,
): Promise<CitizenQueryResult> {
  if (typeof input.lat === "number" && typeof input.lon === "number") {
    const out = await runSearchPublicWorksNearby(cfg, {
      latitude: input.lat,
      longitude: input.lon,
      radiusMeters: input.radiusMeters,
      limit: input.limit ?? 10,
    });
    const items: CitizenQueryItem[] = out.items.map(it => ({
      label: it.titre_public ?? undefined,
      address: it.secteur_public ?? it.commune_deleguee ?? undefined,
      distance_m: it.distance_m ?? undefined,
      properties: { ...it },
    }));
    return {
      query: input.query,
      // Demande dans le périmètre (travaux) → "answered" même si 0 résultat
      // côté API publique. "out_of_scope" est réservé aux demandes hors
      // périmètre (RGPD, données nominatives, etc.).
      status: "answered",
      citizenAnswer:
        items.length > 0
          ? `J'ai trouvé ${items.length} chantier(s) à proximité, vue citoyenne filtrée. ${DISCLAIMER}`
          : `Aucun chantier connu à cette distance. ${DISCLAIMER}`,
      recommendedTool: "search_public_works_nearby",
      recommendedArguments: {
        latitude: input.lat,
        longitude: input.lon,
        radiusMeters: input.radiusMeters ?? 500,
        limit: input.limit ?? 10,
      },
      items,
      limitations: [NO_INVENTION_NOTE, "Vue citoyenne filtrée — pas d'arrêté complet, pas de pièce jointe."],
      source: { type: "annecy_sig_mcp_citizen_router", mode: "public" },
    };
  }
  // Sans coordonnées : on liste les travaux actifs sur le périmètre Annecy.
  const out = await runListPublicWorks(cfg, { mode: "public", limit: input.limit ?? 10 });
  const items: CitizenQueryItem[] = out.items.map(it => ({
    label: it.titre_public ?? undefined,
    address: it.secteur_public ?? it.commune_deleguee ?? undefined,
    properties: { ...it },
  }));
  return {
    query: input.query,
    // Idem branche géolocalisée : demande dans le périmètre, statut
    // "answered" même quand aucun chantier n'est référencé.
    status: "answered",
    citizenAnswer:
      items.length > 0
        ? `Voici les travaux actifs (vue citoyenne filtrée). Pour cibler un quartier précis, indiquez un lieu. ${DISCLAIMER}`
        : `Aucun chantier actif n'est référencé pour aujourd'hui. ${DISCLAIMER}`,
    recommendedTool: "list_public_works",
    recommendedArguments: { limit: input.limit ?? 10 },
    items,
    limitations: [NO_INVENTION_NOTE, "Aucune coordonnée fournie : la précision géographique est limitée."],
    source: { type: "annecy_sig_mcp_citizen_router", mode: "public" },
  };
}

export async function runCitizenQuery(
  cfg: AppConfig,
  input: CitizenQueryInput,
): Promise<CitizenQueryResult> {
  const trimmed = input.query.trim();
  if (trimmed.length < 2) {
    return {
      query: trimmed,
      status: "out_of_scope",
      citizenAnswer: "Pouvez-vous reformuler la question avec un peu plus de détails ?",
      items: [],
      limitations: [],
      source: { type: "annecy_sig_mcp_citizen_router", mode: "public" },
    };
  }

  // Cas spécial — out_of_scope explicite (RGPD, données nominatives,
  // documents opposables) : on bloque AVANT tout routing pour éviter
  // les fallbacks absurdes (ex. couche « Cimetière » en réponse à une
  // question sur les coordonnées d'un agent municipal).
  if (isOutOfScopeIntent(trimmed)) {
    return {
      query: trimmed,
      status: "out_of_scope",
      citizenAnswer: OUT_OF_SCOPE_PERSONAL_DATA_MESSAGE,
      items: [],
      limitations: [NO_INVENTION_NOTE],
      source: { type: "annecy_sig_mcp_citizen_router", mode: "public" },
    };
  }

  // Cas spécial — travaux : on délègue à la vue public-light, pas au router
  // générique (la couche brute n'est jamais publique).
  if (isWorksIntent(trimmed)) {
    try {
      return await handleWorksIntent(cfg, { ...input, query: trimmed });
    } catch (e) {
      const message = isAppError(e) ? e.message : e instanceof Error ? e.message : "erreur interne";
      return {
        query: trimmed,
        status: "error",
        citizenAnswer:
          "Le service travaux est temporairement indisponible. Réessayez plus tard ou contactez la Ville d'Annecy.",
        items: [],
        limitations: [NO_INVENTION_NOTE, message],
        source: { type: "annecy_sig_mcp_citizen_router", mode: "public" },
      };
    }
  }

  // Cas général : on demande au routeur d'intention quelle couche est
  // pertinente. Sans coordonnées et avec une intention spatiale, on demande
  // poliment une localisation plutôt que d'inventer.
  const recommendation = runRecommendLayersForIntent(cfg, {
    intent: trimmed,
    mode: "public",
    lat: input.lat,
    lon: input.lon,
    radiusMeters: input.radiusMeters,
    limit: input.limit,
    maxRecommendations: 1,
  });
  const top = recommendation.recommendations[0];

  if (!top) {
    return {
      query: trimmed,
      status: "out_of_scope",
      citizenAnswer:
        "Je ne sais pas répondre à cette question avec les données SIG publiques d'Annecy. " +
        OUT_OF_SCOPE_HINT,
      items: [],
      limitations: [NO_INVENTION_NOTE],
      source: { type: "annecy_sig_mcp_citizen_router", mode: "public" },
    };
  }

  const hasLocation = typeof input.lat === "number" && typeof input.lon === "number";
  const wantsLocation = hasSpatialIntent(trimmed) || top.suggestedCall.tool === "search_nearby";

  if (wantsLocation && !hasLocation) {
    return {
      query: trimmed,
      status: "needs_location",
      citizenAnswer: `Je peux chercher dans la couche « ${top.layerName} », mais j'ai besoin d'un lieu de référence. ${NEEDS_LOCATION_HINT}`,
      recommendedTool: "search_nearby",
      recommendedArguments: top.suggestedCall.args,
      items: [],
      limitations: [NO_INVENTION_NOTE],
      source: { type: "annecy_sig_mcp_citizen_router", mode: "public" },
    };
  }

  try {
    if (top.suggestedCall.tool === "search_nearby" && hasLocation) {
      const out = await runSearchNearby(cfg, {
        serviceKey: top.serviceKey,
        layerId: top.layerId,
        lat: input.lat as number,
        lon: input.lon as number,
        radiusMeters: input.radiusMeters ?? 1000,
        limit: input.limit ?? 10,
        mode: "public",
      });
      const features = (out as { features?: Array<ItemFromArcgisFeature & { distance_m?: number }> }).features ?? [];
      const items = features.map(f => buildItem(f, f.distance_m));
      return {
        query: trimmed,
        status: items.length > 0 ? "answered" : "answered",
        citizenAnswer:
          items.length > 0
            ? `J'ai trouvé ${items.length} résultat(s) dans la couche « ${top.layerName} ». ${DISCLAIMER}`
            : `Aucun résultat à proximité dans la couche « ${top.layerName} ». ${DISCLAIMER}`,
        recommendedTool: "search_nearby",
        recommendedArguments: top.suggestedCall.args,
        items,
        limitations: [NO_INVENTION_NOTE],
        source: { type: "annecy_sig_mcp_citizen_router", mode: "public" },
      };
    }

    const out = await runQueryLayer(cfg, {
      serviceKey: top.serviceKey,
      layerId: top.layerId,
      limit: input.limit ?? 25,
      mode: "public",
    });
    const features = (out as { features?: ItemFromArcgisFeature[] }).features ?? [];
    const items = features.map(f => buildItem(f));
    return {
      query: trimmed,
      status: "answered",
      citizenAnswer:
        items.length > 0
          ? `Voici ${items.length} élément(s) dans la couche « ${top.layerName} ». ${DISCLAIMER}`
          : `Aucun élément trouvé pour cette question dans la couche « ${top.layerName} ». ${DISCLAIMER}`,
      recommendedTool: "query_layer",
      recommendedArguments: top.suggestedCall.args,
      items,
      limitations: [NO_INVENTION_NOTE],
      source: { type: "annecy_sig_mcp_citizen_router", mode: "public" },
    };
  } catch (e) {
    const message = isAppError(e) ? e.message : e instanceof Error ? e.message : "erreur interne";
    return {
      query: trimmed,
      status: "error",
      citizenAnswer:
        "Une erreur est survenue côté service SIG. Réessayez dans quelques instants.",
      recommendedTool: top.suggestedCall.tool,
      recommendedArguments: top.suggestedCall.args,
      items: [],
      limitations: [NO_INVENTION_NOTE, message],
      source: { type: "annecy_sig_mcp_citizen_router", mode: "public" },
    };
  }
}
