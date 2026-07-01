/**
 * Skill format rules and validation routes.
 * GET  /api/skill-format/rules           — public, returns format rules markdown
 * POST /api/skill-format/validate        — authenticated, validates ZIP against rules
 * GET  /api/skill-manifest-schema.json   — public, JSON Schema for SKILL.md frontmatter (#464)
 * @module domains/skills/format/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import type { SkillService } from "../crud/service";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../../middleware/nyxidAuth";
import { AppError } from "../../../shared/types/index";
import { skillFrontmatterSchema } from "../../../shared/schemas/skillFrontmatter";

/** Canonical skill format rules per the ornn platform spec. Updated with output-type. */
export const SKILL_FORMAT_RULES = `# Ornn Skill Package Format Rules

## Package Structure

- A skill is a package (basically a folder).
- The skill package folder name must be **kebab-case**: no spaces, no underscores, no capitals.
- The package folder must only contain the following items at the root:
  - \`SKILL.md\` (required)
  - \`scripts/\` (optional directory)
  - \`references/\` (optional directory)
  - \`assets/\` (optional directory)
- The folder must **not** include any \`README.md\` at the root. All documentation goes in \`SKILL.md\` or \`references/\`.

## SKILL.md

- \`SKILL.md\` must be present in the root of the skill package folder.
- The filename is **case-sensitive**: it must be exactly \`SKILL.md\`. No variations (\`SKILL.MD\`, \`skill.md\`, etc.) are accepted.

## Frontmatter

- \`SKILL.md\` must have a frontmatter section at the top, starting and ending with \`---\` (triple hyphens).
- The frontmatter section **strictly forbids** XML angle brackets \`<\` and \`>\`.
- The skill name must **not** contain "claude" or "anthropic".

### Required Frontmatter Fields

- **name** (string, required): kebab-case only, must match the skill package folder name. No spaces or capitals.
- **description** (string, required): must be under 1536 characters. Must not contain XML tags (\`<\` or \`>\`).
- **metadata** (object, required): a nested object containing:
  - **category** (string, required): one of \`plain\`, \`tool-based\`, \`runtime-based\`, \`mixed\`.
    - \`plain\`: no programmatic dependency (no tools, no scripts).
    - \`tool-based\`: requires calling tools on the client agent side.
    - \`runtime-based\`: requires executing scripts in a programming language runtime.
    - \`mixed\`: requires both tools and runtime.
  - **output-type** (string): required when category is \`runtime-based\` or \`mixed\`. One of \`text\` or \`file\`.
    - \`text\`: the script outputs text to stdout.
    - \`file\`: the script generates output files.
  - **runtime** (array): required when category is \`runtime-based\` or \`mixed\`. Array of runtime identifier strings.
  - **runtime-dependency** (array, optional): npm package names required by scripts.
  - **runtime-env-var** (array, optional): environment variable names in UPPER_SNAKE_CASE.
  - **tool-list** (array): required when category is \`tool-based\` or \`mixed\`. Array of tool name strings.
  - **tag** (array, optional): array of lowercase kebab-case tags.
  - **depends-on** (array, optional): other skills this skill depends on, max 50. Each entry pins one skill by \`<name-or-guid>@<major.minor>\` (e.g. \`pdf-tools@1.0\`) or \`<name>@<dist-tag>\` (e.g. \`pdf-tools@beta\`). Semver ranges (\`^1.0\`, \`~1.0\`, \`1.2.3\`) are **not** allowed. A skill must not depend on itself. The full transitive closure is validated at publish time (no missing deps, no cycles, no conflicting versions of the same skill) and can be read via \`GET /api/v1/skills/{id}/closure\`.

### Optional Frontmatter Fields

- **license** (string, optional): e.g. \`MIT\`, \`Apache-2.0\`.
- **compatibility** (string, optional): must be under 500 characters.
`;

/**
 * Stable version identifier for the published JSON Schema (#464). Bump
 * this when the frontmatter contract changes in a way external tooling
 * cares about. Embedded in the schema's `$id` so consumers can pin a
 * specific revision and so IDE / linter caches invalidate on bumps.
 */
export const SKILL_MANIFEST_SCHEMA_VERSION = "1";

/**
 * JSON Schema for SKILL.md frontmatter, derived from the canonical Zod
 * schema via zod 4's built-in `z.toJSONSchema()`. Computed once at
 * module load — the source schema is static, so re-running the
 * conversion per request is wasted work.
 *
 * The legacy `zod-to-json-schema` package emits empty schemas against
 * zod 4 (the AST shape changed); the in-tree converter is the only
 * working option until that package catches up. Output is JSON Schema
 * draft-2020-12 — what `z.toJSONSchema` produces and what current IDEs
 * + schemastore.org consume.
 */
export const SKILL_MANIFEST_JSON_SCHEMA = z.toJSONSchema(skillFrontmatterSchema);

export interface FormatRoutesConfig {
  skillService: SkillService;
}

export function createFormatRoutes(config: FormatRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { skillService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const auth = nyxidAuthMiddleware();

  /**
   * GET /skill-format/rules — Public endpoint, no auth required.
   */
  app.get("/skill-format/rules", async (c) => {
    return c.json({ data: { rules: SKILL_FORMAT_RULES }, error: null });
  });

  /**
   * GET /skill-manifest-schema.json — Public, IDE-friendly JSON Schema
   * for `SKILL.md` frontmatter (#464). No auth, long-cacheable: the
   * schema is static for a given build, and IDEs / schemastore.org
   * consumers re-fetch on cache expiry.
   *
   * Content-Type is `application/schema+json` per IANA registration —
   * not the generic `application/json` — so VS Code / Cursor and
   * schema-store tools that sniff the response type pick it up
   * correctly.
   */
  app.get("/skill-manifest-schema.json", async (c) => {
    return c.json(SKILL_MANIFEST_JSON_SCHEMA, 200, {
      "Content-Type": "application/schema+json",
      "Cache-Control": "public, max-age=3600",
    });
  });

  /**
   * POST /skill-format/validate — Authenticated, validates ZIP.
   * Requires: ornn:skill:read
   */
  app.post(
    "/skill-format/validate",
    auth,
    requirePermission("ornn:skill:read"),
    async (c) => {
      const contentType = c.req.header("content-type") ?? "";
      if (!contentType.includes("application/zip") && !contentType.includes("application/octet-stream")) {
        throw AppError.badRequest("invalid_content_type", "Expected application/zip content type");
      }

      const body = await c.req.arrayBuffer();
      if (!body || body.byteLength === 0) {
        throw AppError.badRequest("empty_body", "Request body is empty");
      }

      const zipBuffer = new Uint8Array(body);

      // Zip-bomb defense (#632/#633) — same caps as the publish path. The
      // /skill-format/validate endpoint is authenticated but otherwise
      // unrestricted, so an attacker can still slow us down here with
      // pathological ZIPs unless we cap before extraction. This is a
      // standalone read path (no create/update service seam), so we call
      // the service's public guard, which applies the SAME env-driven caps
      // the ingestion chokepoint uses.
      await skillService.enforceZipLimits(zipBuffer);

      // `validateZipFormat` returns the full list of rule violations.
      // An empty array means the package is valid; anything non-empty is what
      // the client agent needs to fix. Surface the entire list so a single
      // round-trip tells the caller every problem with their package.
      let violations: Array<{ rule: string; message: string }>;
      try {
        violations = await skillService.validateZipFormat(zipBuffer);
      } catch (err: unknown) {
        // Catastrophic failures (e.g., corrupted ZIP) — `validateZipFormat`
        // throws here rather than returning a violations row.
        const message = err instanceof Error ? err.message : "Validation failed";
        return c.json({
          data: { valid: false, violations: [{ rule: "unexpected-error", message }] },
          error: null,
        });
      }

      if (violations.length === 0) {
        return c.json({ data: { valid: true, violations: [] }, error: null });
      }
      return c.json({ data: { valid: false, violations }, error: null });
    },
  );

  return app;
}
