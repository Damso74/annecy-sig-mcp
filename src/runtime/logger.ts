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
 * Compteurs runtime (`getLoggerStats`) exposés par `/api/health`.
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

/** Statistiques agrégées exposées via `/api/health`. */
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

function emit(level: LogLevel, event: string, payload: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...payload,
  });
  // stderr-only — protège stdio MCP.
   
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
      if (typeof m === "string") lastToolErrorMessage = m;
    }
    emit("error", event, payload);
  },
};

/**
 * Wrappe l'exécution d'un outil MCP : log JSON `tool.exec` (succès) ou
 * `tool.error` (échec) avec latence, code d'erreur, et contexte couche.
 *
 * Le wrapper **ne mute pas** la valeur de retour ni les erreurs (rethrow tel quel).
 */
export async function withToolTracing<T>(
  toolName: string,
  ctx: { serviceKey?: string; layerId?: number; mode?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  toolCallsTotal++;
  try {
    const result = await fn();
    logger.info("tool.exec", {
      tool: toolName,
      ...ctx,
      latencyMs: Date.now() - startedAt,
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
      ...ctx,
      latencyMs: Date.now() - startedAt,
      code,
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
