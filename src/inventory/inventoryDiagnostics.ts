export type InventoryDiagnosticCode =
  | "FIELD_REGISTRY_MISSING"
  | "SAMPLE_FAILED"
  | "SAMPLE_EMPTY"
  | "GEOMETRY_MISSING"
  | "COUNT_FAILED"
  | "METADATA_FAILED"
  | "FAST_MODE_LIMITED_SAMPLE"
  | "SEMANTIC_MAPPING_MISSING"
  | "LOW_DATA_QUALITY"
  | "INTERNAL_ONLY"
  | "TRANSFER_LIMIT_WARNING"
  | "UNEXPECTED_INVENTORY_ERROR"
  | "UNKNOWN";

export type InventoryDiagnostic = {
  code: InventoryDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  details?: Record<string, unknown>;
};

export function inventoryDiagnostic(
  code: InventoryDiagnosticCode,
  severity: InventoryDiagnostic["severity"],
  message: string,
  details?: Record<string, unknown>,
): InventoryDiagnostic {
  return { code, severity, message, details };
}

/** Ajoute un diagnostic et le message correspondant dans `warnings` (compatibilité). */
export function pushInventoryWarning(
  warnings: string[],
  diagnostics: InventoryDiagnostic[],
  diag: InventoryDiagnostic,
): void {
  diagnostics.push(diag);
  warnings.push(diag.message);
}
