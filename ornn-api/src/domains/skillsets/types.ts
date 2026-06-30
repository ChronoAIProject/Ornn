/**
 * Types + Zod schemas for the skillsets domain (#969).
 *
 * A **skillset** is a named, versioned, owned, visibility-scoped
 * meta-package that references N member skills and carries a `kind`. One
 * call resolves + delivers the whole set — including each member's
 * dependency closure from #968.
 *
 * The ownership / visibility model is mirrored VERBATIM from
 * `SkillDocument` (`isPrivate` / `sharedWithUsers` / `sharedWithOrgs` /
 * `createdBy`) so the shared `scopeFilter.ts` predicates + `authorize.ts`
 * gates apply unchanged — a skillset's read/write policy can never drift
 * from a skill's.
 *
 * Versions are append-only and immutable (`_id = guid@version`), exactly
 * like `skill_versions`, but a skillset version carries NO blob /
 * skillHash / storage key / AgentSeal record — a skillset is pure
 * metadata (a list of member refs). The members themselves are concrete
 * skill packages resolved at closure time.
 *
 * @module domains/skillsets/types
 */

import { z } from "zod";
import type { SkillGrant } from "../../shared/types/index";
import {
  DEPENDS_ON_REF_REGEX,
  SKILL_NAME_REGEX,
  SKILL_NAME_MAX,
} from "../../shared/schemas/skillFrontmatter";

/**
 * The revision a freshly created skillset starts at (#1162). A skillset's
 * version is no longer owner-typed — it is a single system-managed revision in
 * `<major>.<minor>` shape, auto-bumped on the minor on every qualifying change
 * (owner edit OR a member skill's resolved version moving). Major never
 * auto-bumps.
 */
export const SKILLSET_INITIAL_REVISION = "1.0";

/**
 * Skillset kind (#969). v1 enumerates `generic` (a plain curated bundle)
 * and `consensus-supported` (an author CLAIM that the members are an
 * independent, comparable set suitable for agent-side consensus — not a
 * guarantee; see docs). Extensible: future kinds append here.
 *
 * `generic` is the DEFAULT kind — a skillset with no asserted typing is a
 * plain bundle, NOT a consensus set.
 */
export const SKILLSET_KINDS = ["generic", "consensus-supported"] as const;
export type SkillsetKind = (typeof SKILLSET_KINDS)[number];

/** Lower bound on members — a one-member "set" is just a skill. */
export const SKILLSET_MIN_MEMBERS = 2;

/**
 * Minimum number of PUBLIC, resolvable members a skillset must have to export
 * (or keep exporting) as a public Claude Code plugin (#1161). The plugin bundles
 * only the public-member subset; below this floor the bundle is too thin to be a
 * meaningful "set", so export is refused / the plugin is removed. Distinct from
 * {@link SKILLSET_MIN_MEMBERS} (which bounds the curated set itself, public or
 * not) even though both currently equal 2.
 */
export const SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS = 2;
/**
 * Upper bound on members. Generous: a curated comparison set is rarely
 * more than a handful, but a large fleet bundle is legitimate. Guards
 * against a pathological publish, mirroring the depends-on cap (50).
 */
export const SKILLSET_MAX_MEMBERS = 100;

/**
 * A member ref points at ONE skill, by the SAME grammar skill
 * dependencies use (`<name-or-guid>@<major.minor>` or `<name>@<dist-tag>`).
 * Reusing {@link DEPENDS_ON_REF_REGEX} guarantees a skillset member can
 * never accept a shape the dependency closure can't resolve — both walk
 * the exact same graph via the shared loader.
 *
 * Nested-skillset rejection (#969 non-goal): a skillset references SKILLS,
 * not other skillsets. There's no syntactic difference between a skill ref
 * and a (hypothetical) skillset ref, so we reject the one explicit way an
 * author might try to nest — a `skillset:`-prefixed ref — with a clear
 * message. (A bare name that happens to be a skillset's name is caught at
 * publish time: the member loader resolves against the SKILLS collection
 * only, so it surfaces as `skill_dependency_not_found`.)
 */
const SKILLSET_REF_PREFIX = "skillset:";

const memberRefSchema = z
  .string({
    error: (issue) =>
      issue.code === "invalid_type"
        ? "skillset members must be non-empty strings of the form `<name-or-guid>@<major.minor>` or `<name>@<dist-tag>`, e.g. `pdf-tools@1.0`."
        : undefined,
  })
  .min(1, "member refs must not be empty")
  .max(115, "member refs must be at most 115 characters")
  .refine((ref) => !ref.startsWith(SKILLSET_REF_PREFIX), {
    message:
      "A skillset cannot reference another skillset — members are skills only (no nested skillsets in v1). Remove the `skillset:` prefix.",
  })
  .refine((ref) => DEPENDS_ON_REF_REGEX.test(ref), {
    message:
      "member refs must be `<name-or-guid>@<major.minor>` or `<name>@<dist-tag>` (no semver ranges like ^1.0 or 1.2.3)",
  });

/** Upper bound on the master-prompt body. Generous — a master prompt is a
 * full set of usage instructions for agents (HOW to use the set), not a
 * one-line blurb. 8 KB comfortably holds a structured prompt while still
 * guarding against a pathological multi-megabyte publish. Deliberately far
 * larger than `description`'s 1024 (a short human-readable summary). */
export const SKILLSET_INSTRUCTIONS_MAX = 8000;

/**
 * The skillset **master prompt** (#978) — a REQUIRED markdown body telling
 * an agent HOW to use the set (orchestration, ordering, when to pick which
 * member). Stored opaque (no rendering / sanitization / templating /
 * linting / search-indexing) and surfaced verbatim on detail + closure.
 *
 * Trimmed-then-bounded so leading/trailing whitespace never satisfies the
 * non-empty requirement: a whitespace-only body trims to `""` and fails
 * `.min(1)`. Distinct from `description` (short summary, 1024) — this is the
 * long-form operating manual.
 *
 * REQUIRED on BOTH create and publish with NO carry-forward: each version
 * explicitly carries its own prompt (unlike `description`, which a publish
 * may omit to inherit the prior value).
 */
export const instructionsSchema = z
  .string()
  .trim()
  .min(1, "instructions (master prompt) must not be empty")
  .max(
    SKILLSET_INSTRUCTIONS_MAX,
    `instructions (master prompt) must be at most ${SKILLSET_INSTRUCTIONS_MAX} characters`,
  );

/**
 * Body schema for `POST /skillsets` (create). The system assigns the first
 * revision ({@link SKILLSET_INITIAL_REVISION}) — there is NO owner-typed
 * `version` (#1162); the revision auto-advances thereafter.
 */
export const createSkillsetSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(SKILL_NAME_MAX)
    .regex(SKILL_NAME_REGEX, "Name must be kebab-case"),
  description: z.string().min(1).max(1024),
  /** Master prompt (#978) — REQUIRED, no carry-forward. */
  instructions: instructionsSchema,
  kind: z.enum(SKILLSET_KINDS).default("generic"),
  tags: z.array(z.string().min(1).max(30).regex(/^[a-z0-9-]+$/)).max(20).default([]),
  members: z
    .array(memberRefSchema)
    .min(SKILLSET_MIN_MEMBERS, `a skillset must have at least ${SKILLSET_MIN_MEMBERS} members`)
    .max(SKILLSET_MAX_MEMBERS, `a skillset may have at most ${SKILLSET_MAX_MEMBERS} members`),
});

/**
 * Body schema for `PUT /skillsets/:id` (publish a new immutable version).
 * `name` is fixed after create — a publish only revises the curated set, its
 * description, kind, and tags. The new revision is system-assigned (the minor
 * auto-bumps, #1162); the owner never types a `version`.
 */
export const publishSkillsetSchema = z.object({
  description: z.string().min(1).max(1024).optional(),
  /**
   * Master prompt (#978) — REQUIRED on publish too, with NO carry-forward.
   * Unlike `description` (optional here; inherits the prior value when
   * omitted), every published version explicitly states its own prompt.
   */
  instructions: instructionsSchema,
  kind: z.enum(SKILLSET_KINDS).optional(),
  tags: z.array(z.string().min(1).max(30).regex(/^[a-z0-9-]+$/)).max(20).optional(),
  members: z
    .array(memberRefSchema)
    .min(SKILLSET_MIN_MEMBERS, `a skillset must have at least ${SKILLSET_MIN_MEMBERS} members`)
    .max(SKILLSET_MAX_MEMBERS, `a skillset may have at most ${SKILLSET_MAX_MEMBERS} members`),
});

// NOTE (#1136): no skillset permissions schema — a skillset's visibility is
// derived from its members, not owner-set, so there is no permissions
// endpoint to validate a body for.

/**
 * Kebab-case keyword/tag, matching the skillset `tags` grammar — reused for the
 * plugin-export `keywords` override (#1157).
 */
const pluginKeywordSchema = z.string().min(1).max(30).regex(/^[a-z0-9-]+$/);

/**
 * Body for `PUT /skillsets/:id/plugin-export` (#1157). The owner toggles plugin
 * export ON/OFF and may supply optional listing overrides. Each override
 * defaults from the skillset (displayName←name, description, keywords←tags) when
 * omitted — surfaced verbatim in the generated plugin.json + marketplace entry.
 *
 * Deliberately NOT overridable: the install NAME (= skillset name, the
 * collision-free `/plugin install <name>@<repo>` handle) and the plugin VERSION
 * (the auto-managed skillset revision that drives Claude Code's update signal,
 * #1162).
 */
export const pluginExportSchema = z.object({
  enabled: z.boolean(),
  displayName: z.string().min(1).max(64).optional(),
  description: z.string().min(1).max(1024).optional(),
  keywords: z.array(pluginKeywordSchema).max(20).optional(),
});

export type CreateSkillsetInput = z.infer<typeof createSkillsetSchema>;
export type PublishSkillsetInput = z.infer<typeof publishSkillsetSchema>;
export type PluginExportInput = z.infer<typeof pluginExportSchema>;

/**
 * Owner-customizable plugin listing fields (#1157). Each is OPTIONAL and, when
 * set, overrides the corresponding skillset-derived default in the exported
 * Claude Code plugin's `plugin.json` + marketplace entry. An absent field falls
 * back to the skillset (displayName←name, description, keywords←tags). Persisted
 * on the identity doc only when the owner exports with overrides.
 */
export interface SkillsetPluginOverrides {
  displayName?: string | undefined;
  description?: string | undefined;
  keywords?: string[] | undefined;
}

/**
 * Persisted skillset identity document (the `skillsets` collection).
 * Visibility fields mirror `SkillDocument` verbatim so `scopeFilter` +
 * `authorize` apply unchanged. `latestVersion` points at the highest
 * published version; the `skillset_versions` collection is the source of
 * truth for the immutable history.
 */
export interface SkillsetDocument {
  guid: string;
  name: string;
  description: string;
  kind: SkillsetKind;
  tags: string[];
  /** Author (person user_id). Mirrors `SkillDocument.createdBy`. */
  createdBy: string;
  // Optionals widen to `T | undefined` for exactOptionalPropertyTypes (#657).
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
  createdOn: Date;
  updatedBy: string;
  updatedOn: Date;
  /** False = public; true = private with the shared-with lists as allow-list. */
  isPrivate: boolean;
  /** Explicit per-user grants (NyxID person user_ids). */
  sharedWithUsers: string[];
  /** Explicit per-org grants (NyxID org user_ids). */
  sharedWithOrgs: string[];
  /**
   * Typed access grants (#1123) — canonical read/write ACL, mirroring
   * `SkillDocument.grants`. Optional for back-compat; readers fall back to
   * deriving read grants from the legacy lists via `effectiveGrants`.
   *
   * @deprecated (#1136) Skillset visibility is now DERIVED from its members
   * (see `memberVisibilityState`), not owner-set. `isPrivate` / `sharedWith*`
   * / `grants` on a skillset are inert — kept for rollback; no longer the
   * authority for who-can-read.
   */
  grants?: SkillGrant[] | undefined;
  /**
   * Derived (#1136) — `true` iff EVERY member skill of the latest version is
   * public. Cheap fast-path for discovery + drives the read-only visibility
   * badge. Computed under SYSTEM_ACTOR, never owner-set; recomputed when a
   * member's visibility or the member list changes. Optional for back-compat
   * (absent ⇒ treated as `true` until the boot backfill runs).
   */
  membersAllPublic?: boolean | undefined;
  /** Derived (#1136) member-visibility state of the latest version. */
  memberVisibilityState?: SkillsetMemberVisibilityState | undefined;
  /**
   * Owner opt-in (#1155) to export this skillset as ONE curated multi-skill
   * Claude Code plugin in the public mirror. Eligibility to actually export =
   * this flag AND the skillset having ≥ {@link SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS}
   * public, resolvable members (#1161) — the export bundles only that public
   * subset, dropping private/unresolvable members, so a "restricted" skillset
   * still exports its public part. Optional for back-compat (absent ⇒ `false`).
   * Default OFF.
   */
  exportAsPlugin?: boolean | undefined;
  /**
   * Owner-customizable plugin listing overrides (#1157). Set ONLY when the
   * owner exported with explicit overrides; absent ⇒ the mirror falls back to
   * the skillset's own name/description/tags. Inert unless `exportAsPlugin`.
   */
  pluginConfig?: SkillsetPluginOverrides | undefined;
  /** Cached pointer to the highest published version, e.g. "1.2". */
  latestVersion: string;
}

/**
 * Member-derived visibility state of a skillset's latest version (#1136):
 * - `all-public`   — every member skill is public; discoverable by everyone.
 * - `restricted`   — ≥1 member is private/shared; discoverable only by callers who can read all members.
 * - `unresolvable` — ≥1 member ref no longer resolves (e.g. deleted); only the owner sees it, with a warning.
 */
export type SkillsetMemberVisibilityState = "all-public" | "restricted" | "unresolvable";

/**
 * Immutable record of one published skillset version (the
 * `skillset_versions` collection). `_id = ${guid}@${version}` gives free
 * uniqueness on (guid, version). Append-only — a published version is
 * never mutated.
 *
 * Deliberately carries NO blob / skillHash / storageKey / AgentSeal — a
 * skillset is pure metadata; the heavy artefacts live on the member skill
 * versions, resolved at closure time.
 */
export interface SkillsetVersionDocument {
  /** `${skillsetGuid}@${version}`. */
  _id: string;
  skillsetGuid: string;
  /** "<major>.<minor>" string, e.g. "1.2". */
  version: string;
  majorVersion: number;
  minorVersion: number;
  kind: SkillsetKind;
  description: string;
  /** Master prompt (#978) — per-version, immutable, surfaced verbatim. */
  instructions: string;
  tags: string[];
  /** Member skill refs (`<name-or-guid>@<major.minor>` or `<name>@<dist-tag>`). */
  members: string[];
  /**
   * Lockfile-like snapshot of the members RESOLVED to concrete versions at the
   * time this revision was cut (#1162) — sorted, de-duped `name@<major.minor>`
   * strings. Makes a revision reproducible even when its authored `members`
   * pin `@latest`/dist-tags, and is the baseline the reactive bump compares
   * against to decide whether a member-version change warrants a new revision.
   * Optional for back-compat: pre-#1162 version docs lack it until the boot
   * backfill populates the latest one.
   */
  resolvedMembers?: string[] | undefined;
  createdBy: string;
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
  createdOn: Date;
}

/** Serialized skillset detail response. */
export interface SkillsetDetailResponse {
  guid: string;
  name: string;
  description: string;
  /** Master prompt (#978) — the per-version usage instructions for agents. */
  instructions: string;
  kind: SkillsetKind;
  tags: string[];
  members: string[];
  version: string;
  latestVersion: string;
  isPrivate: boolean;
  createdBy: string;
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
  sharedWithUsers: string[];
  sharedWithOrgs: string[];
  /** Typed access grants (#1123). Always present in responses via `effectiveGrants`. */
  grants?: SkillGrant[] | undefined;
  /**
   * Derived (#1136) member-visibility state of THIS version's members.
   * Drives the read-only visibility badge. The authoritative skillset
   * visibility — `isPrivate`/`grants` above are inert.
   */
  memberVisibilityState: SkillsetMemberVisibilityState;
  /**
   * Owner opt-in (#1155) to export the skillset as a curated multi-skill
   * Claude Code plugin in the public mirror. Surfaced so the web UI can show
   * the toggle state + the install snippet. Always present (defaults `false`).
   */
  exportAsPlugin: boolean;
  /**
   * Number of THIS version's members whose skill is currently public AND
   * resolvable, counted under SYSTEM (#1161). The export bundles only this
   * public subset; export is available / sustained only while this is
   * ≥ {@link SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS}. The web export card gates on
   * it (and derives the excluded count as `members.length - publicMemberCount`).
   */
  publicMemberCount: number;
  /**
   * Owner-customizable plugin listing overrides (#1157). Surfaced so the web
   * export card can prefill the confirm modal with the current overrides (or
   * fall back to the skillset's own fields when absent).
   */
  pluginConfig?: SkillsetPluginOverrides | undefined;
  /**
   * Member refs the CALLER cannot read at THIS version (#1136). Always
   * empty for a non-owner (they 404 instead of seeing a partial set);
   * surfaced to the owner/admin so they can repair access (re-grant the
   * member skill, or publish a version without it). Request-scoped, not
   * stored.
   */
  unreadableMembers: string[];
  createdOn: string;
  updatedOn: string;
}

/** Search-result item (lighter than the detail response). */
export interface SkillsetSearchItem {
  guid: string;
  name: string;
  description: string;
  kind: SkillsetKind;
  tags: string[];
  memberCount: number;
  latestVersion: string;
  isPrivate: boolean;
  /** Derived (#1136) member-visibility state — drives the badge in lists. */
  memberVisibilityState: SkillsetMemberVisibilityState;
  createdBy: string;
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
  createdOn: string;
  updatedOn: string;
}

export interface SkillsetSearchResponse {
  items: SkillsetSearchItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
