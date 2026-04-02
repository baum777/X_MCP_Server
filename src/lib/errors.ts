export type ErrorCode =
  | "CONFIG_ERROR"
  | "STORAGE_ERROR"
  | "CRYPTO_ERROR"
  | "VALIDATION_ERROR"
  | "AUTH_REQUIRED"
  | "AUTH_SCOPE_MISSING"
  | "AUTH_TOKEN_INVALID"
  | "AUTH_TOKEN_UNVERIFIABLE"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_AUTH_ERROR"
  | "UPSTREAM_FORBIDDEN"
  | "UPSTREAM_BAD_REQUEST"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unhandled internal error.";
  return new AppError("INTERNAL_ERROR", message, 500, false);
}
