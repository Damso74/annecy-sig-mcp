import type { AppConfig } from "../config.js";
import { AppError } from "../utils/errors.js";
import { queryLayerRequest } from "../arcgis/client.js";
import { lowerPropertyKeys } from "../utils/properties.js";
import { timestampMsToIsoString } from "../utils/dates.js";
import {
  geometryIsNullOrEmpty,
  representativeLatLon,
  type LatLon,
} from "../utils/geometry.js";
import { haversineMeters } from "../utils/distance.js";
import { parseLatLon, parseRadiusMeters } from "../utils/validation.js";
import { buildPublicWorkId } from "../utils/publicId.js";
import { SERVER_VERSION } from "../runtime/version.js";
import type {
  PublicWorkItem,
  PublicWorkNearbyItem,
  PublicWorksNearbyResult,
  PublicWorksResult,
} from "../contracts/publicWorksContracts.js";

/**
 * V1.0 — vue **travaux public-light**.
 *
 * Pourquoi un fichier dédié ?
 * - La couche travaux est déclarée `visibility: "internal"` dans `src/registry.ts`
 *   et reste réservée au mode internal pour les outils `query_layer`,
 *   `list_current_works`, `list_late_works`. Ce fichier expose une **vue
 *   strictement publique et filtrée** au-dessus de la même source ArcGIS,
 *   sans déverrouiller le mode internal pour autant.
 * - Le filtrage est porté **deux fois** : (1) on demande à ArcGIS uniquement
 *   les `outFields` de l’allowlist publique ; (2) la sortie passe par
 *   `normalizePublicWorkFeature` + `assertNoSensitivePublicWorkKeys` qui
 *   garantissent qu’aucun champ sensible ne fuit même si la source ArcGIS
 *   en renvoyait par mégarde.
 * - La couche travaux **doit** être accessible publiquement côté ArcGIS
 *   (le `servicePath` `FLUX_SITE_INTERNET/TRAVAUX/MapServer` est exposé
 *   sur le portail public). Si elle ne l’est pas, un `AppError` clair est
 *   levé, **sans** retomber sur un mode internal masqué.
 *
 * Tout est volontairement aligné sur `public_works.v1` — voir
 * `src/contracts/publicWorksContracts.ts`.
 */

const TRAVAUX_SERVICE = "travaux";
const TRAVAUX_LAYER = 3;
const TRAVAUX_PUBLIC_PATH = "FLUX_SITE_INTERNET/TRAVAUX/MapServer";

/**
 * Allowlist explicite des `outFields` demandés à ArcGIS pour la vue public-light.
 * Tout champ hors liste est ignoré (et de toute façon refusé par
 * `assertNoSensitivePublicWorkKeys` en sortie).
 */
const PUBLIC_WORKS_OUT_FIELDS = [
  "objectid",
  "ac_num",
  "ac_date_debut",
  "ac_date_fin",
  "controle_resultat",
  "titre",
  "adresse",
  "commune_deleguee",
] as const;

/**
 * Liste **dure** de motifs de clés qui ne doivent jamais apparaître dans une
 * sortie public-light. C’est la garantie testable côté `tests/v1.0.publicWorks.test.ts`.
 *
 * Important : toute clé de la sortie publique est testée contre cette liste,
 * et toute clé contenant l’une de ces sous-chaînes (insensible à la casse)
 * fait sortir l’appel en erreur.
 */
const FORBIDDEN_PUBLIC_WORK_KEY_SUBSTRINGS = [
  "url_pj",
  "url_piece_jointe",
  "attachment",
  "ac_odp_ref",
  "created_user",
  "created_date",
  "last_edited_user",
  "last_edited_date",
  "token",
  "password",
  "secret",
  "bearer",
  "description",
  "objectid",
] as const;

const TODAY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const PUBLIC_DISCLAIMER =
  "Information indicative issue d’un flux public filtré. Pour une information opposable, consulter les canaux officiels de la Ville.";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Variante locale qui gère **aussi** les géométries Esri (`rings`,
 * `paths`, `x/y`) en plus du GeoJSON pris en charge par
 * `representativeLatLon`. La couche travaux ArcGIS est servie en Esri JSON
 * une fois sur deux (selon le succès du fallback `geojson`), donc on a besoin
 * du support natif Esri ici pour calculer la distance au point requêté.
 */
function publicWorkRepresentativeLatLon(geometry: unknown): LatLon | null {
  const native = representativeLatLon(geometry);
  if (native) return native;
  if (!geometry || typeof geometry !== "object") return null;
  const g = geometry as { rings?: unknown; paths?: unknown };
  if (Array.isArray(g.rings) && g.rings.length > 0) {
    const ring = g.rings[0];
    if (Array.isArray(ring) && ring.length > 0) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const c of ring) {
        if (Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
          sx += c[0];
          sy += c[1];
          n++;
        }
      }
      if (n > 0) return { lon: sx / n, lat: sy / n };
    }
  }
  if (Array.isArray(g.paths) && g.paths.length > 0) {
    const path = g.paths[0];
    if (Array.isArray(path) && path.length > 0) {
      const mid = path[Math.floor(path.length / 2)];
      if (Array.isArray(mid) && Number.isFinite(mid[0]) && Number.isFinite(mid[1])) {
        return { lon: mid[0], lat: mid[1] };
      }
    }
  }
  return null;
}

/**
 * Variante locale du test « géométrie vide » qui considère comme vides les
 * polygones Esri sans `rings`. Suffisant pour la vue public-light.
 */
function publicWorkGeometryIsEmpty(geometry: unknown): boolean {
  if (geometryIsNullOrEmpty(geometry)) return true;
  if (geometry && typeof geometry === "object") {
    const g = geometry as { rings?: unknown; paths?: unknown };
    if (Array.isArray(g.rings) && g.rings.length === 0) return true;
    if (Array.isArray(g.paths) && g.paths.length === 0) return true;
  }
  return false;
}

function isoDateOrToday(raw?: string): string {
  if (!raw || !raw.trim()) return todayIso();
  const t = raw.trim();
  if (TODAY_REGEX.test(t)) return t;
  const p = Date.parse(t);
  if (!Number.isFinite(p)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Date invalide : fournir une date ISO (YYYY-MM-DD ou chaîne ISO 8601).",
      {},
    );
  }
  return new Date(p).toISOString().slice(0, 10);
}

function clampLimit(raw: number | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new AppError("VALIDATION_ERROR", "limit doit être un entier ≥ 1.", {});
  }
  return Math.min(Math.floor(n), max);
}

/**
 * Mappe le statut ArcGIS brut vers une étiquette citoyenne stable. Tout statut
 * inconnu retombe sur « Statut non renseigné » (jamais d’invention).
 */
export function simplifyWorkStatus(rawStatus: unknown): string {
  if (rawStatus === null || rawStatus === undefined) return "Statut non renseigné";
  const s = String(rawStatus).trim();
  if (s === "") return "Statut non renseigné";
  const lower = s.toLowerCase();
  if (lower === "en cours") return "En cours";
  if (lower === "pas commencé" || lower === "pas commence" || lower === "à venir") return "À venir";
  if (lower === "en cours hors délai" || lower === "en cours hors delai") return "En retard";
  if (lower === "en réfection provisoire" || lower === "en refection provisoire") {
    return "Réfection provisoire";
  }
  if (lower === "en réfection définitive" || lower === "en refection definitive") {
    return "Réfection définitive";
  }
  return "Statut non renseigné";
}

/**
 * Construit un titre public sécurisé.
 *
 * Règles :
 * - si `rawTitle` est non vide ET ne contient pas de motif sensible
 *   (numéro d’arrêté brut, référence interne) → on l’utilise tel quel ;
 * - si le titre est générique (« Travaux suivant l’arrêté… ») → on retombe
 *   sur un libellé neutre ;
 * - si rien n’est exploitable → « Travaux sur voirie » par défaut.
 */
export function buildPublicWorkTitle(
  rawTitle: unknown,
  _rawAcNum?: unknown,
): string {
  if (rawTitle === null || rawTitle === undefined) return "Travaux sur voirie";
  const raw = String(rawTitle).trim();
  if (raw === "") return "Travaux sur voirie";
  const lower = raw.toLowerCase();
  if (lower.includes("suivant l'arrêté") || lower.includes("suivant l’arrêté") || lower.includes("suivant l'arrete")) {
    return "Travaux sur voirie";
  }
  // On n’expose volontairement jamais le `ac_num` pour ne pas révéler le
  // numéro d’arrêté complet — cf. politique sécurité.
  return raw;
}

/**
 * Construit le secteur public à partir de l’adresse / commune. N’invente jamais.
 */
export function buildPublicWorkSector(
  rawAddress: unknown,
  rawCommune?: unknown,
): string | null {
  const addr = rawAddress === null || rawAddress === undefined ? "" : String(rawAddress).trim();
  if (addr !== "") return addr;
  const com = rawCommune === null || rawCommune === undefined ? "" : String(rawCommune).trim();
  if (com !== "") return com;
  return null;
}

/**
 * Identifiant public **opaque** dérivé de `(serviceKey, layerId, objectid, salt)`
 * via SHA-256 (12 caractères hex). Détails dans `src/utils/publicId.ts`.
 *
 * On centralise ici pour conserver la convention `serviceKey + layerId`
 * propre à la couche travaux ; tout outil public-light futur peut réutiliser
 * `buildPublicWorkId` directement.
 */
function publicWorkIdForFeature(rawObjectId: unknown): string {
  return buildPublicWorkId(TRAVAUX_SERVICE, TRAVAUX_LAYER, rawObjectId);
}

/**
 * Filtre la géométrie selon `includeGeometry`. Si désactivée, on retire la clé
 * (et non `geometry: null`) pour rester cohérent avec le contrat optionnel.
 */
export function redactPublicWorkGeometry(
  geometry: unknown,
  includeGeometry: boolean,
): { include: boolean; value?: unknown } {
  if (!includeGeometry) return { include: false };
  if (publicWorkGeometryIsEmpty(geometry)) return { include: false };
  return { include: true, value: geometry };
}

/**
 * Garde-fou final : aucune clé sensible ne doit traverser la sortie publique.
 * Lève une `AppError("INTERNAL_ERROR")` si une clé interdite est détectée —
 * c’est volontairement défensif (le mapping en amont ne devrait jamais en
 * produire, mais on refuse de fuiter en silence).
 */
export function assertNoSensitivePublicWorkKeys(payload: unknown): void {
  function check(obj: unknown, path: string): void {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => check(v, `${path}[${i}]`));
      return;
    }
    if (typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      for (const forbidden of FORBIDDEN_PUBLIC_WORK_KEY_SUBSTRINGS) {
        if (lower.includes(forbidden)) {
          throw new AppError(
            "INTERNAL_ERROR",
            `Fuite potentielle dans la vue travaux public-light : clé interdite "${k}" à ${path}.`,
            { hint: "Bug serveur — voir src/tools/publicWorks.ts." },
          );
        }
      }
      check(v, path === "" ? k : `${path}.${k}`);
    }
  }
  check(payload, "");
}

/**
 * Normalise une feature ArcGIS travaux en un `PublicWorkItem` strictement
 * filtré. Applique tous les garde-fous public-light :
 * - mappe uniquement les champs allowlistés ;
 * - simplifie statut + titre + secteur ;
 * - dérive les `qualityFlags` publics (booléens uniquement) ;
 * - applique `assertNoSensitivePublicWorkKeys` sur le résultat final.
 */
export function normalizePublicWorkFeature(feature: {
  properties: Record<string, unknown>;
  geometry: unknown;
  includeGeometry?: boolean;
}): PublicWorkItem {
  const p = lowerPropertyKeys(feature.properties);
  const d1 = timestampMsToIsoString(p.ac_date_debut);
  const d2 = timestampMsToIsoString(p.ac_date_fin);

  const flags: PublicWorkItem["qualityFlags"] = {};
  if (publicWorkGeometryIsEmpty(feature.geometry)) flags.missingGeometry = true;
  if (!p.adresse || String(p.adresse).trim() === "") flags.missingAddress = true;
  if (!p.titre || String(p.titre).trim() === "") flags.missingTitle = true;
  const nd = Number(p.ac_date_debut);
  const nf = Number(p.ac_date_fin);
  if (Number.isFinite(nd) && Number.isFinite(nf) && nf < nd) flags.dateIncoherence = true;

  const geo = redactPublicWorkGeometry(feature.geometry, feature.includeGeometry === true);

  const titrePublic = buildPublicWorkTitle(p.titre, p.ac_num);
  const statutPublic = simplifyWorkStatus(p.controle_resultat);
  const secteurPublic = buildPublicWorkSector(p.adresse, p.commune_deleguee);
  const communeDeleguee =
    p.commune_deleguee === null || p.commune_deleguee === undefined
      ? null
      : String(p.commune_deleguee).trim() === ""
        ? null
        : String(p.commune_deleguee).trim();

  const item: PublicWorkItem = {
    id_public: publicWorkIdForFeature(p.objectid ?? p.OBJECTID),
    titre_public: titrePublic === "" ? null : titrePublic,
    statut_public: statutPublic === "" ? null : statutPublic,
    date_debut_iso: d1.value,
    date_fin_iso: d2.value,
    secteur_public: secteurPublic,
    commune_deleguee: communeDeleguee,
    qualityFlags: flags,
  };
  if (geo.include) {
    item.geometry = geo.value;
  }
  assertNoSensitivePublicWorkKeys(item);
  return item;
}

function whereForStatus(
  status: "active" | "upcoming" | "late" | "all" | undefined,
  isoDay: string,
): string {
  switch (status ?? "active") {
    case "active":
      return `ac_date_debut <= date '${isoDay}' AND ac_date_fin >= date '${isoDay}'`;
    case "upcoming":
      return `ac_date_debut > date '${isoDay}'`;
    case "late":
      return `controle_resultat = 'En cours hors délai'`;
    case "all":
      return "1=1";
  }
}

function buildSourceList(consultedAt: string) {
  return {
    type: "annecy_sig_mcp_public_works" as const,
    schemaVersion: "public_works.v1" as const,
    serverVersion: SERVER_VERSION,
    mode: "public" as const,
    filtered: true as const,
    rawLayerExposed: false as const,
    consultedAt,
    disclaimer: PUBLIC_DISCLAIMER,
  };
}

function buildSourceNearby(consultedAt: string) {
  return {
    ...buildSourceList(consultedAt),
    type: "annecy_sig_mcp_public_works_nearby" as const,
  };
}

/**
 * Refus explicite si l’appelant force `mode=internal`. Cohérent avec le verrou
 * du transport HTTP public, mais redoublé ici pour ne jamais laisser passer en
 * cas d’appel direct.
 */
function assertModeIsPublic(mode: string | undefined): void {
  if (mode !== undefined && mode !== "public") {
    throw new AppError(
      "FORBIDDEN",
      "Les outils travaux public-light n’acceptent que mode=public. Pour les données internes, utiliser le MCP local stdio (mode internal).",
      { hint: "Retirer le paramètre mode ou le fixer à \"public\"." },
    );
  }
}

/**
 * Centralise le wrap autour de `queryLayerRequest` pour signaler proprement le
 * cas « couche non accessible publiquement » avec un message exploitable côté
 * client.
 */
async function callPublicTravauxQuery(
  cfg: AppConfig,
  params: Parameters<typeof queryLayerRequest>[0],
): ReturnType<typeof queryLayerRequest> {
  try {
    return await queryLayerRequest(params, cfg);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // ArcGIS répond typiquement 401/403/498/499 ou « Token Required » quand
    // la couche n’est pas anonyme. On expose un message uniforme côté client.
    if (
      /token required/i.test(msg) ||
      /unauthorized/i.test(msg) ||
      /forbidden/i.test(msg) ||
      /HTTP 40[13]/i.test(msg) ||
      /HTTP 49[89]/i.test(msg)
    ) {
      throw new AppError(
        "FORBIDDEN",
        "La couche travaux n’est pas accessible publiquement par ce serveur. Utiliser les canaux officiels ou le MCP local internal validé DSI.",
        { hint: "Vérifier la visibilité ArcGIS de la couche FLUX_SITE_INTERNET/TRAVAUX/MapServer/3." },
      );
    }
    throw e;
  }
}

export interface ListPublicWorksInput {
  mode?: "public";
  date?: string;
  status?: "active" | "upcoming" | "late" | "all";
  limit?: number;
  includeGeometry?: boolean;
  commune?: string;
}

export async function runListPublicWorks(
  cfg: AppConfig,
  input: ListPublicWorksInput,
): Promise<PublicWorksResult> {
  assertModeIsPublic(input.mode);
  const isoDay = isoDateOrToday(input.date);
  const limit = clampLimit(input.limit, 20, 100);
  const includeGeometry = input.includeGeometry === true;
  const status = input.status ?? "active";

  let where = whereForStatus(status, isoDay);
  if (input.commune && input.commune.trim() !== "") {
    // Anti-injection : on échappe les apostrophes pour rester compatible SQL ArcGIS.
    const safe = input.commune.trim().replace(/'/g, "''");
    if (safe.length > 80) {
      throw new AppError("VALIDATION_ERROR", "commune trop longue (max 80 caractères).", {});
    }
    where = `(${where}) AND commune_deleguee = '${safe}'`;
  }

  const consultedAt = new Date().toISOString();
  const warnings: string[] = [];

  const parsed = await callPublicTravauxQuery(cfg, {
    serviceKey: TRAVAUX_SERVICE,
    layerId: TRAVAUX_LAYER,
    servicePath: TRAVAUX_PUBLIC_PATH,
    where,
    outFields: PUBLIC_WORKS_OUT_FIELDS.join(","),
    returnGeometry: includeGeometry,
    outSR: 4326,
    limit,
  });

  if (parsed.formatUsed === "json") {
    warnings.push("Réponse Esri JSON normalisée côté serveur.");
  }

  const items = parsed.features.map(f =>
    normalizePublicWorkFeature({
      properties: f.properties,
      geometry: f.geometry,
      includeGeometry,
    }),
  );

  if (items.some(i => i.qualityFlags.missingGeometry) && includeGeometry) {
    warnings.push(
      "Au moins une entité sans géométrie utile : aucune coordonnée n’a été inventée.",
    );
  }

  const result: PublicWorksResult = {
    items,
    count: items.length,
    date: isoDay,
    warnings,
    source: buildSourceList(consultedAt),
  };
  assertNoSensitivePublicWorkKeys(result);
  return result;
}

export interface SearchPublicWorksNearbyInput {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  date?: string;
  limit?: number;
  includeGeometry?: boolean;
}

export async function runSearchPublicWorksNearby(
  cfg: AppConfig,
  input: SearchPublicWorksNearbyInput,
): Promise<PublicWorksNearbyResult> {
  const { lat, lon } = parseLatLon(input.latitude, input.longitude);
  const radiusMeters = parseRadiusMeters(
    input.radiusMeters,
    500,
    cfg.maxSearchRadiusMeters,
  );
  const isoDay = isoDateOrToday(input.date);
  const limit = clampLimit(input.limit, 10, 50);
  const includeGeometry = input.includeGeometry === true;
  const consultedAt = new Date().toISOString();
  const warnings: string[] = [];

  const where = whereForStatus("active", isoDay);
  // On demande systématiquement la géométrie côté ArcGIS pour pouvoir trier par
  // distance ; la sortie respecte tout de même `includeGeometry` côté client.
  let parsed: Awaited<ReturnType<typeof queryLayerRequest>>;
  let spatialServerFilterUsed = true;
  try {
    parsed = await callPublicTravauxQuery(cfg, {
      serviceKey: TRAVAUX_SERVICE,
      layerId: TRAVAUX_LAYER,
      servicePath: TRAVAUX_PUBLIC_PATH,
      where,
      outFields: PUBLIC_WORKS_OUT_FIELDS.join(","),
      returnGeometry: true,
      outSR: 4326,
      limit: Math.min(cfg.maxResultLimit, Math.max(limit * 5, 100)),
      geometry: `${lon},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      distance: radiusMeters,
      units: "esriSRUnit_Meter",
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") throw e;
    spatialServerFilterUsed = false;
    warnings.push(
      "Filtre spatial ArcGIS indisponible : fallback sur requête large + filtre Haversine côté serveur.",
    );
    parsed = await callPublicTravauxQuery(cfg, {
      serviceKey: TRAVAUX_SERVICE,
      layerId: TRAVAUX_LAYER,
      servicePath: TRAVAUX_PUBLIC_PATH,
      where,
      outFields: PUBLIC_WORKS_OUT_FIELDS.join(","),
      returnGeometry: true,
      outSR: 4326,
      limit: Math.min(cfg.maxResultLimit, Math.max(limit * 10, 200)),
    });
  }

  if (spatialServerFilterUsed) {
    warnings.push("Filtre spatial serveur ArcGIS appliqué avant tri Haversine local.");
  }

  const itemsWithDistance: PublicWorkNearbyItem[] = [];
  let geometryUnusableCount = 0;
  for (const f of parsed.features) {
    const rep = publicWorkRepresentativeLatLon(f.geometry);
    if (!rep) {
      // Sans géométrie exploitable, impossible de garantir la pertinence
      // « près de moi » — on retire l’entité plutôt que de la fournir sans
      // distance (cohérent avec le contrat citoyen).
      geometryUnusableCount++;
      continue;
    }
    const distance_m = haversineMeters(lat, lon, rep.lat, rep.lon);
    if (distance_m > radiusMeters) continue;
    const base = normalizePublicWorkFeature({
      properties: f.properties,
      geometry: f.geometry,
      includeGeometry,
    });
    itemsWithDistance.push({ ...base, distance_m });
  }

  if (geometryUnusableCount > 0) {
    warnings.push(
      `${geometryUnusableCount} entité(s) ignorée(s) faute de géométrie exploitable.`,
    );
  }

  itemsWithDistance.sort((a, b) => {
    const da = a.distance_m ?? Number.POSITIVE_INFINITY;
    const db = b.distance_m ?? Number.POSITIVE_INFINITY;
    return da - db;
  });
  const sliced = itemsWithDistance.slice(0, limit);

  const result: PublicWorksNearbyResult = {
    items: sliced,
    count: sliced.length,
    radiusMeters,
    warnings,
    source: buildSourceNearby(consultedAt),
  };
  assertNoSensitivePublicWorkKeys(result);
  return result;
}

/**
 * Exposé pour les tests : la liste exacte des `outFields` allowlistés que ces
 * outils peuvent demander à ArcGIS.
 */
export const PUBLIC_WORKS_ALLOWED_OUT_FIELDS = PUBLIC_WORKS_OUT_FIELDS;
export const PUBLIC_WORKS_FORBIDDEN_KEY_SUBSTRINGS =
  FORBIDDEN_PUBLIC_WORK_KEY_SUBSTRINGS;
