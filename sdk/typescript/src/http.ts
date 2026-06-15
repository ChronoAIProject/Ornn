/**
 * HTTP plumbing for the Ornn client — response-envelope shapes and
 * error mapping, kept separate from {@link OrnnClient}'s endpoint
 * methods so the transport machinery stays small and stable while the
 * business-logic surface (the methods) grows.
 *
 * @module http
 */

import { OrnnError, type OrnnErrorPayload } from "./errors";

/** Success envelope per CONVENTIONS.md — `{ data, error: null }`. */
export interface EnvelopeSuccess<T> {
  readonly data: T;
  readonly error: null;
}

/**
 * Wire shape for error responses post-#456 — RFC 7807
 * `application/problem+json`. Fields at the body root; `error` /
 * `data` are gone.
 */
export interface ProblemJson {
  readonly type?: string;
  readonly title?: string;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
  readonly instance?: string;
  readonly requestId?: string;
  readonly errors?: ReadonlyArray<{ path?: string; code?: string; message: string }>;
}

/** Coerce any accepted package representation into a ZIP-typed Blob. */
export function zipToBlob(zip: Blob | ArrayBuffer | Uint8Array): Blob {
  if (zip instanceof Blob) return zip;
  return new Blob([zip as BlobPart], { type: "application/zip" });
}

/** Read a non-2xx response body and map it to an {@link OrnnError}. */
export async function parseError(res: Response): Promise<OrnnError> {
  const body = (await res.json().catch(() => null)) as ProblemJson | null;
  return buildError(res.status, body);
}

/** Build an {@link OrnnError} from an RFC 7807 problem body (or a bare status). */
export function buildError(status: number, body: ProblemJson | null): OrnnError {
  if (body && (body.code || body.detail || body.title)) {
    // exactOptionalPropertyTypes (#450): only stamp `requestId` /
    // `errors` keys when the upstream actually provided them — the
    // payload type is `requestId?: string`, not `string | undefined`,
    // so `{ requestId: undefined }` is a type error under the
    // stricter contract.
    const payload: OrnnErrorPayload = {
      status: body.status ?? status,
      code: body.code ?? "unknown_error",
      message: body.detail ?? body.title ?? `Ornn API returned ${status}`,
      ...(body.requestId !== undefined ? { requestId: body.requestId } : {}),
      ...(body.errors !== undefined ? { errors: body.errors } : {}),
    };
    return new OrnnError(payload);
  }
  return new OrnnError({
    status,
    code: "unknown_error",
    message: `Ornn API returned ${status} without a recognized error body`,
  });
}
