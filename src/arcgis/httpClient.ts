import type { AppConfig } from "../config.js";
import { AppError } from "../utils/errors.js";
import { assertArcgisUrl } from "./urls.js";

/**
 * V0.8 — abstraction HTTP minimale pour le client ArcGIS.
 *
 * Objectif : permettre l’injection d’un client mock en test (fixtures offline) sans perdre
 * les garde-fous (allowlist d’hôte, HTTPS, préfixe `ANNECY_SIG_BASE_URL`, lecture seule).
 *
 * Le client doit :
 * - effectuer un GET (jamais un POST / autre verbe) ;
 * - appliquer les garde-fous d’URL (`assertArcgisUrl`) ;
 * - respecter `cfg.arcgisTimeoutMs` ;
 * - retourner le JSON parsé ou jeter `AppError("ARCGIS_ERROR", …)`.
 *
 * Le cache mémoire reste interne au client réseau pour ne pas leaker entre tests.
 */
export interface ArcgisHttpClient {
  getJson(url: string, cfg: AppConfig): Promise<unknown>;
}

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const networkCache = new Map<string, CacheEntry>();

let cacheHits = 0;
let cacheMisses = 0;
let lastArcgisErrorAt: number | null = null;
let lastArcgisErrorMessage: string | null = null;

/** Vide le cache GET ArcGIS (utile en test ou en cas de rotation manuelle). */
export function clearArcgisHttpCache(): void {
  networkCache.clear();
}

/** Statistiques runtime du cache HTTP ArcGIS (exposées par `/api/health`). */
export function getArcgisHttpStats(): {
  cacheHits: number;
  cacheMisses: number;
  cacheSize: number;
  lastArcgisErrorAt: string | null;
  lastArcgisErrorMessage: string | null;
} {
  return {
    cacheHits,
    cacheMisses,
    cacheSize: networkCache.size,
    lastArcgisErrorAt: lastArcgisErrorAt ? new Date(lastArcgisErrorAt).toISOString() : null,
    lastArcgisErrorMessage,
  };
}

/** Réinitialise les compteurs (test). */
export function resetArcgisHttpStats(): void {
  cacheHits = 0;
  cacheMisses = 0;
  lastArcgisErrorAt = null;
  lastArcgisErrorMessage = null;
}

/**
 * Heuristique : une URL `?f=pjson` (sans `/query`) est une métadonnée de couche
 * → bénéficie d'un TTL long (`arcgisMetadataCacheTtlMs`). Sinon TTL standard.
 */
function ttlFor(url: string, cfg: AppConfig): number {
  const isMeta = !url.includes("/query") && url.includes("f=pjson");
  return isMeta ? cfg.arcgisMetadataCacheTtlMs : cfg.arcgisCacheTtlMs;
}

export const networkArcgisHttpClient: ArcgisHttpClient = {
  async getJson(url: string, cfg: AppConfig): Promise<unknown> {
    assertArcgisUrl(cfg.annecySigBaseUrl, url, cfg.allowedHost);
    const now = Date.now();
    const cached = networkCache.get(url);
    if (cached && cached.expiresAt > now) {
      cacheHits++;
      return cached.value;
    }
    cacheMisses++;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.arcgisTimeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        lastArcgisErrorAt = Date.now();
        lastArcgisErrorMessage = "timeout";
        throw new AppError("ARCGIS_ERROR", `Timeout ArcGIS après ${cfg.arcgisTimeoutMs} ms.`, {
          hint: "Réduire le volume demandé ou augmenter ARCGIS_TIMEOUT_MS.",
        });
      }
      lastArcgisErrorAt = Date.now();
      lastArcgisErrorMessage = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      lastArcgisErrorAt = Date.now();
      lastArcgisErrorMessage = `HTTP ${res.status}`;
      throw new AppError("ARCGIS_ERROR", `ArcGIS HTTP ${res.status} sur ${url.split("?")[0]}`, {
        details: { status: res.status },
        hint: "Vérifier la disponibilité du portail SIG.",
      });
    }
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as unknown;
      const ttl = ttlFor(url, cfg);
      if (ttl > 0) {
        networkCache.set(url, { expiresAt: now + ttl, value: parsed });
      }
      return parsed;
    } catch {
      lastArcgisErrorAt = Date.now();
      lastArcgisErrorMessage = "non-JSON response";
      throw new AppError("ARCGIS_ERROR", "Réponse ArcGIS non JSON.", {
        details: { snippet: text.slice(0, 200) },
      });
    }
  },
};

let activeClient: ArcgisHttpClient = networkArcgisHttpClient;

/**
 * Remplace (ou réinitialise) le client HTTP ArcGIS actif. Strictement réservé aux tests
 * et aux harness offline : le code de production ne doit jamais l’appeler.
 *
 * Passer `null` pour revenir au client réseau par défaut.
 */
export function setArcgisHttpClient(client: ArcgisHttpClient | null): void {
  activeClient = client ?? networkArcgisHttpClient;
}

/** Récupère le client actif. Utilisé en interne par `client.ts`. */
export function getArcgisHttpClient(): ArcgisHttpClient {
  return activeClient;
}
