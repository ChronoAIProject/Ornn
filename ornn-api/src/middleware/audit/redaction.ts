/**
 * Audit redaction — header stripping + body field-level redaction.
 *
 * Two layers compose into the final stored body:
 *
 *   1. **Whitelist** — per-route opt-in via `auditConfig.req` /
 *      `auditConfig.res`. Anything not listed is replaced with the
 *      redacted-string sentinel. Whitelist is a flat set of leaf field
 *      names; nested matching is name-based (a leaf called `skillName`
 *      anywhere in the tree is preserved if `skillName` is whitelisted).
 *      No path-syntax — routes pick concrete leaf names so the contract
 *      is grep-able.
 *
 *   2. **Blacklist** — global, always-wins, regex matched against field
 *      names. Default pattern is `password|token|apiKey|secret|key|credential`
 *      (case-insensitive). Operators can extend via the
 *      `AUDIT_GLOBAL_REDACT_PATTERNS` env var — additional patterns are
 *      OR-d together, never replacing the defaults.
 *
 * Header stripping is independent: a fixed list of identity-bearing
 * headers (`authorization`, `cookie`, `set-cookie`, `x-nyxid-*`) is never
 * recorded, no matter what auth shape the request used. Header capture
 * lives in `headers.ts` to keep this module body-only.
 *
 * @module middleware/audit/redaction
 */

const REDACTED = "[REDACTED]";

/**
 * Result of a single redaction pass. `redactedFields` collects the leaf
 * names that were elided so the persisted audit doc can advertise what
 * was scrubbed (transparency for operators inspecting later).
 */
export interface RedactionResult {
  readonly value: unknown;
  readonly redactedFields: readonly string[];
}

/** Compile a single OR-combined regex from the configured blacklist. */
export function buildBlacklistRegex(extraPatterns: readonly string[] = []): RegExp {
  const defaults = ["password", "token", "apiKey", "secret", "key", "credential"];
  const combined = [...defaults, ...extraPatterns]
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return new RegExp(combined.join("|"), "i");
}

/**
 * Walk an arbitrary JSON-shaped value and return a redacted copy.
 *
 * Rules:
 *   - Objects: each key is checked. Blacklist match → `[REDACTED]`.
 *     Otherwise: whitelist match keeps the value (recursing into nested
 *     objects / arrays); whitelist miss replaces with `[REDACTED]` for
 *     scalars and recurses for containers (so deeply-nested whitelisted
 *     leaves survive).
 *   - Arrays: each element is recursed under the same field name as the
 *     parent, mirroring the most common shape (e.g. `tags: ["a", "b"]`).
 *   - Primitives at the root: returned untouched; they have no field name
 *     to match against. Routes that take primitive bodies (rare) get the
 *     value preserved — these endpoints do not normally carry secrets.
 *
 * `null` and `undefined` short-circuit. `Buffer` / `Uint8Array` /
 * `Date` are treated as opaque scalars (no introspection); the body
 * pipeline upstream JSON-encodes them before we get here, so the case
 * is academic but kept defensive.
 */
export function redactBody(
  value: unknown,
  whitelist: ReadonlySet<string>,
  blacklist: RegExp,
): RedactionResult {
  const redacted = new Set<string>();

  function walkValue(v: unknown, parentKey: string | null): unknown {
    if (v === null || v === undefined) return v;

    if (Array.isArray(v)) {
      return v.map((item) => walkValue(item, parentKey));
    }

    if (typeof v === "object") {
      // Buffers / typed arrays — leave as-is; JSON.stringify above us
      // would have already converted them. Defensive guard for callers
      // that hand us pre-decoded shapes.
      if (v instanceof Uint8Array || v instanceof ArrayBuffer || v instanceof Date) {
        return v;
      }

      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (blacklist.test(k)) {
          out[k] = REDACTED;
          redacted.add(k);
          continue;
        }
        if (whitelist.has(k)) {
          // Even whitelisted branches must still be scanned for
          // blacklisted descendants (e.g. `metadata: { apiKey: ... }`).
          out[k] = walkValue(child, k);
          continue;
        }
        // Not whitelisted: scalars get redacted; containers recurse so
        // any whitelisted leaves below survive.
        if (
          child !== null &&
          typeof child === "object" &&
          !(child instanceof Uint8Array) &&
          !(child instanceof ArrayBuffer) &&
          !(child instanceof Date)
        ) {
          out[k] = walkValue(child, k);
        } else {
          out[k] = REDACTED;
          redacted.add(k);
        }
      }
      return out;
    }

    // Primitive at non-root: only keep when the parent key was whitelisted.
    // (We never reach this branch for blacklisted / unwhitelisted keys —
    // those are handled in the object loop above.)
    return parentKey === null ? v : v;
  }

  return {
    value: walkValue(value, null),
    redactedFields: Array.from(redacted).sort(),
  };
}
