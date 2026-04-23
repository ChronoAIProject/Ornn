/**
 * Skill format rules and validation routes.
 * GET  /api/skill-format/rules    — public, returns format rules markdown
 * POST /api/skill-format/validate — authenticated, validates ZIP against rules
 * @module domains/skills/format/routes
 */

import { Hono } from "hono";
import type { SkillService } from "../crud/service";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../../middleware/nyxidAuth";
import { AppError } from "../../../shared/types/index";

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
- **description** (string, required): must be under 1024 characters. Must not contain XML tags (\`<\` or \`>\`).
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

### Optional Frontmatter Fields

- **license** (string, optional): e.g. \`MIT\`, \`Apache-2.0\`.
- **compatibility** (string, optional): must be under 500 characters.
`;

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
        throw AppError.badRequest("INVALID_CONTENT_TYPE", "Expected application/zip content type");
      }

      const body = await c.req.arrayBuffer();
      if (!body || body.byteLength === 0) {
        throw AppError.badRequest("EMPTY_BODY", "Request body is empty");
      }

      const zipBuffer = new Uint8Array(body);

      // Use the service's validation which applies Zod schema validation
      try {
        await (skillService as any).validateZipFormat(zipBuffer);
        return c.json({ data: { valid: true }, error: null });
      } catch (err: any) {
        if (err?.code === "VALIDATION_FAILED" || err?.code === "FRONTMATTER_VALIDATION_FAILED") {
          return c.json({
            data: { valid: false, violations: [{ rule: err.code, message: err.message }] },
            error: null,
          });
        }
        // If it's a validation-related error, format it
        return c.json({
          data: { valid: false, violations: [{ rule: "unknown", message: err?.message ?? "Validation failed" }] },
          error: null,
        });
      }
    },
  );

  return app;
}
