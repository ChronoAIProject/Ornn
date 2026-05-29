/**
 * Cursor encode/decode for paginated list endpoints (#457).
 *
 * Per CONVENTIONS.md §4.3, list endpoints return `meta.nextCursor`
 * — an opaque base64-encoded JSON token the client passes back as
 * `?cursor=...` for the next page. Clients MUST NOT parse the
 * payload; the format is server-internal and free to evolve.
 *
 * v1 payload shape: `{ page: number }` — backed by the existing
 * offset-based query layer underneath. The cursor abstraction lets
 * the API contract conform to §4.3 immediately while the underlying
 * query stays offset; a follow-up PR can swap the payload for a
 * `lastSort` keyset cursor without changing the client-visible
 * interface.
 *
 * @module shared/cursor
 */

export interface CursorPayload {
  /** 1-indexed page number — what the underlying offset query reads. */
  page: number;
}

/** Encode a cursor payload as a URL-safe base64 string. */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
}

/**
 * Decode an opaque cursor. Returns `null` for any malformed input —
 * the route layer then surfaces a 400 `invalid_cursor` so an old
 * client doesn't end up paginating from page 1 silently.
 */
export function decodeCursor(raw: string | undefined): CursorPayload | null {
  if (!raw || typeof raw !== "string" || raw.length === 0) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf-8");
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const page = (parsed as { page?: unknown }).page;
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1) return null;
    return { page };
  } catch {
    return null;
  }
}

/**
 * Build the next-page cursor for an offset-based response. Returns
 * `undefined` when there are no more pages (callers omit
 * `nextCursor` from `meta` in that case per CONVENTIONS.md §4.3).
 */
export function buildNextCursor(args: {
  currentPage: number;
  pageSize: number;
  itemsReturned: number;
}): string | undefined {
  // No more items means we're on the last page.
  if (args.itemsReturned < args.pageSize) return undefined;
  return encodeCursor({ page: args.currentPage + 1 });
}
