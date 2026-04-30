export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "ARCGIS_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly hint?: string;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown>; hint?: string },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.details = options?.details;
    this.hint = options?.hint;
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      ...(this.hint ? { hint: this.hint } : {}),
    };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
