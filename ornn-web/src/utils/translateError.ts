/**
 * Error translation helper.
 *
 * Services and hooks throw `Error` objects whose `.message` is now an
 * i18n key (e.g. `errors.api.quota.snapshotMissing`) or a JSON-encoded
 * payload `{ key, params }` for keys that need interpolation.
 *
 * Consuming components (toast handlers, error panels, modal banners)
 * route raw errors through this helper to get a localized string.
 * Passthrough for non-key strings keeps the migration safe.
 *
 * @module utils/translateError
 */

import i18n from "@/i18n";

/** Structured payload services throw when interpolation params are needed. */
export interface ErrorPayload {
  key: string;
  params?: Record<string, string | number>;
}

function isErrorPayload(v: unknown): v is ErrorPayload {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { key?: unknown }).key === "string"
  );
}

function looksLikeI18nKey(s: string): boolean {
  return s.startsWith("errors.");
}

/**
 * Translate an unknown error into a user-facing localized string.
 *
 * Recognizes three message shapes:
 *   1. JSON-encoded `{ key, params }` payload → t(key, params)
 *   2. dotted i18n key like `errors.api.quota.snapshotMissing` → t(key)
 *   3. anything else → return as-is (legacy / non-key strings pass through)
 *
 * Defensive: never throws. Any parse / lookup failure falls back to the
 * raw message text.
 */
export function translateError(err: unknown, fallback?: string): string {
  const t = i18n.t.bind(i18n);

  if (err instanceof Error) {
    const msg = err.message;

    if (msg.startsWith("{")) {
      try {
        const parsed = JSON.parse(msg);
        if (isErrorPayload(parsed)) {
          return t(parsed.key, parsed.params ?? {});
        }
      } catch {
        /* fall through to other checks */
      }
    }

    if (looksLikeI18nKey(msg)) {
      return t(msg);
    }

    return msg;
  }

  if (typeof err === "string") {
    if (looksLikeI18nKey(err)) return t(err);
    return err;
  }

  return fallback ?? t("errors.generic.unknown");
}

/**
 * Build a JSON-encoded error message string for services that need to
 * thread interpolation params through `throw new Error(...)`.
 */
export function encodeErrorPayload(payload: ErrorPayload): string {
  return JSON.stringify(payload);
}
