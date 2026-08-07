/**
 * User directory + GitHub mirror coordinates (#1214).
 *
 * Two small, unrelated-looking surfaces that share one property: both are
 * *lookup* endpoints an integrator needs before they can do the thing they
 * actually came for.
 *
 *   - `/users/search` and `/users/resolve` translate between the two
 *     identifiers a human and the API disagree about. Every access-control
 *     endpoint in this API speaks NyxID `user_id`; every human speaks email.
 *     These two routes are the only bridge, in both directions.
 *   - `/github/repo` reports (and, for admins, sets) the repository Ornn
 *     mirrors published skills into. The read side is public because the
 *     `npx skills add <owner>/<repo>/<skill>` install snippet on a public
 *     skill page has to render for anonymous visitors.
 *
 * Hand-written JSON Schemas are used throughout rather than the domain Zod
 * schemas, deliberately and in each case for a concrete reason recorded at
 * the definition site: the directory route's query schema is module-private
 * (`domains/users/routes.ts`) and its result rows have no Zod definition at
 * all, while the mirror route validates its body as a bare
 * `z.record(z.string(), z.unknown())` and its responses are a *projection*
 * of `mirrorSchema` — a different field set on the way out, with
 * `appPrivateKey` mid-masked. Deriving from those schemas would document
 * shapes the handlers do not actually produce.
 *
 * The two admin mirror *operations* (`POST /admin/mirror/reconcile`,
 * `GET /admin/mirror/status`) live in the same Hono router but are
 * documented with the rest of the admin surface, not here.
 *
 * @module openapi/paths/usersMirror
 */

import {
  bearerAuth,
  jsonBody,
  jsonResponse,
  problemResponses,
  publicAuth,
  queryParam,
  type JsonSchema,
  type PathMap,
} from "../helpers";

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

/**
 * RFC 9239 headers emitted by `middleware/rateLimit` on *every* response
 * from the directory surface, success or 429. Both directory routes mount
 * the same limiter instance under the `users-directory` label, so these
 * numbers describe one shared bucket rather than a per-route allowance.
 */
const directoryRateLimitHeaders: Record<string, unknown> = {
  "RateLimit-Limit": {
    description:
      "Requests allowed per window across the whole user-directory surface. Default 30 per 60 seconds; operators may retune it via `ORNN_USER_DIRECTORY_RATELIMIT_PER_MIN`, so read the header rather than hardcoding 30.",
    schema: { type: "integer", examples: [30] },
  },
  "RateLimit-Remaining": {
    description:
      "Requests left in the current window for this caller. Shared between `GET /users/search` and `GET /users/resolve` — spending it on one reduces it for the other. Self-throttle as it approaches 0.",
    schema: { type: "integer", examples: [29] },
  },
  "RateLimit-Reset": {
    description:
      "Seconds until the window resets and `RateLimit-Remaining` returns to `RateLimit-Limit`. A 429 additionally repeats this value in `Retry-After`.",
    schema: { type: "integer", examples: [42] },
  },
};

/**
 * `Retry-After` — emitted only on the 429. `middleware/rateLimit` sets it to
 * the same second count as `RateLimit-Reset` just before throwing, and Hono
 * carries prepared headers through the error handler onto the
 * `application/problem+json` body.
 */
const retryAfterHeader: Record<string, unknown> = {
  "Retry-After": {
    description:
      "Seconds to wait before retrying. Always the same value as `RateLimit-Reset` on the same response.",
    schema: { type: "integer", examples: [42] },
  },
};

/**
 * Attach the rate-limit headers to a 429 built by `problemResponses()`.
 *
 * `problemResponses()` has no per-status header slot, so declaring them has
 * to happen here. Skipping it leaves a generated client told to back off
 * with no declared header to read the back-off interval from — the headers
 * are on the wire either way.
 */
function withRateLimitHeaders(responses: Record<string, unknown>): Record<string, unknown> {
  const rateLimited = responses["429"];
  if (rateLimited !== undefined && typeof rateLimited === "object" && rateLimited !== null) {
    (rateLimited as Record<string, unknown>).headers = {
      ...directoryRateLimitHeaders,
      ...retryAfterHeader,
    };
  }
  return responses;
}

/**
 * One row of the user directory, as both `/users/search` and
 * `/users/resolve` return it.
 *
 * Hand-written: `UserDirectoryRepository.searchByEmailPrefix` and
 * `findByUserIds` both project down to this three-field shape in plain
 * TypeScript (`domains/users/repository.ts`). There is no Zod definition
 * of it anywhere to reuse — the collection's `UserDirectoryDoc` is a wider
 * interface that includes `firstSeenAt` / `lastSeenAt` / `activityCount` /
 * `isAdmin`, none of which these two routes expose.
 */
const userDirectoryEntrySchema: JsonSchema = {
  type: "object",
  required: ["userId", "email", "displayName"],
  properties: {
    userId: {
      type: "string",
      description:
        "NyxID `user_id` — the opaque identifier every access-control endpoint in this API expects (`PUT /skills/{id}/permissions`, ownership transfer, quota administration). Treat it as an opaque string; the format is NyxID's to change.",
      examples: ["usr_2b91c7d4"],
    },
    email: {
      type: "string",
      format: "email",
      description:
        "Last-known email address for this user, refreshed on every authenticated request Ornn sees from them. This is the field `GET /users/search` matches its prefix against.",
      examples: ["ada@example.com"],
    },
    displayName: {
      type: "string",
      description:
        "Last-known human label, taken from the identity token's `name` claim and falling back to the email address (then the `userId`) when that claim is absent. Display only — never match or key on it.",
      examples: ["Ada Lovelace"],
    },
  },
};

/** `{ items: [...] }` — the envelope `data` payload both directory routes return. */
const userDirectoryListSchema: JsonSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      description:
        "Matching directory rows. May be shorter than requested and may be empty; an empty array is a normal answer, not an error.",
      items: userDirectoryEntrySchema,
    },
  },
};

const directoryExample = {
  items: [
    { userId: "usr_2b91c7d4", email: "ada@example.com", displayName: "Ada Lovelace" },
    { userId: "usr_7c04f118", email: "alan@example.com", displayName: "Alan Turing" },
  ],
};

// ---------------------------------------------------------------------------
// Mirror payloads
// ---------------------------------------------------------------------------

/**
 * Public projection of the mirror settings section.
 *
 * Hand-written rather than derived from `mirrorSchema`
 * (`domains/settings/sections/mirror.ts`) because the handler returns a
 * strict *subset* of that section — credentials and `reconcileSchedule` are
 * intentionally withheld from the anonymous read — and because `mirrorSchema`
 * carries no `.describe()` text, which is the entire point of this document.
 */
const mirrorPublicConfigSchema: JsonSchema = {
  type: "object",
  required: ["owner", "repo", "branch", "enabled"],
  properties: {
    owner: {
      type: "string",
      description:
        "GitHub account or organisation that owns the mirror repository. Empty string on a deployment that has never configured the mirror.",
      examples: ["ChronoAIProject"],
    },
    repo: {
      type: "string",
      description: "Repository name inside `owner`. Empty string when unconfigured.",
      examples: ["ornn-skills"],
    },
    branch: {
      type: "string",
      description:
        "Branch the mirror commits published skills to. Empty string when unconfigured — an empty branch leaves the mirror inoperable even if `enabled` is `true`.",
      examples: ["main"],
    },
    enabled: {
      type: "boolean",
      description:
        "Master kill switch. Check this BEFORE using the coordinates: when `false`, `owner`/`repo`/`branch` may still hold stale values from a previous configuration and no install snippet should be advertised.",
      examples: [true],
    },
  },
};

/**
 * Admin projection returned by `POST /github/repo` — every editable field
 * of the mirror section with `appPrivateKey` mid-masked.
 *
 * Also hand-written, and for a stronger reason than the public read: the
 * value in `appPrivateKey` here is NOT what `mirrorSchema` describes. It is
 * the output of `midMaskSecret()`, a cosmetic string built from the bullet
 * character, so documenting it as the section's raw `z.string()` would tell
 * a client the response contains a usable key. It does not.
 */
const mirrorAdminConfigSchema: JsonSchema = {
  type: "object",
  required: ["enabled", "owner", "repo", "branch", "appId", "installationId", "appPrivateKey"],
  properties: {
    enabled: {
      type: "boolean",
      description: "The kill switch as now stored.",
    },
    owner: { type: "string", description: "Mirror repository owner as now stored. Empty string means cleared.", examples: ["ChronoAIProject"] },
    repo: { type: "string", description: "Mirror repository name as now stored. Empty string means cleared.", examples: ["ornn-skills"] },
    branch: { type: "string", description: "Mirror branch as now stored. Empty string means cleared.", examples: ["main"] },
    appId: {
      type: "string",
      description: "GitHub App id as now stored, as a decimal string. Empty string means cleared.",
      examples: ["1234567"],
    },
    installationId: {
      type: "string",
      description: "GitHub App installation id as now stored, as a decimal string. Empty string means cleared.",
      examples: ["87654321"],
    },
    appPrivateKey: {
      type: "string",
      description:
        "The stored private key, MID-MASKED for display: first four and last four characters kept, everything between replaced by the bullet character `•` (anything eight characters or shorter is fully blurred, and a cleared key is `\"\"`). This is never a usable key. It is, however, the sentinel: posting a string containing `•` back to this endpoint means \"keep the key you already have\", which is what makes a round-trip through an admin form safe.",
      examples: ["----••••••••••••••••••••••••----"],
    },
  },
};

/**
 * Request body for `POST /github/repo`.
 *
 * The route's `validateBody` middleware uses `z.record(z.string(),
 * z.unknown())` on purpose — it only gates "is this a JSON object at all",
 * so a `SyntaxError` becomes a clean 400 (#438). Every per-field check is
 * hand-rolled in the handler afterwards. Emitting the record schema would
 * publish `additionalProperties: {}` and document nothing, so the real
 * accepted shape is spelled out here instead. `additionalProperties` is left
 * open because the handler genuinely ignores unknown keys rather than
 * rejecting them.
 */
const mirrorConfigPatchBodySchema: JsonSchema = {
  type: "object",
  description:
    "Every field is optional. A key you omit is preserved exactly as stored; a key you send as an empty string is CLEARED. Unknown keys are ignored. `reconcileSchedule` is part of the mirror settings section but is not editable here — it is carried through untouched; use the platform settings API to change it.",
  properties: {
    enabled: {
      type: "boolean",
      description:
        "Master kill switch. `false` halts mirroring — `POST /admin/mirror/reconcile` starts answering 503 `mirror_disabled` — without discarding coordinates or credentials, so it is the safe way to pause. Must be a real JSON boolean; the string `\"true\"` is rejected with 400 `invalid_setting`.",
      examples: [true],
    },
    owner: {
      type: "string",
      description:
        "GitHub account or organisation owning the mirror repository. 1–39 characters of letters, digits, and dashes, with no leading or trailing dash. Whitespace is trimmed. Empty string clears it. Changing this arms the abandon-confirm guard — see the 409 response.",
      pattern: "^$|^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$",
      examples: ["ChronoAIProject"],
    },
    repo: {
      type: "string",
      description:
        "Repository name inside `owner`. 1–100 characters of letters, digits, dot, dash, or underscore. Whitespace is trimmed. Empty string clears it. Changing this arms the abandon-confirm guard — see the 409 response.",
      pattern: "^$|^[A-Za-z0-9._-]{1,100}$",
      examples: ["ornn-skills"],
    },
    branch: {
      type: "string",
      description:
        "Branch the mirror commits to. Any non-empty string up to 250 characters; C0 control characters and DEL are rejected. Whitespace is trimmed. Empty string clears it, which leaves the mirror inoperable. Unlike `owner`/`repo`, changing the branch does NOT arm the abandon-confirm guard and does not clear sync stamps.",
      maxLength: 250,
      examples: ["main"],
    },
    appId: {
      type: "string",
      description:
        "GitHub App id, sent as a decimal STRING of 1–15 digits (`\"1234567\"`, not `1234567`) — a JSON number is rejected with 400 `invalid_setting`. Empty string clears it.",
      pattern: "^$|^[0-9]{1,15}$",
      examples: ["1234567"],
    },
    installationId: {
      type: "string",
      description:
        "Installation id of that App on `owner`, sent as a decimal STRING of 1–20 digits. Empty string clears it.",
      pattern: "^$|^[0-9]{1,20}$",
      examples: ["87654321"],
    },
    appPrivateKey: {
      type: "string",
      description:
        "PEM-encoded private key for the GitHub App. Accepts PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`, what GitHub hands you) or PKCS#8 (`-----BEGIN PRIVATE KEY-----`), at most 8192 bytes, containing no control bytes other than tab/CR/LF; it is normalised to LF, structurally parsed, and encrypted at rest. Three special cases, in this order: any string containing the mid-mask bullet `•` PRESERVES the stored key (round-trip the value from the response and nothing changes), `\"\"` CLEARS it, and anything else must parse as a private key or the request fails with 400 `invalid_setting`.",
      maxLength: 8192,
    },
    confirmAbandonOldRepo: {
      type: "boolean",
      description:
        "Acknowledgement that changing `owner`/`repo` abandons the repository Ornn has been mirroring into and wipes every skill's sync stamp. Only consulted when the coordinates actually change AND at least one skill is currently stamped; ignored otherwise. Strictly compared against `true` — `\"true\"` or `1` count as NOT confirmed.",
      examples: [true],
    },
  },
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function usersMirrorPaths(prefix: string): PathMap {
  return {
    [`${prefix}/users/search`]: {
      get: {
        summary: "Find users by email prefix",
        description: [
          "Typeahead lookup that turns an email prefix into the NyxID `user_id` values the rest of this API expects. It is the resolution step before granting access: `PUT /skills/{id}/permissions`, skill and skillset ownership transfer, and the quota-administration endpoints all take `user_id`s, never email addresses, and this is the only way an ordinary caller can obtain one.",
          "The directory contains only users Ornn has actually seen authenticate — a row is lazily upserted on every authenticated request. Somebody who has never signed in to this deployment is not searchable and cannot be granted access until they do; that is the expected explanation for an empty result, not a bug. Matching is an ANCHORED, case-insensitive prefix on `email` only — display names are not searched, and `ada` will not find `not-ada@example.com`. Regex metacharacters in `q` are escaped server-side, so a literal `.` matches a `.`. Rows come back most-recently-active first and are truncated to `limit`.",
          "Any authenticated caller may search; there is deliberately no admin gate, because sharing a skill requires being able to find the person to share it with. Two guards keep that from becoming a directory dump: `q` must be at least 2 characters (a deployment can raise the floor with `ORNN_USER_SEARCH_MIN_Q`, never lower it), and the whole directory surface is rate limited.",
          "Rate limit: 30 requests per 60 seconds by default, keyed on the authenticated `userId`. The budget is SHARED with `GET /users/resolve` — one bucket, one label — so alternating between the two endpoints does not double your allowance. Every response carries `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`; read them instead of retrying blind.",
          "Use `GET /users/resolve` instead when you already hold `user_id`s — for example the `sharedWithUsers` array on a skill — and want labels for them. A prefix search over emails can never match an opaque id.",
        ].join("\n\n"),
        operationId: "searchUserDirectory",
        tags: ["Users"],
        security: bearerAuth(),
        parameters: [
          {
            ...queryParam(
              "q",
              "Email prefix to match, case-insensitive and anchored at the start of the address. Leading and trailing whitespace is trimmed before validation. Required, and must be at least 2 characters after trimming — an empty or 1-character value is rejected with 400 and never reaches the database, so this endpoint cannot be walked one letter at a time. Maximum 256 characters.",
              { type: "string", minLength: 2, maxLength: 256 },
              true,
            ),
            example: "ada",
          },
          {
            ...queryParam(
              "limit",
              "Maximum number of rows to return, 1–50. Coerced from the query string, so `limit=5` works; a non-numeric or out-of-range value is a 400 rather than a silent clamp. Defaults to 10 when omitted. There is no pagination here — raise `limit` or narrow `q`.",
              { type: "integer", minimum: 1, maximum: 50, default: 10 },
            ),
            example: 10,
          },
        ],
        responses: {
          ...jsonResponse(
            userDirectoryListSchema,
            "Directory rows whose email starts with `q`, most recently active first. An empty `items` array means nobody matching that prefix has ever authenticated against this deployment.",
            { headers: directoryRateLimitHeaders, example: directoryExample },
          ),
          ...withRateLimitHeaders(
            problemResponses(
              {
                400:
                  "Bad request (`invalid_query`) — `q` is absent, shorter than the 2-character minimum after trimming, or longer than 256 characters; or `limit` is not an integer in 1–50. `detail` names the offending field. No database query is issued.",
              },
              401,
              {
                429:
                  "Rate limited (`rate_limited`) — the shared `users-directory` budget (30 requests / 60 s per user by default) is spent. `Retry-After` and `RateLimit-Reset` both give the seconds to wait. `GET /users/resolve` draws from the same bucket, so switching endpoints does not help.",
              },
              // The directory query goes straight to MongoDB with no
              // retry or fallback, so a driver-level failure surfaces here.
              500,
            ),
          ),
        },
      },
    },

    [`${prefix}/users/resolve`]: {
      get: {
        summary: "Resolve user_ids to directory labels",
        description: [
          "Batch id → label lookup: hand it NyxID `user_id`s, get back the last-known `email` and `displayName` for each. It is the exact inverse of `GET /users/search`, and it exists because a skill's `sharedWithUsers` array stores bare `user_id`s — an email-prefix search can never match an opaque id, so rendering, auditing, or reasoning about an existing grant requires this call.",
          "Unknown ids are silently DROPPED rather than returned as nulls, so the response can be shorter than your input and can be empty. Read a missing id as \"this user has never authenticated against this deployment\" (directory rows are created lazily on first authenticated request), not as an error. Order is NOT guaranteed either — build your own map keyed on `userId` instead of zipping the response positionally against what you sent.",
          "At most 100 ids are honoured per call: the list is split on commas, entries are trimmed, empty entries are dropped, and everything past the hundredth survivor is ignored WITHOUT an error. Page your input yourself if you have more. Duplicate ids collapse to one row.",
          "This route is the one place in the directory surface with no query validation: an absent or empty `ids` parameter returns `{ \"items\": [] }` with 200, and no input shape produces a 400. It does share the `users-directory` rate-limit budget with `GET /users/search` (30 requests / 60 s per user by default, one bucket), and emits the same `RateLimit-*` headers.",
        ].join("\n\n"),
        operationId: "resolveUserDirectoryEntries",
        tags: ["Users"],
        security: bearerAuth(),
        parameters: [
          {
            ...queryParam(
              "ids",
              "Comma-separated NyxID `user_id`s to resolve. Entries are trimmed and blank entries dropped; only the first 100 survivors are looked up and the remainder are ignored silently. Omitting the parameter, or sending an empty string, yields an empty `items` array with 200 — this parameter is never validated and never causes a 400, and the API imposes no length limit of its own on it. Note this is a CSV parameter: repeating `?ids=` is not supported.",
              { type: "string" },
            ),
            example: "usr_2b91c7d4,usr_7c04f118",
          },
        ],
        responses: {
          ...jsonResponse(
            userDirectoryListSchema,
            "The subset of the requested ids that exist in the directory, in unspecified order. Ids Ornn has never seen are omitted entirely.",
            { headers: directoryRateLimitHeaders, example: directoryExample },
          ),
          ...withRateLimitHeaders(
            problemResponses(
              401,
              {
                429:
                  "Rate limited (`rate_limited`) — the shared `users-directory` budget (30 requests / 60 s per user by default) is spent. Because the budget is shared with `GET /users/search`, batching more ids into fewer calls is the correct fix, up to the 100-id ceiling. `Retry-After` and `RateLimit-Reset` both give the seconds to wait.",
              },
              // The `$in` lookup goes straight to MongoDB with no retry or
              // fallback, so a driver-level failure surfaces here.
              500,
            ),
          ),
        },
      },
    },

    [`${prefix}/github/repo`]: {
      get: {
        summary: "Read the public GitHub mirror coordinates",
        description: [
          "Returns the repository Ornn mirrors published skills into, plus the kill switch that says whether mirroring is currently on. Public and unauthenticated by design: an anonymous visitor on a public skill page must be able to render the `npx skills add <owner>/<repo>/<skill>` install snippet, and that snippet is built from these three coordinates.",
          "Check `enabled` before you use anything else. When it is `false` the coordinate fields may still hold values left over from a previous configuration — do not advertise an install command in that state. Treat empty strings the same way: a deployment that has never configured the mirror returns `owner`, `repo`, and `branch` as `\"\"`, and an empty `branch` makes the mirror inoperable even when `enabled` is `true`.",
          "GitHub App credentials (`appId`, `installationId`, `appPrivateKey`) are deliberately absent from this response — it is the anonymous read. Platform admins who need the full configuration together with sync counts and the last scheduled-reconcile outcome should call `GET /admin/mirror/status`; writes go through `POST /github/repo` on this same path.",
          "The value is served from the platform-settings cache. A write through `POST /github/repo` busts that cache on the pod that handled it, so the change is visible there immediately and elsewhere within the settings cache TTL. Do not poll this endpoint to confirm a write landed — trust the write's own response body.",
        ].join("\n\n"),
        operationId: "getMirrorRepoConfig",
        tags: ["Mirror"],
        security: publicAuth(),
        responses: {
          ...jsonResponse(
            mirrorPublicConfigSchema,
            "The mirror's public coordinates and its enabled flag. Always 200, including when the mirror is disabled or entirely unconfigured — read `enabled` and the empty-string fields to tell those cases apart.",
            {
              example: { owner: "ChronoAIProject", repo: "ornn-skills", branch: "main", enabled: true },
            },
          ),
          // Reads the platform-settings section, which is a database-backed
          // cache lookup and can fail even though the endpoint is public.
          ...problemResponses(500),
        },
      },

      post: {
        summary: "Update the GitHub mirror configuration",
        description: [
          "Partial update of the mirror configuration: the kill switch, the repository coordinates, and the GitHub App credentials Ornn authenticates to GitHub with. Requires the **`ornn:admin:skill`** permission on top of a valid bearer token. Semantics are PATCH-like — a key you omit is preserved exactly as stored, unknown keys are ignored, and `reconcileSchedule` (part of the same settings section but not editable here) is carried through untouched. An empty body is a no-op that returns the current configuration.",
          "Two behaviours differ from a naive merge. First, an empty string is a REAL value meaning \"clear this field\": `{\"owner\": \"\"}` unsets the owner rather than leaving it alone. Second, `appPrivateKey` carries a sentinel — the value this API hands back is mid-masked with the bullet character `•`, and posting any string containing `•` means \"keep the stored key\". That is what lets an admin form round-trip the masked display value without wiping the credential. Posting a real PEM replaces the key; posting `\"\"` clears it.",
          "Changing `owner` or `repo` abandons the repository Ornn has been mirroring into. If any skill still carries a `mirrorSync` stamp, the request is REFUSED with 409 `old_repo_not_confirmed` and nothing is written; resend the identical body with `confirmAbandonOldRepo: true` to proceed. On a confirmed change every skill's stamp is cleared — those stamps point at commit SHAs in the old repository, so keeping them would produce audit links to the wrong place — and the whole registry reports \"never synced\" until the next reconcile lands a real commit. The old repository is NOT cleaned up; delete its contents yourself if that matters. Changing only `branch`, `enabled`, or the credentials does not trigger any of this.",
          "The response echoes the stored configuration with `appPrivateKey` mid-masked; never treat that string as a usable key. To apply the new configuration immediately rather than waiting for the schedule, follow with `POST /admin/mirror/reconcile`, then poll `GET /admin/mirror/status` for counts and the outcome.",
        ].join("\n\n"),
        operationId: "updateMirrorRepoConfig",
        tags: ["Mirror"],
        security: bearerAuth(),
        requestBody: jsonBody(
          mirrorConfigPatchBodySchema,
          "Any subset of the editable mirror fields. Omitted keys are preserved, empty strings clear, unknown keys are ignored.",
          {
            example: {
              enabled: true,
              owner: "ChronoAIProject",
              repo: "ornn-skills",
              branch: "main",
              confirmAbandonOldRepo: true,
            },
          },
        ),
        responses: {
          ...jsonResponse(
            mirrorAdminConfigSchema,
            "The mirror configuration as now stored, with `appPrivateKey` mid-masked. Note this is 200, not 201 — the settings section is updated in place, never created as a new resource.",
            {
              example: {
                enabled: true,
                owner: "ChronoAIProject",
                repo: "ornn-skills",
                branch: "main",
                appId: "1234567",
                installationId: "87654321",
                appPrivateKey: "----••••••••••••••••••••••••----",
              },
            },
          ),
          ...problemResponses(
            {
              400:
                "Bad request — the body was not a JSON object (`invalid_body`), or a field failed its shape check: `invalid_owner`, `invalid_repo`, `INVALID_BRANCH` (that one really is upper-case — a legacy code kept for compatibility), or `invalid_setting` for `enabled`, `appId`, `installationId`, and `appPrivateKey`. Validation is all-or-nothing: when any field is rejected, nothing at all is persisted.",
            },
            401,
            {
              403:
                "Forbidden (`forbidden`) — the caller is authenticated but lacks the `ornn:admin:skill` permission this operation requires. NyxID is authoritative for that permission; a user flagged `isAdmin` in the user directory is not necessarily granted it.",
            },
            {
              409:
                "Conflict (`old_repo_not_confirmed`) — the request changes `owner`/`repo` while skills still carry sync stamps pointing at the current repository. Nothing was written. `detail` names the old coordinates, the new coordinates, and how many skills are affected. Resend the identical body with `confirmAbandonOldRepo: true` to proceed.",
            },
            {
              500:
                "Internal server error — the settings write, or the follow-up stamp reset, failed. The ordering matters here: the configuration is persisted BEFORE the `mirrorSync` stamps are cleared, so a failure at the second step leaves the new coordinates live with stale stamps still pointing at the abandoned repository. Do not blindly retry — check `GET /admin/mirror/status`, then run `POST /admin/mirror/reconcile` to re-stamp against the new repository.",
            },
          ),
        },
      },
    },
  };
}
