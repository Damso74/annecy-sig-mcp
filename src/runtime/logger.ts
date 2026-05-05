/**
 * Logger JSON ligne-par-ligne (NDJSON) sur **stderr** uniquement.
 *
 * Contrainte forte : ne **jamais** écrire sur stdout — le transport stdio MCP
 * y est sensible (un caractère hors trame casse le client). Tous les logs
 * passent par `console.error` (stderr), conformément au contrat existant.
 *
 * Usage :
 *
 *   logger.info("tool.exec", { tool: "query_layer", layerId: 9, latencyMs: 124 });
 *   logger.error("arcgis.error", { tool: "query_layer", code: "ARCGIS_ERROR" });
 *
 * Format de ligne :
 *
 *   {"ts":"2026-05-02T15:50:01.123Z","level":"info","event":"tool.exec",
 *    "tool":"query_layer","layerId":9,"latencyMs":124}
 *
 * Compteurs runtime (`getLoggerStats`) exposés via `/api/health/internal`.
 *
 * Aucune fuite de PII : les coordonnées ne doivent pas y apparaître brutes
 * (utiliser `roundCoord`), les IPs sont hashées (`redactIp` côté rateLimit),
 * et `sanitizeMessage` retire tout en-tête `Authorization` / Bearer / token.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

let toolCallsTotal = 0;
let toolErrorsTotal = 0;
let lastToolErrorAt: number | null = null;
let lastToolErrorMessage: string | null = null;

/** Réinitialise les compteurs (test). */
export function resetLoggerStats(): void {
  toolCallsTotal = 0;
  toolErrorsTotal = 0;
  lastToolErrorAt = null;
  lastToolErrorMessage = null;
}

/** Statistiques agrégées exposées via `/api/health/internal`. */
export function getLoggerStats(): {
  toolCallsTotal: number;
  toolErrorsTotal: number;
  lastToolErrorAt: string | null;
  lastToolErrorMessage: string | null;
} {
  return {
    toolCallsTotal,
    toolErrorsTotal,
    lastToolErrorAt: lastToolErrorAt ? new Date(lastToolErrorAt).toISOString() : null,
    lastToolErrorMessage,
  };
}

/**
 * Sanitisation conservatrice d'un message d'erreur avant log :
 * - retire toute occurrence d'« authorization: bearer ... » ;
 * - retire les tokens potentiels (séquences alpha-num ≥ 24).
 *
 * Cette fonction n'a pas vocation à remplacer les bonnes pratiques côté
 * appelant (ne pas inclure de secret dans un message d'exception) ; c'est
 * un filet de sécurité.
 */
export function sanitizeMessage(message: string): string {
  return message
    .replace(/authorization\s*:\s*bearer\s+[^\s,]+/gi, "authorization: <redacted>")
    .replace(/\bbearer\s+[A-Za-z0-9._\-=]{4,}/gi, "bearer <redacted>")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "<redacted-token>");
}

/** Arrondit une coordonnée pour log (3 décimales ≈ 110 m de résolution). */
export function roundCoord(n: number | undefined): number | undefined {
  if (n === undefined || !Number.isFinite(n)) return undefined;
  return Math.round(n * 1000) / 1000;
}

function emit(level: LogLevel, event: string, payload: Record<string, unknown>): void {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string" && (k === "message" || k === "error")) {
      safe[k] = sanitizeMessage(v);
    } else {
      safe[k] = v;
    }
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...safe,
  });
  // stderr-only — protège stdio MCP.
  // eslint-disable-next-line no-console
  console.error(line);
}

export const logger = {
  debug(event: string, payload: Record<string, unknown> = {}): void {
    if (process.env.LOG_LEVEL === "debug") emit("debug", event, payload);
  },
  info(event: string, payload: Record<string, unknown> = {}): void {
    emit("info", event, payload);
  },
  warn(event: string, payload: Record<string, unknown> = {}): void {
    emit("warn", event, payload);
  },
  error(event: string, payload: Record<string, unknown> = {}): void {
    if (event.startsWith("tool.")) {
      toolErrorsTotal++;
      lastToolErrorAt = Date.now();
      const m = payload.message;
      if (typeof m === "string") lastToolErrorMessage = sanitizeMessage(m);
    }
    emit("error", event, payload);
  },
};

/**
 * Wrappe l'exécution d'un outil MCP : log JSON `tool.exec` (succès) ou
 * `tool.error` (échec) avec latence, code d'erreur, et contexte couche.
 *
 * Le wrapper **ne mute pas** la valeur de retour ni les erreurs (rethrow tel quel).
 *
 * Cas particulier : si la callback retourne `{ isError: true, ... }` (cas du
 * SDK MCP qui sérialise l'erreur dans la réponse au lieu de throw), on
 * considère l'appel comme un échec et on incrémente `toolErrorsTotal`.
 */
export async function withToolTracing<T>(
  toolName: string,
  ctx: { serviceKey?: string; layerId?: number; mode?: string; lat?: number; lon?: number },
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  toolCallsTotal++;
  const sanitisedCtx: Record<string, unknown> = {
    ...(ctx.serviceKey ? { serviceKey: ctx.serviceKey } : {}),
    ...(ctx.layerId !== undefined ? { layerId: ctx.layerId } : {}),
    ...(ctx.mode ? { mode: ctx.mode } : {}),
    ...(ctx.lat !== undefined ? { lat: roundCoord(ctx.lat) } : {}),
    ...(ctx.lon !== undefined ? { lon: roundCoord(ctx.lon) } : {}),
  };
  try {
    const result = await fn();
    const latencyMs = Date.now() - startedAt;
    if (typeof result === "object" && result !== null && (result as { isError?: boolean }).isError === true) {
      // L'outil a renvoyé un AppError sérialisé via `jsonErr()`.
      toolErrorsTotal++;
      lastToolErrorAt = Date.now();
      // On ne plonge pas dans le payload pour extraire l'erreur ; le code de
      // l'outil sait déjà la log si nécessaire. On marque juste l'événement.
      logger.error("tool.error", {
        tool: toolName,
        ...sanitisedCtx,
        latencyMs,
        status: "tool-error",
      });
      return result;
    }
    logger.info("tool.exec", {
      tool: toolName,
      ...sanitisedCtx,
      latencyMs,
      status: "ok",
    });
    return result;
  } catch (e) {
    const code =
      e !== null &&
      typeof e === "object" &&
      "code" in e &&
      typeof (e as { code?: unknown }).code === "string"
        ? (e as { code: string }).code
        : "UNKNOWN";
    logger.error("tool.error", {
      tool: toolName,
      ...sanitisedCtx,
      latencyMs: Date.now() - startedAt,
      code,
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * À appeler une fois au boot du transport HTTP : émet un warning explicite si
 * la config remote n'a pas de Bearer activé alors qu'on est probablement en
 * environnement déployé (heuristique `VERCEL_ENV` / `NODE_ENV`).
 */
export function warnIfPublicTokenMissing(opts: {
  bearerRequired: boolean;
  publicOnly: boolean;
}): void {
  if (opts.bearerRequired) return;
  const isRemote =
    process.env.VERCEL === "1" ||
    process.env.VERCEL_ENV !== undefined ||
    process.env.NODE_ENV === "production";
  if (!isRemote) return;
  logger.warn("auth.bearer_disabled", {
    publicOnly: opts.publicOnly,
    hint: "MCP_PUBLIC_READ_TOKEN absent en environnement remote — endpoint /api/mcp ouvert.",
  });
}
