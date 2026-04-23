/**
 * Error thrown by the Ornn SDK when an API call fails.
 *
 * The SDK never throws a raw Error — callers can pattern-match on
 * `instanceof OrnnError` and inspect `code` / `status` without parsing
 * messages.
 *
 * @module errors
 */

export interface OrnnErrorPayload {
  /** HTTP status from the response. 0 when the request never reached the server. */
  readonly status: number;
  /** Machine-readable error code (lowercase snake_case, per conventions.md §1.4). */
  readonly code: string;
  /** Human-readable message safe to surface. */
  readonly message: string;
  /** Request-ID from the server for log correlation, when available. */
  readonly requestId?: string;
  /** Optional structured validation errors from the server. */
  readonly errors?: ReadonlyArray<{ path?: string; code?: string; message: string }>;
}

export class OrnnError extends Error implements OrnnErrorPayload {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly errors?: ReadonlyArray<{ path?: string; code?: string; message: string }>;

  constructor(payload: OrnnErrorPayload) {
    super(payload.message);
    this.name = "OrnnError";
    this.status = payload.status;
    this.code = payload.code;
    this.requestId = payload.requestId;
    this.errors = payload.errors;
  }
}
