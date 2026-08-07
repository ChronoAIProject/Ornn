/**
 * Messaging domain — everything Ornn pushes *at* a caller, plus the admin
 * surfaces that author it (#1214).
 *
 * Fourteen operations across three collaborating sub-domains. They are
 * documented together because they are not independent: two of them are
 * write surfaces whose output is read through a third.
 *
 *   1. **Notifications** (`/notifications*`, 4 ops, caller-scoped).
 *      The inbox. `GET /notifications` is a *merged* feed — per-user
 *      notifications that Ornn's own domain events emit (audit finished,
 *      quota granted, GitHub auto-sync succeeded/failed, a skillset member
 *      became unreadable) interleaved by `createdAt` with the admin-authored
 *      broadcasts the caller is a recipient of. Rows are a discriminated
 *      union on `source`; an integrator MUST branch on it, because the two
 *      variants do not share a title field (`title` vs `titleI18n`).
 *      Read state is per-caller and lives in two different places
 *      (a column on the notification, a receipt row for a broadcast), but
 *      `POST /notifications/{id}/read` hides that: it accepts either kind
 *      of id and routes by lookup.
 *
 *   2. **Announcements** (`/announcements*`, `/admin/announcements*`, 6 ops).
 *      Site-wide notices rendered by the web SPA — a landing-page popup
 *      (`/announcements/active`, at most one) and a News-page archive
 *      (`/announcements`, everything released). These are **not** delivered
 *      to the inbox and carry no per-user read state: they are anonymous,
 *      unauthenticated reads with scheduling windows, written by admins.
 *
 *   3. **Broadcasts** (`/admin/broadcasts*`, 4 ops, admin-only).
 *      The authoring surface for inbox messages. There is deliberately no
 *      public broadcast read endpoint — users receive broadcasts through
 *      `GET /notifications`, which is why creating one has observable
 *      effects on every recipient's `unread-count`.
 *
 * **Which one do I want?** If you are an agent reacting to events about
 * your own skills, you want `GET /notifications` (poll `unread-count`,
 * fetch the feed, acknowledge with mark-read). If you are rendering a
 * product surface, you want `/announcements`. The `/admin/*` halves both
 * require the `ornn:admin:skill` permission scope and are not part of a
 * normal agent integration.
 *
 * **Bilingual content, two different encodings.** Announcements flatten
 * locales into sibling fields (`titleEn` / `titleZh`) with EN required and
 * ZH optional-and-empty-when-unset. Broadcasts nest them (`titleI18n:
 * { en, zh }`) with **both** locales required. Neither surface negotiates
 * language server-side — both locales are always returned and the client
 * resolves at render time, falling back to EN when the active locale's
 * slot is empty.
 *
 * Response schemas here are hand-written JSON Schema because these handlers
 * project their wire shapes inline from TypeScript interfaces (`FeedItemDto`,
 * `AdminAnnouncementDto`, `AdminBroadcastResponse`) with no Zod schema
 * describing the output. The two broadcast request bodies DO have a Zod
 * source of truth and are generated from it.
 *
 * @module openapi/paths/messaging
 */

import {
  bearerAuth,
  jsonBody,
  jsonResponse,
  pathParam,
  problemResponses,
  publicAuth,
  queryParam,
  type JsonSchema,
  type PathMap,
} from "../helpers";
import {
  createBroadcastSchema,
  patchBroadcastSchema,
} from "../../domains/broadcasts/schemas";
import { NOTIFICATION_CATEGORIES } from "../../domains/notifications/types";

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

/** `{ en, zh }` pair as broadcasts encode it. Both locales always present. */
function i18nPair(what: string): JsonSchema {
  return {
    type: "object",
    required: ["en", "zh"],
    properties: {
      en: { type: "string", description: `English ${what}. Always non-empty.` },
      zh: { type: "string", description: `Chinese ${what}. Always non-empty — broadcasts require both locales at create time, unlike announcements where ZH is optional.` },
    },
    description: `Bilingual ${what}. No server-side language negotiation: both locales are always returned and the client picks, falling back to \`en\`.`,
  };
}

/**
 * Fields of a stored per-user notification, shared by the `source: "user"`
 * feed row and the mark-read response — which returns the raw document and
 * therefore carries every field below EXCEPT the `source` discriminator.
 */
const notificationProperties: Record<string, JsonSchema> = {
  _id: {
    type: "string",
    description:
      "Notification id (UUID v4). Pass this to `POST /notifications/{id}/read`.",
    examples: ["1f6b3c9e-2a4d-4c1f-9b7e-0d5a8c3e1f42"],
  },
  userId: {
    type: "string",
    description:
      "Recipient NyxID user id. Always equals the caller's own `userId` from `GET /me` — the feed is strictly caller-scoped and there is no way to read another user's notifications.",
  },
  category: {
    type: "string",
    enum: [...NOTIFICATION_CATEGORIES],
    description:
      "Event class that produced this notification. This is the field to switch on for automated handling — `title` and `body` are human prose and their wording is not part of the contract. `audit.completed` fires on every audit of a skill you own; `audit.risky_for_consumer` fires on a yellow/red audit of a skill shared *with* you; `quota.credits_granted` fires when an admin grant or a redeemed code tops up your buckets; `launchPromo.codeDelivered` fires once, when the launch-promo cohort awards you a redemption code — the code itself is in `data`, so read it from there rather than parsing it out of `title`; `skillset.member_unreadable` warns that a member skill of your skillset stopped being readable by you; `skill.source_broken`, `skill.auto_synced`, and `skill.auto_sync_failed` report the outcome of the automatic GitHub-source drift check. The vocabulary is closed and additive — unknown values should be tolerated, never rejected.",
  },
  title: {
    type: "string",
    description:
      "One-line human summary for a list view. Plain text, never empty. Wording is not stable across releases — do not parse it.",
  },
  body: {
    type: "string",
    description:
      "Longer plain-text explanation for a detail view. **Key is absent** (not null) when the emitting event supplied none, so use a presence check rather than a truthiness check on `null`.",
  },
  link: {
    type: "string",
    description:
      "Deep link into the ornn-web SPA, as a root-relative path — never an absolute URL, so prepend your own web origin. **Key is absent** when the event has no click target (e.g. quota grants). Purely a UI affordance; it is not an API endpoint.",
    examples: ["/skills/3f1c0a4e-9c2b-4a1e-9e3a-6b5d2f7c8a10/audits?version=1.2.0"],
  },
  data: {
    type: "object",
    additionalProperties: true,
    description:
      "Structured payload for machine handling, shaped by `category` — e.g. `{ skillGuid, skillName, version, verdict, overallScore }` for the audit categories, `{ surface, amount, adminDisplayName }` for `quota.credits_granted`, `{ redemptionCodeId, redemptionCode, nyxidInviteCode, awardPlayground, awardSkillGen }` for `launchPromo.codeDelivered` (`nyxidInviteCode` is `null` when the promo bundles no invite), `{ skillGuid, repo, ref }` for `skill.source_broken`. Always an object, `{}` when the emitter supplied nothing. Read ids from here rather than scraping them out of `link`.",
  },
  readAt: {
    type: ["string", "null"],
    format: "date-time",
    description: "ISO-8601 UTC timestamp of when the caller marked this read, or `null` while unread.",
  },
  createdAt: {
    type: "string",
    format: "date-time",
    description: "ISO-8601 UTC timestamp of emission. This is the sort key for the merged feed.",
  },
};

/** Fields always present on a stored notification, whatever the emitter supplied. */
const NOTIFICATION_REQUIRED = ["_id", "userId", "category", "title", "data", "readAt", "createdAt"];

const feedItemUserSchema: JsonSchema = {
  type: "object",
  required: ["source", ...NOTIFICATION_REQUIRED],
  properties: {
    source: {
      type: "string",
      const: "user",
      description:
        "Discriminator. `user` means this row came from the caller's own `notifications` collection — a domain event addressed to them specifically. Branch on this before reading any other field.",
    },
    ...notificationProperties,
  },
};

/**
 * Mark-read response for a per-user notification: the stored document,
 * returned verbatim. Note the absent `source` — the handler skips the feed
 * projection here, so this shape is NOT interchangeable with a feed row.
 */
const notificationDocumentSchema: JsonSchema = {
  type: "object",
  required: NOTIFICATION_REQUIRED,
  properties: notificationProperties,
  description:
    "The per-user notification after the update, with `readAt` now populated. Same field set as a `source: \"user\"` feed row **minus the `source` discriminator** — the handler returns the stored document rather than the feed projection.",
};

const broadcastReceiptSchema: JsonSchema = {
  type: "object",
  required: ["source", "readAt"],
  properties: {
    source: {
      type: "string",
      const: "broadcast",
      description:
        "Present only on this variant. Its presence is what tells you a broadcast receipt was written rather than a notification updated.",
    },
    readAt: {
      type: "string",
      format: "date-time",
      description: "ISO-8601 UTC timestamp on the caller's read receipt for this broadcast.",
    },
  },
  description:
    "The read receipt written for a broadcast. Deliberately minimal — it does not echo the broadcast's content back.",
};

const feedItemBroadcastSchema: JsonSchema = {
  type: "object",
  required: ["_id", "source", "titleI18n", "bodyMarkdownI18n", "createdAt", "readAt"],
  properties: {
    _id: {
      type: "string",
      description:
        "Broadcast id (UUID v4) — the same id the admin surface reports as `id` on `GET /admin/broadcasts`. Pass it to `POST /notifications/{id}/read` exactly like a notification id.",
    },
    source: {
      type: "string",
      const: "broadcast",
      description:
        "Discriminator. `broadcast` means an admin authored this message and it landed in the inbox of every targeted user. There is no `category`, `link`, or `data` on this variant, and `title`/`body` do not exist — read `titleI18n` / `bodyMarkdownI18n` instead.",
    },
    titleI18n: i18nPair("title"),
    bodyMarkdownI18n: i18nPair("body, in Markdown"),
    createdAt: {
      type: "string",
      format: "date-time",
      description:
        "ISO-8601 UTC timestamp of when the admin created the broadcast. Editing a broadcast does not move it — the feed keeps its original position.",
    },
    readAt: {
      type: ["string", "null"],
      format: "date-time",
      description:
        "ISO-8601 UTC timestamp from the caller's read receipt, or `null` when they have no receipt. Read state is per-caller: the same broadcast is unread for one user and read for another.",
    },
  },
};

const feedItemSchema: JsonSchema = {
  oneOf: [feedItemUserSchema, feedItemBroadcastSchema],
  description:
    "One inbox row. A tagged union discriminated by the `source` property, whose value is the literal `\"user\"` or `\"broadcast\"`; select the variant on that field before reading anything else. The two variants share only `_id`, `createdAt`, and `readAt`.",
};

const publicAnnouncementProperties: Record<string, JsonSchema> = {
  id: {
    type: "string",
    description: "Announcement id (UUID v4).",
    examples: ["b1e5f0d2-7c3a-4f8b-9d61-2a0c4e7f5b93"],
  },
  titleEn: { type: "string", description: "English title. Always non-empty — EN is the canonical locale." },
  titleZh: {
    type: "string",
    description: "Chinese title. Empty string when the admin left it unset; fall back to `titleEn` in that case.",
  },
  bodyMarkdownEn: { type: "string", description: "English body as Markdown. Always non-empty. Render it — it is authored content, not plain text." },
  bodyMarkdownZh: { type: "string", description: "Chinese body as Markdown. Empty string when unset; fall back to `bodyMarkdownEn`." },
  ctaLabelEn: {
    type: ["string", "null"],
    description: "English label for the call-to-action button. Non-`null` if and only if `ctaUrl` is non-`null` — the pair is validated as both-or-neither on write.",
  },
  ctaLabelZh: {
    type: ["string", "null"],
    description: "Chinese CTA label. Independent of `ctaLabelEn` and may be `null` even when a CTA exists; fall back to `ctaLabelEn`.",
  },
  ctaUrl: {
    type: ["string", "null"],
    format: "uri",
    description: "Absolute URL the CTA button opens. Locale-independent — one URL serves both languages. `null` when the announcement has no CTA.",
  },
};

const publicAnnouncementSchema: JsonSchema = {
  type: "object",
  required: ["id", "titleEn", "titleZh", "bodyMarkdownEn", "bodyMarkdownZh", "ctaLabelEn", "ctaLabelZh", "ctaUrl"],
  properties: publicAnnouncementProperties,
  description:
    "Anonymous-safe projection. Scheduling internals (`enabled`, `startsAt`, `endsAt`) and audit fields (`createdBy`, `createdAt`, `updatedAt`) are deliberately stripped — they exist only on the admin shape.",
};

const publicAnnouncementListItemSchema: JsonSchema = {
  type: "object",
  required: [
    "id",
    "titleEn",
    "titleZh",
    "bodyMarkdownEn",
    "bodyMarkdownZh",
    "ctaLabelEn",
    "ctaLabelZh",
    "ctaUrl",
    "publishedAt",
  ],
  properties: {
    ...publicAnnouncementProperties,
    publishedAt: {
      type: "string",
      format: "date-time",
      description:
        "ISO-8601 UTC timestamp of when this announcement became visible — `startsAt` when a schedule was set, otherwise `createdAt`. Render this as the date eyebrow. Note the list is sorted by `createdAt`, so a back-dated `startsAt` can make `publishedAt` non-monotonic down the array.",
    },
  },
};

const adminAnnouncementSchema: JsonSchema = {
  type: "object",
  required: [
    "id",
    "titleEn",
    "titleZh",
    "bodyMarkdownEn",
    "bodyMarkdownZh",
    "ctaLabelEn",
    "ctaLabelZh",
    "ctaUrl",
    "enabled",
    "startsAt",
    "endsAt",
    "createdBy",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    ...publicAnnouncementProperties,
    enabled: {
      type: "boolean",
      description:
        "Master switch. `false` hides the announcement from both public endpoints regardless of its window. Flip this rather than deleting when you want to retract a live notice.",
    },
    startsAt: {
      type: ["string", "null"],
      format: "date-time",
      description: "Inclusive lower bound of the visibility window, or `null` for no lower bound (visible from creation).",
    },
    endsAt: {
      type: ["string", "null"],
      format: "date-time",
      description:
        "Exclusive upper bound of the visibility window, or `null` for open-ended. Expiry removes the announcement from the popup but **not** from the News-page archive.",
    },
    createdBy: { type: "string", description: "NyxID user id of the admin who created the announcement. Never changes, even after edits." },
    createdAt: { type: "string", format: "date-time", description: "ISO-8601 UTC creation timestamp. Also the sort key for the admin list and the tiebreak for which announcement is 'active'." },
    updatedAt: { type: "string", format: "date-time", description: "ISO-8601 UTC timestamp of the last edit. Equals `createdAt` until the first PATCH." },
  },
};

const adminBroadcastSchema: JsonSchema = {
  type: "object",
  required: [
    "id",
    "titleI18n",
    "bodyMarkdownI18n",
    "createdBy",
    "updatedBy",
    "recipientUserIds",
    "createdAt",
    "updatedAt",
    "readCount",
  ],
  properties: {
    id: {
      type: "string",
      description:
        "Broadcast id (UUID v4). This is the same value recipients see as `_id` on their `source: \"broadcast\"` feed rows.",
      examples: ["9c8e1a70-5b2d-4e63-8f0a-1d7c4b6e2905"],
    },
    titleI18n: i18nPair("title"),
    bodyMarkdownI18n: i18nPair("body, in Markdown"),
    createdBy: { type: "string", description: "NyxID user id of the admin who authored the broadcast." },
    updatedBy: {
      type: "string",
      description: "NyxID user id of the admin who last edited it. Equals `createdBy` until the first PATCH.",
    },
    recipientUserIds: {
      type: ["array", "null"],
      items: { type: "string" },
      description:
        "Targeting list, frozen at create time. `null` means every user receives it. A non-empty array of NyxID user ids means only those users do — to everyone else the broadcast does not exist at all (invisible in the feed, in `unread-count`, and to `mark-all-read`, and `POST /notifications/{id}/read` on it answers 404 so the id cannot be probed). Never `undefined` on the wire.",
    },
    createdAt: { type: "string", format: "date-time", description: "ISO-8601 UTC creation timestamp. Also the position the message takes in every recipient's feed." },
    updatedAt: { type: "string", format: "date-time", description: "ISO-8601 UTC timestamp of the last edit. Equals `createdAt` until the first PATCH." },
    readCount: {
      type: "integer",
      minimum: 0,
      description:
        "Number of distinct users who have read this broadcast. Counts receipts, so for a targeted broadcast the denominator is `recipientUserIds.length` and for an everyone-broadcast it is the whole user base. `0` on a freshly created broadcast.",
    },
  },
};

const deletedIdSchema: JsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", description: "Id of the record that was deleted, echoed back for correlation." },
  },
};

// ---------------------------------------------------------------------------
// Request bodies (announcements — hand-written; see the module report)
// ---------------------------------------------------------------------------

const CTA_PAIRING_RULE =
  "`ctaLabelEn` and `ctaUrl` are validated as a pair: send both, or neither. Sending one alone is rejected with 400 and the offending field named in `detail`. `ctaLabelZh` is independent — it may be omitted even when a CTA exists.";

const announcementCreateBody: JsonSchema = {
  type: "object",
  required: ["titleEn", "bodyMarkdownEn", "enabled"],
  properties: {
    titleEn: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description: "English title. Required, trimmed, must be non-empty after trimming.",
    },
    titleZh: {
      type: "string",
      maxLength: 200,
      description: "Chinese title. Optional; omit it or send `\"\"` to leave the locale unset — readers then fall back to `titleEn`.",
    },
    bodyMarkdownEn: {
      type: "string",
      minLength: 1,
      maxLength: 20000,
      description: "English body as Markdown. Required, trimmed, must be non-empty after trimming.",
    },
    bodyMarkdownZh: {
      type: "string",
      maxLength: 20000,
      description: "Chinese body as Markdown. Optional; omit to leave unset.",
    },
    ctaLabelEn: {
      type: ["string", "null"],
      minLength: 1,
      maxLength: 80,
      description: `English call-to-action button label. ${CTA_PAIRING_RULE}`,
    },
    ctaLabelZh: {
      type: ["string", "null"],
      minLength: 1,
      maxLength: 80,
      description: "Chinese call-to-action button label. Optional translation of `ctaLabelEn`; readers fall back to the EN label when this is `null`.",
    },
    ctaUrl: {
      type: ["string", "null"],
      format: "uri",
      maxLength: 2048,
      description: `Absolute URL the CTA opens. Must parse as a URL. ${CTA_PAIRING_RULE}`,
    },
    enabled: {
      type: "boolean",
      description:
        "Required — there is no default. `false` creates the announcement in a hidden state so it can be drafted and reviewed before going live.",
    },
    startsAt: {
      type: ["string", "null"],
      format: "date-time",
      description:
        "Inclusive start of the visibility window as an ISO-8601 date-time (a `Z` suffix or an explicit `±hh:mm` offset are both accepted; a bare local timestamp is rejected). Omit or send `null` for 'visible immediately'. Also becomes the archive's `publishedAt`.",
      examples: ["2026-08-10T09:00:00Z"],
    },
    endsAt: {
      type: ["string", "null"],
      format: "date-time",
      description:
        "Exclusive end of the visibility window, same format as `startsAt`. Must be strictly after `startsAt` when both are set, otherwise 400 `INVALID_ANNOUNCEMENT_WINDOW`. Omit or send `null` for open-ended.",
      examples: ["2026-08-24T09:00:00Z"],
    },
  },
  description:
    "Announcement to create. Mirrors the route's Zod validator in `domains/announcements/routes.ts`, which is not exported and therefore transcribed here rather than generated.",
};

/**
 * Patch body. Deliberately NOT a re-export of `announcementCreateBody.properties`:
 * every field is optional here, and five of them mean something different on a
 * patch than they do on a create (nothing is "required", `enabled` is the
 * retraction switch rather than a draft flag, and an omitted window bound keeps
 * its stored value instead of meaning "unbounded"). Field descriptions are what
 * Swagger UI and generated clients actually show, so they are written for the
 * patch path rather than inherited from create.
 */
const announcementUpdateProperties: Record<string, JsonSchema> = {
  titleEn: {
    type: "string",
    minLength: 1,
    maxLength: 200,
    description: "English title. Optional on a patch; when sent it is trimmed and must still be non-empty.",
  },
  titleZh: {
    type: "string",
    maxLength: 200,
    description: "Chinese title. Omit to keep the stored translation; send `\"\"` to clear it, after which readers fall back to `titleEn`.",
  },
  bodyMarkdownEn: {
    type: "string",
    minLength: 1,
    maxLength: 20000,
    description: "English body as Markdown. Optional on a patch; when sent it is trimmed and must still be non-empty.",
  },
  bodyMarkdownZh: {
    type: "string",
    maxLength: 20000,
    description: "Chinese body as Markdown. Omit to keep the stored translation; send `\"\"` to clear it.",
  },
  ctaLabelEn: {
    type: ["string", "null"],
    minLength: 1,
    maxLength: 80,
    description:
      "English call-to-action button label. The `ctaLabelEn`/`ctaUrl` both-or-neither rule is checked against **this payload alone**, not against the merged record — so send both together to change either, and send both as `null` to drop the CTA.",
  },
  ctaLabelZh: {
    type: ["string", "null"],
    minLength: 1,
    maxLength: 80,
    description: "Chinese call-to-action button label. Independent of the pairing rule; omit to keep it, send `null` to drop it.",
  },
  ctaUrl: {
    type: ["string", "null"],
    format: "uri",
    maxLength: 2048,
    description:
      "Absolute URL the CTA opens. Must parse as a URL when non-`null`, and is subject to the same payload-local pairing rule as `ctaLabelEn`.",
  },
  enabled: {
    type: "boolean",
    description:
      "Visibility switch. Setting it to `false` is the retraction path — the announcement disappears from both public endpoints immediately but is preserved, so `true` puts it back. Omit to leave the current state alone.",
  },
  startsAt: {
    type: ["string", "null"],
    format: "date-time",
    description:
      "Inclusive start of the visibility window as an ISO-8601 date-time (a `Z` suffix or an explicit `±hh:mm` offset are both accepted; a bare local timestamp is rejected). **Omit to keep the stored bound**; send `null` to clear it, which makes the announcement visible from creation.",
    examples: ["2026-08-10T09:00:00Z"],
  },
  endsAt: {
    type: ["string", "null"],
    format: "date-time",
    description:
      "Exclusive end of the visibility window, same format as `startsAt`. **Omit to keep the stored bound**; send `null` to clear it (open-ended). When the merged result has both bounds set, `endsAt` must be strictly after `startsAt`, otherwise 400 `INVALID_ANNOUNCEMENT_WINDOW`.",
    examples: ["2026-08-24T09:00:00Z"],
  },
};

const announcementUpdateBody: JsonSchema = {
  type: "object",
  properties: announcementUpdateProperties,
  description:
    "Sparse patch — send only the fields you intend to change; omitted fields keep their stored value. Nothing is required individually, but the body must carry at least one field (an empty object is rejected with 400 `invalid_announcement_input`, detail `No fields to update`). Per-field rules match create for the fields you do send, with two window caveats: the `startsAt < endsAt` check runs against the *merged* result (the side you did not send is read from storage), while the `ctaLabelEn`/`ctaUrl` both-or-neither check runs against the **patch payload alone** — so changing only `ctaUrl` on an announcement that already has a label is rejected; resend both.",
};

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function messagingPaths(prefix: string): PathMap {
  return {
    [`${prefix}/notifications`]: {
      get: {
        summary: "List the caller's merged notification feed",
        description:
          "Return the caller's inbox: their own per-user notifications interleaved with every admin broadcast they are a recipient of, sorted by `createdAt` descending. Rows are a discriminated union on `source` — `\"user\"` rows carry `category` / `title` / `body` / `link` / `data`, `\"broadcast\"` rows carry bilingual `titleI18n` / `bodyMarkdownI18n` and nothing else — so switch on `source` before touching any other field. This is the endpoint an agent polls to learn about events on its own skills (audit verdicts, GitHub auto-sync outcomes, quota grants); use `category` for automated handling and treat `title` / `body` as human prose whose wording may change. There is **no cursor pagination**: the feed is a top-N window over both sources, so a caller who needs history beyond `limit` cannot page further back. Read state is per-caller and is reported the same way for both variants (`readAt`), even though a notification stores it inline while a broadcast stores a separate receipt. Cheap sibling: `GET /notifications/unread-count` returns just the badge number, which is what you should poll on an interval.",
        operationId: "listNotifications",
        tags: ["Notifications"],
        security: bearerAuth(),
        parameters: [
          queryParam(
            "unread",
            "Set to the exact literal string `true` to return only unread rows (per-user notifications with `readAt === null`, and broadcasts with no receipt for this caller). Any other value — including `1`, `TRUE`, `yes`, or the empty string — is treated as `false`, so this parameter never produces a validation error. Defaults to `false` (all rows).",
            { type: "string", enum: ["true", "false"], default: "false", examples: ["true"] },
          ),
          queryParam(
            "limit",
            "Maximum rows to return. Parsed as a base-10 integer and clamped into `[1, 200]`; the default is `50`. Nothing here 400s — a missing, empty, or unparseable value (`abc`) silently falls back to the default, and out-of-range values are clamped rather than rejected. The bound applies to the *merged* result, not per source: asking for `10` yields the 10 newest rows across notifications and broadcasts combined, never 10 of each.",
            { type: "integer", minimum: 1, maximum: 200, default: 50, examples: [50] },
          ),
        ],
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["items"],
              properties: {
                items: {
                  type: "array",
                  items: feedItemSchema,
                  description:
                    "Feed rows, newest first, at most `limit` of them. Empty when the caller has no notifications and is a recipient of no broadcast.",
                },
              },
            },
            "The caller's merged inbox feed.",
            {
              example: {
                items: [
                  {
                    _id: "9c8e1a70-5b2d-4e63-8f0a-1d7c4b6e2905",
                    source: "broadcast",
                    titleI18n: { en: "Scheduled maintenance", zh: "计划维护" },
                    bodyMarkdownI18n: {
                      en: "The registry will be read-only on **Sunday 03:00–04:00 UTC**.",
                      zh: "注册表将于 **周日 03:00–04:00 UTC** 进入只读状态。",
                    },
                    createdAt: "2026-08-07T08:00:00.000Z",
                    readAt: null,
                  },
                  {
                    _id: "1f6b3c9e-2a4d-4c1f-9b7e-0d5a8c3e1f42",
                    source: "user",
                    userId: "usr_01HXYZ2K3M4N5P6Q7R8S9T",
                    category: "audit.completed",
                    title: "Skill audit passed — pdf-extract v1.2.0 · score 9.1/10",
                    body: "Audit verdict was green. No follow-up required.",
                    link: "/skills/3f1c0a4e-9c2b-4a1e-9e3a-6b5d2f7c8a10/audits?version=1.2.0",
                    data: {
                      skillGuid: "3f1c0a4e-9c2b-4a1e-9e3a-6b5d2f7c8a10",
                      skillName: "pdf-extract",
                      version: "1.2.0",
                      verdict: "green",
                      overallScore: 9.1,
                    },
                    readAt: "2026-08-07T07:41:03.902Z",
                    createdAt: "2026-08-07T07:12:44.001Z",
                  },
                ],
              },
            },
          ),
          ...problemResponses(401, {
            500: "Internal error (`internal_error`) — the notifications or broadcasts collection could not be read. Nothing was mutated; retry with backoff.",
          }),
        },
      },
    },

    [`${prefix}/notifications/unread-count`]: {
      get: {
        summary: "Count the caller's unread notifications",
        description:
          "Return a single integer: unread per-user notifications plus broadcasts the caller is a recipient of and has no read receipt for. This is the badge endpoint — poll it on an interval and only fetch the feed when the number moves. Be aware of what the saving actually is: it counts per-user rows instead of fetching them and it answers with one integer instead of a page of Markdown bodies, but it still reads the same broadcast roster the feed does, so the win is in payload size and client work rather than in database round-trips. The count and the feed are consistent with each other: `unread-count` equals the number of rows `GET /notifications?unread=true&limit=200` would return, up to that cap. Targeted broadcasts the caller is not a recipient of never contribute.",
        operationId: "getNotificationUnreadCount",
        tags: ["Notifications"],
        security: bearerAuth(),
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["count"],
              properties: {
                count: {
                  type: "integer",
                  minimum: 0,
                  description:
                    "Total unread items across both sources. Unbounded — it is a true count, not clamped to the feed's 200-row window.",
                },
              },
            },
            "The caller's unread badge number.",
            { example: { count: 3 } },
          ),
          ...problemResponses(401, {
            500: "Internal error (`internal_error`) — the unread count or the broadcast roster could not be read. Keep showing the last known badge value and retry with backoff.",
          }),
        },
      },
    },

    [`${prefix}/notifications/{id}/read`]: {
      post: {
        summary: "Mark one notification or broadcast as read",
        description:
          "Acknowledge a single inbox row. The id space is shared: pass either a per-user notification `_id` or a broadcast `_id` — the server resolves which by lookup (per-user first, since those are orders of magnitude more common) and does the right thing, marking the notification's `readAt` or upserting a broadcast read receipt. Has **no request body**. Safe to repeat, but the two sources differ in what a repeat does: a broadcast receipt is written with `$setOnInsert`, so the **first** read time wins and re-marking returns the original `readAt`; a per-user notification's `readAt` is overwritten with the current time on every call. If you care about first-read time, do not re-mark notifications. The 200 payload is a tagged union that mirrors which kind of row was hit: a per-user notification comes back as the full stored document, while a broadcast comes back as the minimal `{ source: \"broadcast\", readAt }` receipt — note the asymmetry, the notification variant does **not** carry a `source` field even though the feed's rows do. Use `POST /notifications/mark-all-read` instead of looping this endpoint over a page of ids.",
        operationId: "markNotificationRead",
        tags: ["Notifications"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "id",
            "The `_id` of the feed row to acknowledge — either a per-user notification id or a broadcast id, both UUID v4. Take it verbatim from `GET /notifications`; there is no separate endpoint per source.",
            { type: "string", format: "uuid" },
            "1f6b3c9e-2a4d-4c1f-9b7e-0d5a8c3e1f42",
          ),
        ],
        responses: {
          ...jsonResponse(
            {
              oneOf: [notificationDocumentSchema, broadcastReceiptSchema],
              description:
                "Union of two shapes. The notification variant is the full stored document (no `source` field); the broadcast variant is the two-field receipt (`source` is present and equals `\"broadcast\"`). Test for the `source` key to tell them apart.",
            },
            "The row was marked read for this caller.",
            {
              example: { source: "broadcast", readAt: "2026-08-07T09:20:11.443Z" },
            },
          ),
          ...problemResponses(401, {
            404: "Not found (`notification_not_found`) — no per-user notification with this id belongs to the caller, and no broadcast with this id is visible to them. A targeted broadcast the caller is not a recipient of answers 404 identically to a typo'd id, so the endpoint cannot be used to probe for the existence of targeted messages.",
            500: "Internal error (`internal_error`) — the lookup or the read-state write failed. The row may or may not have been marked; re-reading the feed is the cheapest way to find out, and re-marking is harmless for broadcasts (first read time wins).",
          }),
        },
      },
    },

    [`${prefix}/notifications/mark-all-read`]: {
      post: {
        summary: "Mark the caller's entire inbox as read",
        description:
          "Clear the badge in one call: sets `readAt` on every unread per-user notification and writes a read receipt for every visible broadcast the caller has not yet acknowledged. Scoped to the caller and to broadcasts they are actually a recipient of — a targeted broadcast addressed to someone else is never touched. Has **no request body** and takes no parameters; there is no way to limit it to a subset, so use `POST /notifications/{id}/read` when you need per-row control. Returns the number of rows that actually *transitioned* to read across both sources, so calling it twice returns a positive number then `0`. That makes it safe to retry: the operation is idempotent even though it is a POST, and a `0` on retry means the first attempt had already landed. After a successful call `GET /notifications/unread-count` reports `0`.",
        operationId: "markAllNotificationsRead",
        tags: ["Notifications"],
        security: bearerAuth(),
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["updated"],
              properties: {
                updated: {
                  type: "integer",
                  minimum: 0,
                  description:
                    "How many rows changed from unread to read — per-user notifications plus newly written broadcast receipts. `0` when the inbox was already fully read.",
                },
              },
            },
            "Every unread row visible to the caller is now read.",
            { example: { updated: 3 } },
          ),
          ...problemResponses(401, {
            500: "Internal error (`internal_error`) — the sweep failed partway. Per-user notifications are marked before broadcast receipts are written, so a failure on the broadcast half leaves the per-user half already read. Retrying is safe: the second pass only touches what is still unread.",
          }),
        },
      },
    },

    [`${prefix}/announcements`]: {
      get: {
        summary: "List released announcements (public news archive)",
        description:
          "Return every *released* announcement, newest first — the archive behind the product's News page. 'Released' means `enabled === true` and the start gate has elapsed (`startsAt` is null or in the past). Expired entries are deliberately **kept**: `endsAt` only controls the landing popup, never the archive, so this list grows monotonically until an admin disables or deletes something. **Public and unauthenticated** — send no token; a token is ignored if present, and the response is identical for everyone. The payload is anonymous-safe: no `createdBy`, no `enabled`, no window bounds. Both locales are always included, so a client can switch language without refetching. This is not an inbox: announcements are never delivered to `GET /notifications` and carry no per-user read state. There is no pagination and no filtering — the full archive comes back in one response, so cache it client-side. Use `GET /announcements/active` when you only want the single notice to show right now.",
        operationId: "listPublishedAnnouncements",
        tags: ["Announcements"],
        security: publicAuth(),
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["items"],
              properties: {
                items: {
                  type: "array",
                  items: publicAnnouncementListItemSchema,
                  description: "Released announcements, ordered by `createdAt` descending. Empty when nothing has been released.",
                },
              },
            },
            "The public announcement archive.",
            {
              example: {
                items: [
                  {
                    id: "b1e5f0d2-7c3a-4f8b-9d61-2a0c4e7f5b93",
                    titleEn: "Skillsets are now in public beta",
                    titleZh: "技能集公测上线",
                    bodyMarkdownEn: "Compose several skills into one installable bundle. See the docs for details.",
                    bodyMarkdownZh: "将多个技能组合为一个可安装的包。详情请查看文档。",
                    ctaLabelEn: "Read the docs",
                    ctaLabelZh: null,
                    ctaUrl: "https://example.com/docs/skillsets",
                    publishedAt: "2026-08-01T09:00:00.000Z",
                  },
                ],
              },
            },
          ),
          ...problemResponses({
            500: "Internal error (`internal_error`) — the announcements collection could not be read. There is no partial archive: either the whole list comes back or this does. Serve your cached copy and retry with backoff.",
          }),
        },
      },
    },

    [`${prefix}/announcements/active`]: {
      get: {
        summary: "Get the single announcement to show right now",
        description:
          "Return the one announcement that is live at this instant, or `null`. 'Live' means `enabled === true` and now falls inside `[startsAt, endsAt)` — both bounds are optional, and a null bound is open on that side. When several qualify, the most recently **created** one wins, which is how an admin supersedes a live notice: create a newer enabled one rather than editing the old. **Public and unauthenticated.** Designed for a landing-page popup, so treat `null` as the normal case, not an error — it simply means nothing is scheduled right now. Unlike `GET /announcements` this respects `endsAt`, so an expired notice disappears here while remaining in the archive. Response field `active` is nullable; the surrounding `{ data, error }` envelope is still present, so the empty case is `{ \"data\": { \"active\": null }, \"error\": null }`.",
        operationId: "getActiveAnnouncement",
        tags: ["Announcements"],
        security: publicAuth(),
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["active"],
              properties: {
                active: {
                  oneOf: [publicAnnouncementSchema, { type: "null" }],
                  description:
                    "The live announcement, or `null` when none qualifies. `null` is an expected, non-exceptional result.",
                },
              },
            },
            "The currently live announcement, if any.",
            {
              example: {
                active: {
                  id: "b1e5f0d2-7c3a-4f8b-9d61-2a0c4e7f5b93",
                  titleEn: "Skillsets are now in public beta",
                  titleZh: "技能集公测上线",
                  bodyMarkdownEn: "Compose several skills into one installable bundle.",
                  bodyMarkdownZh: "将多个技能组合为一个可安装的包。",
                  ctaLabelEn: "Read the docs",
                  ctaLabelZh: null,
                  ctaUrl: "https://example.com/docs/skillsets",
                },
              },
            },
          ),
          ...problemResponses({
            500: "Internal error (`internal_error`) — the active-announcement lookup failed. Distinct from the empty case: `null` inside a 200 means nothing is scheduled, this means the question could not be answered. Render no popup and retry with backoff.",
          }),
        },
      },
    },

    [`${prefix}/admin/announcements`]: {
      get: {
        summary: "List every announcement (admin)",
        description:
          "Return all announcements — enabled and disabled, scheduled, live, and expired — newest first, with the scheduling and audit fields the public endpoints strip (`enabled`, `startsAt`, `endsAt`, `createdBy`, `createdAt`, `updatedAt`). This is the admin table; use it to audit what is scheduled and to find the id to PATCH or DELETE. Requires the `ornn:admin:skill` permission scope on the caller's NyxID token — check `permissions` from `GET /me` before calling rather than probing for a 403. No pagination and no filtering: the whole collection comes back, which is fine at the cardinality this surface is designed for (well under a thousand rows).",
        operationId: "adminListAnnouncements",
        tags: ["Announcements", "Admin"],
        security: bearerAuth(),
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["items"],
              properties: {
                items: {
                  type: "array",
                  items: adminAnnouncementSchema,
                  description: "Every announcement, ordered by `createdAt` descending. Empty when none exist.",
                },
              },
            },
            "Every announcement, with scheduling and audit fields.",
            {
              example: {
                items: [
                  {
                    id: "b1e5f0d2-7c3a-4f8b-9d61-2a0c4e7f5b93",
                    titleEn: "Scheduled maintenance",
                    titleZh: "计划维护",
                    bodyMarkdownEn: "The registry will be read-only on **Sunday 03:00–04:00 UTC**.",
                    bodyMarkdownZh: "注册表将于 **周日 03:00–04:00 UTC** 进入只读状态。",
                    ctaLabelEn: "Status page",
                    ctaLabelZh: "状态页",
                    ctaUrl: "https://example.com/status",
                    enabled: true,
                    startsAt: "2026-08-10T09:00:00.000Z",
                    endsAt: "2026-08-24T09:00:00.000Z",
                    createdBy: "usr_01HXYZ2K3M4N5P6Q7R8S9T",
                    createdAt: "2026-08-07T08:00:00.000Z",
                    updatedAt: "2026-08-07T08:00:00.000Z",
                  },
                  {
                    id: "4d2a9f61-8b30-4c7e-a5f2-6e1b0c3d9a47",
                    titleEn: "Skillsets are now in public beta",
                    titleZh: "",
                    bodyMarkdownEn: "Compose several skills into one installable bundle.",
                    bodyMarkdownZh: "",
                    ctaLabelEn: null,
                    ctaLabelZh: null,
                    ctaUrl: null,
                    enabled: false,
                    startsAt: null,
                    endsAt: null,
                    createdBy: "usr_01HXYZ2K3M4N5P6Q7R8S9T",
                    createdAt: "2026-08-01T09:00:00.000Z",
                    updatedAt: "2026-08-03T11:22:05.310Z",
                  },
                ],
              },
            },
          ),
          ...problemResponses(401, {
            403: "Forbidden (`forbidden`) — the caller is authenticated but their token does not carry the `ornn:admin:skill` permission scope.",
            500: "Internal error (`internal_error`) — the announcements collection could not be read. Nothing was mutated; retry with backoff.",
          }),
        },
      },
      post: {
        summary: "Create an announcement (admin)",
        description:
          "Create a site-wide announcement for the landing popup and the News archive. Requires the `ornn:admin:skill` permission scope. `enabled` is required and has no default, so a draft is created with `enabled: false` and flipped later via PATCH. Scheduling is optional on both sides: omit `startsAt` for 'live immediately', omit `endsAt` for open-ended; when both are set `endsAt` must be strictly after `startsAt`. Creating a second enabled, in-window announcement does not conflict — `GET /announcements/active` simply serves the newest, which is the supported way to supersede a live notice. The response is the full admin shape and `Location` points at the collection-scoped URL for the new record. Announcements are **not** delivered to anyone's inbox; if you want a message in users' notification feeds, create a broadcast (`POST /admin/broadcasts`) instead.",
        operationId: "adminCreateAnnouncement",
        tags: ["Announcements", "Admin"],
        security: bearerAuth(),
        requestBody: jsonBody(announcementCreateBody, "The announcement to create.", {
          example: {
            titleEn: "Scheduled maintenance",
            titleZh: "计划维护",
            bodyMarkdownEn: "The registry will be read-only on **Sunday 03:00–04:00 UTC**.",
            bodyMarkdownZh: "注册表将于 **周日 03:00–04:00 UTC** 进入只读状态。",
            ctaLabelEn: "Status page",
            ctaLabelZh: "状态页",
            ctaUrl: "https://example.com/status",
            enabled: true,
            startsAt: "2026-08-10T09:00:00Z",
            endsAt: "2026-08-24T09:00:00Z",
          },
        }),
        responses: {
          ...jsonResponse(adminAnnouncementSchema, "The announcement was created.", {
            status: 201,
            headers: {
              Location: {
                description:
                  "URL of the created announcement, e.g. `/api/v1/admin/announcements/b1e5f0d2-7c3a-4f8b-9d61-2a0c4e7f5b93`. Note this path only accepts PATCH and DELETE — there is no single-announcement GET.",
                schema: { type: "string" },
              },
            },
            // The request-body example above, as it comes back: server-assigned
            // `id` / `createdBy` / timestamps, and the window bounds re-serialised
            // with milliseconds.
            example: {
              id: "b1e5f0d2-7c3a-4f8b-9d61-2a0c4e7f5b93",
              titleEn: "Scheduled maintenance",
              titleZh: "计划维护",
              bodyMarkdownEn: "The registry will be read-only on **Sunday 03:00–04:00 UTC**.",
              bodyMarkdownZh: "注册表将于 **周日 03:00–04:00 UTC** 进入只读状态。",
              ctaLabelEn: "Status page",
              ctaLabelZh: "状态页",
              ctaUrl: "https://example.com/status",
              enabled: true,
              startsAt: "2026-08-10T09:00:00.000Z",
              endsAt: "2026-08-24T09:00:00.000Z",
              createdBy: "usr_01HXYZ2K3M4N5P6Q7R8S9T",
              createdAt: "2026-08-07T08:00:00.000Z",
              updatedAt: "2026-08-07T08:00:00.000Z",
            },
          }),
          ...problemResponses(
            {
              400: "Bad request — either `invalid_announcement_input` (body is not valid JSON, a required field is missing, a length cap is exceeded, `ctaUrl` is not a URL, a timestamp is not ISO-8601 with a `Z`/offset, or the `ctaLabelEn`/`ctaUrl` both-or-neither rule was broken; `detail` names the field) or `INVALID_ANNOUNCEMENT_WINDOW` (`endsAt` is not strictly after `startsAt`). Nothing is created in either case.",
            },
            401,
            {
              403: "Forbidden (`forbidden`) — the token lacks the `ornn:admin:skill` permission scope.",
              500: "Internal error (`internal_error`) — the insert failed. No announcement was created, so retrying is safe; there is no idempotency key, so confirm with `GET /admin/announcements` if you are unsure whether the write landed.",
            },
          ),
        },
      },
    },

    [`${prefix}/admin/announcements/{id}`]: {
      patch: {
        summary: "Update an announcement (admin)",
        description:
          "Sparsely update an existing announcement — content, CTA, `enabled`, or the schedule window. Requires the `ornn:admin:skill` permission scope. Only the fields you send are written; everything else keeps its stored value, and the record's `updatedAt` moves while `createdBy` and `createdAt` never do. Two validation subtleties matter: the `startsAt < endsAt` ordering check is evaluated against the **merged** result (the bound you did not send is read from storage), whereas the `ctaLabelEn`/`ctaUrl` both-or-neither check is evaluated against the **patch payload alone** — so to change just the CTA URL you must resend the label too. An empty patch is rejected rather than treated as a no-op. Flipping `enabled` to `false` is the retraction path: it hides the announcement from both public endpoints immediately while preserving it for later re-enable, which DELETE cannot do. There is no single-announcement GET; read it back from `GET /admin/announcements` or from this response.",
        operationId: "adminUpdateAnnouncement",
        tags: ["Announcements", "Admin"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "id",
            "Announcement id (UUID v4) as reported by `GET /admin/announcements` or by the create response's `id`.",
            { type: "string", format: "uuid" },
            "b1e5f0d2-7c3a-4f8b-9d61-2a0c4e7f5b93",
          ),
        ],
        requestBody: jsonBody(announcementUpdateBody, "Fields to change. At least one is required.", {
          example: { enabled: false, endsAt: "2026-08-20T09:00:00Z" },
        }),
        responses: {
          ...jsonResponse(adminAnnouncementSchema, "The announcement after the patch was applied.", {
            // Result of the request example above: `enabled` and `endsAt` moved,
            // every unsent field kept its stored value, `updatedAt` advanced while
            // `createdBy` / `createdAt` did not.
            example: {
              id: "b1e5f0d2-7c3a-4f8b-9d61-2a0c4e7f5b93",
              titleEn: "Scheduled maintenance",
              titleZh: "计划维护",
              bodyMarkdownEn: "The registry will be read-only on **Sunday 03:00–04:00 UTC**.",
              bodyMarkdownZh: "注册表将于 **周日 03:00–04:00 UTC** 进入只读状态。",
              ctaLabelEn: "Status page",
              ctaLabelZh: "状态页",
              ctaUrl: "https://example.com/status",
              enabled: false,
              startsAt: "2026-08-10T09:00:00.000Z",
              endsAt: "2026-08-20T09:00:00.000Z",
              createdBy: "usr_01HXYZ2K3M4N5P6Q7R8S9T",
              createdAt: "2026-08-07T08:00:00.000Z",
              updatedAt: "2026-08-09T14:05:37.118Z",
            },
          }),
          ...problemResponses(
            {
              400: "Bad request — `invalid_announcement_input` when the body is not valid JSON, carries no fields at all (detail `No fields to update`), fails a field rule, or breaks the `ctaLabelEn`/`ctaUrl` pairing rule for the payload; `INVALID_ANNOUNCEMENT_WINDOW` when the resulting `endsAt` is not strictly after the resulting `startsAt`. Nothing is written in either case.",
            },
            401,
            {
              403: "Forbidden (`forbidden`) — the token lacks the `ornn:admin:skill` permission scope.",
            },
            {
              404: "Not found (`announcement_not_found`) — no announcement has this id. Note this is also raised before the write when the patch touches `startsAt`/`endsAt`, because the merged-window check has to read the record first.",
              500: "Internal error (`internal_error`) — the patch could not be completed. The write and the read-back are separate round trips, so the change may still have landed; re-read the record from `GET /admin/announcements` before retrying.",
            },
          ),
        },
      },
      delete: {
        summary: "Delete an announcement (admin)",
        description:
          "Permanently remove an announcement. Requires the `ornn:admin:skill` permission scope. This is a hard delete with no soft-delete tier and no undo — the record vanishes from the admin table and from the public archive at once. Prefer `PATCH { \"enabled\": false }` when you only want to take a notice down, since that keeps the content and lets you re-enable it later. Deletion is not idempotent from the caller's point of view: the first call answers 200 with the id, and a repeat answers 404. Nothing cascades — announcements have no per-user state to clean up (unlike broadcasts, whose read receipts are cascaded on delete).",
        operationId: "adminDeleteAnnouncement",
        tags: ["Announcements", "Admin"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "id",
            "Announcement id (UUID v4) to delete.",
            { type: "string", format: "uuid" },
            "b1e5f0d2-7c3a-4f8b-9d61-2a0c4e7f5b93",
          ),
        ],
        responses: {
          ...jsonResponse(deletedIdSchema, "The announcement was deleted.", {
            example: { id: "b1e5f0d2-7c3a-4f8b-9d61-2a0c4e7f5b93" },
          }),
          ...problemResponses(
            401,
            {
              403: "Forbidden (`forbidden`) — the token lacks the `ornn:admin:skill` permission scope.",
            },
            {
              404: "Not found (`announcement_not_found`) — no announcement has this id, or it was already deleted.",
              500: "Internal error (`internal_error`) — the delete could not be performed. The announcement is still stored and still visible wherever it was; retry with backoff.",
            },
          ),
        },
      },
    },

    [`${prefix}/admin/broadcasts`]: {
      get: {
        summary: "List all broadcasts with read statistics (admin)",
        description:
          "Return every broadcast ever authored, newest first, each enriched with `readCount` — the number of distinct users who have read it. Requires the `ornn:admin:skill` permission scope. This doubles as the broadcast history view, which is why audit fields (`createdBy`, `updatedBy`, `createdAt`, `updatedAt`) and the frozen `recipientUserIds` targeting list are all first-class here. Read counts come from one grouped query over the receipts collection regardless of how many rows are returned, so the listing stays cheap. No pagination or filtering. There is no public counterpart — end users see broadcasts only through `GET /notifications`, where they appear as `source: \"broadcast\"` rows.",
        operationId: "adminListBroadcasts",
        tags: ["Notifications", "Admin"],
        security: bearerAuth(),
        responses: {
          ...jsonResponse(
            {
              type: "object",
              required: ["items"],
              properties: {
                items: {
                  type: "array",
                  items: adminBroadcastSchema,
                  description: "Every broadcast, ordered by `createdAt` descending. Empty when none exist.",
                },
              },
            },
            "Every broadcast, with per-message read counts.",
            {
              example: {
                items: [
                  {
                    id: "9c8e1a70-5b2d-4e63-8f0a-1d7c4b6e2905",
                    titleI18n: { en: "Scheduled maintenance", zh: "计划维护" },
                    bodyMarkdownI18n: {
                      en: "The registry will be read-only on **Sunday 03:00–04:00 UTC**.",
                      zh: "注册表将于 **周日 03:00–04:00 UTC** 进入只读状态。",
                    },
                    createdBy: "usr_01HXYZ2K3M4N5P6Q7R8S9T",
                    updatedBy: "usr_01HXYZ2K3M4N5P6Q7R8S9T",
                    recipientUserIds: null,
                    createdAt: "2026-08-07T08:00:00.000Z",
                    updatedAt: "2026-08-07T08:00:00.000Z",
                    readCount: 42,
                  },
                ],
              },
            },
          ),
          ...problemResponses(401, {
            403: "Forbidden (`forbidden`) — the caller is authenticated but their token does not carry the `ornn:admin:skill` permission scope.",
            500: "Internal error (`internal_error`) — the broadcasts collection or the grouped read-count query failed. Nothing was mutated; retry with backoff.",
          }),
        },
      },
      post: {
        summary: "Create a broadcast (admin)",
        description:
          "Author a message that lands in users' notification inboxes. Requires the `ornn:admin:skill` permission scope. Unlike announcements, broadcasts are **delivered**: the moment this returns, every recipient's `GET /notifications` includes a `source: \"broadcast\"` row and their `unread-count` goes up by one. There is no scheduling and no draft state — a broadcast is visible from creation until it is deleted. Both locales of both `titleI18n` and `bodyMarkdownI18n` are required and must be non-empty after trimming; bodies are rendered as Markdown. Targeting is decided **once, here**: omit `recipientUserIds` to reach every user, or pass a non-empty array of NyxID user ids to reach only those. That choice is frozen — PATCH rejects the field outright — because a message cannot be recalled from someone who has already read it. To targeted-out users the broadcast does not exist at all: invisible in the feed and in `unread-count`, and its id 404s on `POST /notifications/{id}/read`. Unknown properties are rejected rather than ignored, so a typo'd field name is a 400 rather than a silent no-op. Not idempotent — a retry after a lost response creates a second broadcast; check `GET /admin/broadcasts` first.",
        operationId: "adminCreateBroadcast",
        tags: ["Notifications", "Admin"],
        security: bearerAuth(),
        requestBody: jsonBody(
          createBroadcastSchema,
          "The broadcast to author. Generated from `createBroadcastSchema` in `domains/broadcasts/schemas.ts`, which is the runtime validator. The object is strict: unknown keys are rejected. Strings are trimmed before the non-empty check, so `\"   \"` is rejected.",
          {
            example: {
              titleI18n: { en: "Scheduled maintenance", zh: "计划维护" },
              bodyMarkdownI18n: {
                en: "The registry will be read-only on **Sunday 03:00–04:00 UTC**.",
                zh: "注册表将于 **周日 03:00–04:00 UTC** 进入只读状态。",
              },
              recipientUserIds: ["usr_01HXYZ2K3M4N5P6Q7R8S9T"],
            },
          },
        ),
        responses: {
          ...jsonResponse(adminBroadcastSchema, "The broadcast was created and is immediately visible to its recipients.", {
            status: 201,
            headers: {
              Location: {
                description:
                  "URL of the created broadcast, e.g. `/api/v1/admin/broadcasts/9c8e1a70-5b2d-4e63-8f0a-1d7c4b6e2905`. That path accepts PATCH and DELETE only — there is no single-broadcast GET.",
                schema: { type: "string" },
              },
            },
            // The request-body example above, as it comes back. Note the three
            // server-derived facts: `readCount` starts at 0, `updatedBy` and
            // `updatedAt` are seeded from the create, and `recipientUserIds` is
            // echoed as an array (it would be `null` had the field been omitted).
            example: {
              id: "9c8e1a70-5b2d-4e63-8f0a-1d7c4b6e2905",
              titleI18n: { en: "Scheduled maintenance", zh: "计划维护" },
              bodyMarkdownI18n: {
                en: "The registry will be read-only on **Sunday 03:00–04:00 UTC**.",
                zh: "注册表将于 **周日 03:00–04:00 UTC** 进入只读状态。",
              },
              createdBy: "usr_01HADM7N4K2P8Q6R3S1T9V",
              updatedBy: "usr_01HADM7N4K2P8Q6R3S1T9V",
              recipientUserIds: ["usr_01HXYZ2K3M4N5P6Q7R8S9T"],
              createdAt: "2026-08-07T08:00:00.000Z",
              updatedAt: "2026-08-07T08:00:00.000Z",
              readCount: 0,
            },
          }),
          ...problemResponses(
            {
              400: "Bad request (`invalid_broadcast_input`) — the body is not valid JSON, a locale is missing or blank after trimming, a length cap is exceeded (200 chars per title locale, 20 000 per body locale), `recipientUserIds` is `null`/empty/contains an empty string, or an unknown property was sent. `detail` names the offending path.",
            },
            401,
            {
              403: "Forbidden (`forbidden`) — the token lacks the `ornn:admin:skill` permission scope.",
              500: "Internal error (`internal_error`) — the insert failed. No broadcast was created and no inbox was touched, so retrying is safe; there is no idempotency key, so check `GET /admin/broadcasts` first if you are unsure whether the write landed.",
            },
          ),
        },
      },
    },

    [`${prefix}/admin/broadcasts/{id}`]: {
      patch: {
        summary: "Edit a broadcast's content (admin)",
        description:
          "Correct the text of an already-delivered broadcast. Requires the `ornn:admin:skill` permission scope. Recipients see the new content the next time they load their feed — there is no versioning and no 'edited' marker, and the message keeps its original `createdAt`, so it does not jump to the top of anyone's inbox. **Content only**: `recipientUserIds` is immutable and sending it is a 400, since targeting cannot be widened or narrowed after delivery. Read receipts are untouched — editing does **not** mark the message unread again, so anyone who already read it will not see the correction highlighted. The patch must change something: send at least one of `titleI18n` / `bodyMarkdownI18n`, and any i18n object you send must carry at least one locale (`titleI18n: {}` is rejected). Within an i18n object each locale is independently optional but must be non-empty when present — a locale cannot be blanked, only replaced, because both locales are required at rest. `updatedBy` and `updatedAt` are stamped from the calling admin.",
        operationId: "adminUpdateBroadcast",
        tags: ["Notifications", "Admin"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "id",
            "Broadcast id (UUID v4) as reported by `GET /admin/broadcasts` or by the create response's `id`. This is the same id recipients see as `_id` on their feed rows.",
            { type: "string", format: "uuid" },
            "9c8e1a70-5b2d-4e63-8f0a-1d7c4b6e2905",
          ),
        ],
        requestBody: jsonBody(
          patchBroadcastSchema,
          "Content changes. Generated from `patchBroadcastSchema` in `domains/broadcasts/schemas.ts`. Two cross-field rules the JSON Schema cannot express are enforced at runtime and surface as 400: the patch must contain at least one of `titleI18n` / `bodyMarkdownI18n`, and a supplied i18n object must contain at least one locale.",
          {
            example: {
              bodyMarkdownI18n: {
                en: "Correction: the read-only window is **Sunday 04:00–05:00 UTC**.",
                zh: "更正：只读窗口为 **周日 04:00–05:00 UTC**。",
              },
            },
          },
        ),
        responses: {
          ...jsonResponse(adminBroadcastSchema, "The broadcast after the edit, with its current `readCount`.", {
            // The broadcast created in the example above, after the patch in the
            // request example: only the body changed. `titleI18n`, `createdBy`,
            // `createdAt`, and the frozen `recipientUserIds` are untouched;
            // `updatedBy` is now the editing admin; `readCount` carries over
            // because an edit does not clear read receipts.
            example: {
              id: "9c8e1a70-5b2d-4e63-8f0a-1d7c4b6e2905",
              titleI18n: { en: "Scheduled maintenance", zh: "计划维护" },
              bodyMarkdownI18n: {
                en: "Correction: the read-only window is **Sunday 04:00–05:00 UTC**.",
                zh: "更正：只读窗口为 **周日 04:00–05:00 UTC**。",
              },
              createdBy: "usr_01HADM7N4K2P8Q6R3S1T9V",
              updatedBy: "usr_01HADM2C5F8J1L4N7Q0S3V",
              recipientUserIds: ["usr_01HXYZ2K3M4N5P6Q7R8S9T"],
              createdAt: "2026-08-07T08:00:00.000Z",
              updatedAt: "2026-08-07T10:31:52.706Z",
              // The single targeted recipient has already read it — receipts
              // survive the edit, so this stays 1 rather than resetting to 0.
              readCount: 1,
            },
          }),
          ...problemResponses(
            {
              400: "Bad request (`invalid_broadcast_input`) — the body is not valid JSON, contains neither `titleI18n` nor `bodyMarkdownI18n`, contains an i18n object with no locale, contains a blank or over-long locale string, or contains an unknown property. Sending `recipientUserIds` lands here too: the schema is strict and targeting is immutable after create.",
            },
            401,
            {
              403: "Forbidden (`forbidden`) — the token lacks the `ornn:admin:skill` permission scope.",
            },
            {
              404: "Not found (`broadcast_not_found`) — no broadcast has this id.",
              500: "Internal error (`internal_error`) — the edit could not be completed. The content write and the read-count query are separate round trips, so the new text may already be live in recipients' feeds; re-read the row from `GET /admin/broadcasts` before retrying.",
            },
          ),
        },
      },
      delete: {
        summary: "Delete a broadcast and cascade its read receipts (admin)",
        description:
          "Permanently remove a broadcast. Requires the `ornn:admin:skill` permission scope. This is the only way to retract an inbox message — there is no disable flag as there is for announcements. The message disappears from every recipient's feed and stops counting toward their `unread-count`; anyone who had not read it effectively never sees it. Hard delete with cascade: the broadcast row is removed first (so a user racing a `mark-read` cannot insert a fresh orphan receipt), then its read receipts are cleaned up. The cascade is best-effort — if receipt cleanup fails after the broadcast is gone, the operation still returns 200 and the failure is logged server-side, because orphan receipts are inert (no broadcast means they are never surfaced) and the user-visible delete genuinely succeeded. Not idempotent from the caller's view: the first call answers 200, a repeat answers 404.",
        operationId: "adminDeleteBroadcast",
        tags: ["Notifications", "Admin"],
        security: bearerAuth(),
        parameters: [
          pathParam(
            "id",
            "Broadcast id (UUID v4) to delete.",
            { type: "string", format: "uuid" },
            "9c8e1a70-5b2d-4e63-8f0a-1d7c4b6e2905",
          ),
        ],
        responses: {
          ...jsonResponse(deletedIdSchema, "The broadcast was deleted; its read receipts were cascaded on a best-effort basis.", {
            example: { id: "9c8e1a70-5b2d-4e63-8f0a-1d7c4b6e2905" },
          }),
          ...problemResponses(
            401,
            {
              403: "Forbidden (`forbidden`) — the token lacks the `ornn:admin:skill` permission scope.",
            },
            {
              404: "Not found (`broadcast_not_found`) — no broadcast has this id, or it was already deleted.",
              500: "Internal error (`internal_error`) — the broadcast row itself could not be deleted, so the message is still in every recipient's feed. A failing receipt cascade is never the cause: that failure is logged and swallowed, and the call still answers 200.",
            },
          ),
        },
      },
    },
  };
}
