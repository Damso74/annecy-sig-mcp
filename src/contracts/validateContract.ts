import type { ZodTypeAny } from "zod";

/**
 * Helper de validation contractuelle (V0.8 / V0.9).
 *
 * V0.9 — politique configurable via la variable d’environnement `CONTRACT_POLICY` :
 *
 * - `strict` : toute violation lève `ContractViolationError` (utilisé en CI / dev) ;
 * - `warn`   : pas de throw — un message est écrit sur **stderr** uniquement ;
 * - `silent` : pas de throw, pas de log (utile pour les benchs).
 *
 * Compatibilité V0.8 : `STRICT_CONTRACTS=true` reste équivalent à `CONTRACT_POLICY=strict`,
 * et `STRICT_CONTRACTS=false` est équivalent à `CONTRACT_POLICY=warn`.
 *
 * Politique par défaut :
 * - en environnement de test (`NODE_ENV=test` ou `VITEST=true`)  → `strict`
 * - sinon (prod MCP ou dev manuel)                              → `warn`
 *
 * Important : le transport MCP est stdio. Aucun message ne doit être écrit sur
 * **stdout** depuis cette couche — seules `console.warn` / `console.error`
 * (qui pointent sur stderr en Node) sont utilisées.
 */
export type ContractPolicy = "strict" | "warn" | "silent";

export class ContractViolationError extends Error {
  public readonly contractName: string;
  public readonly issues: { path: string; message: string }[];
  constructor(contractName: string, issues: { path: string; message: string }[]) {
    const summary = issues
      .slice(0, 5)
      .map(i => `- ${i.path || "<root>"}: ${i.message}`)
      .join("\n");
    super(
      `Contrat « ${contractName} » non respecté (${issues.length} écart${
        issues.length > 1 ? "s" : ""
      }) :\n${summary}${issues.length > 5 ? `\n… et ${issues.length - 5} autre(s).` : ""}`,
    );
    this.name = "ContractViolationError";
    this.contractName = contractName;
    this.issues = issues;
  }
}

function isTestEnv(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

/**
 * Résout la politique active depuis l’environnement, à chaque appel : un test
 * peut donc surcharger `process.env.CONTRACT_POLICY` puis appeler `validateContract`
 * sans avoir à recharger le module.
 */
export function resolveContractPolicy(): ContractPolicy {
  const explicit = (process.env.CONTRACT_POLICY ?? "").toLowerCase().trim();
  if (explicit === "strict" || explicit === "warn" || explicit === "silent") {
    return explicit;
  }
  // Compat V0.8.
  const legacy = process.env.STRICT_CONTRACTS;
  if (legacy === "true") return "strict";
  if (legacy === "false") return "warn";
  return isTestEnv() ? "strict" : "warn";
}

/**
 * Valide `payload` contre `schema`. Retourne le payload **inchangé** (la validation
 * n’est pas transformante : on garde le typage TS d’origine et on ne mute pas).
 *
 * Le type de retour est lié au type du `payload` lui-même (générique `T`), pas
 * à l’inférence Zod : cela évite que les `.passthrough()` n’élargissent le type
 * statique côté appelant et qu’on perde le typage strict des `InventoryLayerRow`.
 *
 * @throws {ContractViolationError} en politique `strict` si le schéma n’est pas respecté.
 */
export function validateContract<T>(schema: ZodTypeAny, payload: T, contractName: string): T {
  const parsed = schema.safeParse(payload);
  if (parsed.success) {
    return payload;
  }
  const issues = parsed.error.issues.map(i => ({
    path: i.path.join("."),
    message: i.message,
  }));
  const policy = resolveContractPolicy();
  switch (policy) {
    case "strict":
      throw new ContractViolationError(contractName, issues);
    case "warn":
      // stderr uniquement — JAMAIS stdout (transport stdio MCP).
      console.error(
        `[contracts] ${contractName} : ${issues.length} écart(s) détecté(s) — payload renvoyé tel quel.`,
        issues.slice(0, 3),
      );
      return payload;
    case "silent":
      return payload;
    default: {
      const _exhaustive: never = policy;
      void _exhaustive;
      throw new ContractViolationError(contractName, issues);
    }
  }
}
