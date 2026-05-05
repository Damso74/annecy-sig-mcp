/**
 * Rate limiting léger pour `/api/mcp`.
 *
 * Objectifs :
 * - Protéger l'endpoint contre les abus (brute-force Bearer, DDoS sur outils
 *   lourds) sans rendre Redis obligatoire.
 * - Rester simple et auditables en code (aucune dépendance lourde).
 *
 * Architecture :
 * - `RateLimitStore` est une interface minimale `increment(key, windowMs)`.
 * - Deux implémentations :
 *   1. `InMemoryRateLimitStore` — Map en mémoire de l'instance Vercel. Suffit
 *      en local et en test ; en prod Vercel multi-instance, c'est une
 *      protection partielle (chaque instance compte indépendamment).
 *   2. `UpstashRedisRateLimitStore` — backend Redis Upstash via REST (pas de
 *      driver natif), activé seulement si `UPSTASH_REDIS_REST_URL` *et*
 *      `UPSTASH_REDIS_REST_TOKEN` sont définis. Pas de fallback silencieux :
 *      le store choisi est tracé via `getRateLimitStoreType()`.
 *
 * Les compteurs identifient l'IP par `x-forwarded-for` (premier saut) puis
 * `x-real-ip`, fallback `unknown`. L'IP n'est **jamais** renvoyée au client
 * et apparaît tronquée/hashée dans les logs (cf. `redactIp`).
 */

import { createHash } from "node:crypto";

export interface RateLimitState {
  count: number;
  /** Timestamp absolu (ms) de remise à zéro de la fenêtre. */
  resetAt: number;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<RateLimitState>;
  reset?(key?: string): Promise<void>;
}

export type RateLimitStoreType = "memory" | "upstash" | "disabled";

/** Implémentation locale : Map → { count, resetAt }. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, RateLimitState>();

  async increment(key: string, windowMs: number): Promise<RateLimitState> {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const state: RateLimitState = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, state);
      // Snapshot pour éviter qu'un appelant tienne une référence mutable.
      return { count: state.count, resetAt: state.resetAt };
    }
    existing.count += 1;
    return { count: existing.count, resetAt: existing.resetAt };
  }

  async reset(key?: string): Promise<void> {
    if (key === undefined) {
      this.buckets.clear();
      return;
    }
    this.buckets.delete(key);
  }

  /** Test-only : taille du store. */
  size(): number {
    return this.buckets.size;
  }
}

/**
 * Backend Upstash Redis via REST. On n'utilise jamais d'ARCGIS — les variables
 * Upstash sont totalement séparées et optionnelles.
 *
 * Aucune valeur de secret n'est journalisée. En cas d'erreur réseau Upstash,
 * la requête laisse passer (fail-open) avec une trace stderr — un rate limit
 * cassé ne doit jamais bloquer le service.
 */
export class UpstashRedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async increment(key: string, windowMs: number): Promise<RateLimitState> {
    try {
      const incrementUrl = `${this.url}/incr/${encodeURIComponent(key)}`;
      const incrRes = await fetch(incrementUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!incrRes.ok) throw new Error(`upstash incr ${incrRes.status}`);
      const incrJson = (await incrRes.json()) as { result?: number };
      const count = typeof incrJson.result === "number" ? incrJson.result : 1;
      if (count === 1) {
        const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
        await fetch(`${this.url}/expire/${encodeURIComponent(key)}/${ttlSec}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.token}` },
        });
        return { count, resetAt: Date.now() + windowMs };
      }
      const pttlRes = await fetch(`${this.url}/pttl/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const pttlJson = (await pttlRes.json()) as { result?: number };
      const remainingMs = typeof pttlJson.result === "number" && pttlJson.result > 0 ? pttlJson.result : windowMs;
      return { count, resetAt: Date.now() + remainingMs };
    } catch (e) {
      // Fail-open : ne pas bloquer le service si Upstash est en panne.
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          event: "rate_limit.store_error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
      return { count: 1, resetAt: Date.now() + windowMs };
    }
  }
}

let activeStore: RateLimitStore | null = null;
let activeStoreType: RateLimitStoreType = "disabled";

/**
 * Détermine et mémoïse le store actif. Retourne aussi le type pour exposer le
 * mode effectif via `/api/health/internal`.
 *
 * Choix :
 * - Upstash si `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` définis.
 * - Sinon mémoire.
 */
export function getRateLimitStore(): { store: RateLimitStore; type: RateLimitStoreType } {
  if (activeStore !== null) return { store: activeStore, type: activeStoreType };
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) {
    activeStore = new UpstashRedisRateLimitStore(url, token);
    activeStoreType = "upstash";
  } else {
    activeStore = new InMemoryRateLimitStore();
    activeStoreType = "memory";
  }
  return { store: activeStore, type: activeStoreType };
}

/** Test-only : permet d'injecter un store ou de le réinitialiser. */
export function setRateLimitStoreForTests(
  store: RateLimitStore | null,
  type: RateLimitStoreType = "memory",
): void {
  activeStore = store;
  activeStoreType = store === null ? "disabled" : type;
}

/** Type de store actif (exposé via `/api/health/internal`). */
export function getRateLimitStoreType(): RateLimitStoreType {
  return activeStoreType;
}

/**
 * Outils MCP considérés comme « lourds » : leur exécution coûte plusieurs
 * appels ArcGIS et un rendu Markdown ou JSON volumineux.
 */
export const HEAVY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "inventory_all_layers",
  "recommend_open_data_candidates",
  "generate_inventory_report",
  "generate_open_data_brief",
  "generate_chatbot_readiness_report",
  "generate_layer_action_plan",
]);

export interface RateLimitDecision {
  ok: boolean;
  /** Si bloqué : durée à attendre côté client (s). */
  retryAfterSeconds?: number;
  /** Si bloqué : nom de la limite touchée (debug, jamais renvoyé brut). */
  reason?: "ip-per-minute" | "global-per-minute" | "heavy-tool-per-hour";
}

export interface RateLimitConfig {
  enabled: boolean;
  ipPerMinute: number;
  globalPerMinute: number;
  heavyToolPerHour: number;
}

export interface RateLimitInputs {
  ip: string;
  toolName?: string;
}

/**
 * Applique les trois fenêtres de rate limit (IP/min, global/min, outil
 * lourd/h). On évalue dans un ordre stable pour produire un `retryAfter`
 * pertinent en première limite touchée.
 */
export async function evaluateRateLimit(
  store: RateLimitStore,
  cfg: RateLimitConfig,
  inputs: RateLimitInputs,
): Promise<RateLimitDecision> {
  if (!cfg.enabled) return { ok: true };

  const minuteMs = 60_000;
  const hourMs = 60 * 60_000;
  const ipKey = `mcp:ip:${inputs.ip}`;
  const globalKey = "mcp:global";

  const ipState = await store.increment(ipKey, minuteMs);
  if (ipState.count > cfg.ipPerMinute) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((ipState.resetAt - Date.now()) / 1000)),
      reason: "ip-per-minute",
    };
  }

  const globalState = await store.increment(globalKey, minuteMs);
  if (globalState.count > cfg.globalPerMinute) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((globalState.resetAt - Date.now()) / 1000)),
      reason: "global-per-minute",
    };
  }

  if (inputs.toolName && HEAVY_TOOL_NAMES.has(inputs.toolName)) {
    const heavyKey = `mcp:heavy:${inputs.ip}:${inputs.toolName}`;
    const heavyState = await store.increment(heavyKey, hourMs);
    if (heavyState.count > cfg.heavyToolPerHour) {
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((heavyState.resetAt - Date.now()) / 1000)),
        reason: "heavy-tool-per-hour",
      };
    }
  }

  return { ok: true };
}

/**
 * Extrait l'IP cliente de manière conservatrice : `x-forwarded-for` premier
 * saut (Vercel injecte cet en-tête en bordure), puis `x-real-ip`, sinon
 * `"unknown"`. On ne fait jamais confiance à un en-tête côté serveur de
 * l'usager.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real && real.trim().length > 0) return real.trim();
  return "unknown";
}

/**
 * Sortie 429 conforme JSON-RPC (code applicatif `-32029`). On omet
 * volontairement l'IP brute du payload.
 */
export function buildRateLimitedResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32029,
        message: "Rate limit exceeded",
        data: { retryAfterSeconds },
      },
      id: null,
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(retryAfterSeconds),
      },
    },
  );
}

/** Hash court d'IP pour traçabilité minimale en logs (pas de PII brute). */
export function redactIp(ip: string): string {
  if (ip === "unknown") return "unknown";
  return `ip:${createHash("sha256").update(ip).digest("hex").slice(0, 8)}`;
}
