/**
 * Skill Format Rules & Validation Routes.
 * - GET /skill-format/rules — returns skill format rules as markdown (anonymous)
 * - POST /skill-format/validate — validates an uploaded ZIP against all rules (authenticated)
 * @module routes/formatRulesRoutes
 */

import { Hono } from "hono";
import { createAuthMiddleware, AppError, type TokenVerifier } from "../../../shared/types/index";
import type { AuthVariables } from "../../../middleware/nyxidAuth";
import { validateSkillPackageZip } from "../services/skillFormatValidator";

/**
 * The canonical skill format rules per the ornn platform spec.
 * Returned verbatim by the GET /skill-format/rules endpoint.
 */
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
  - **runtimes** (array, required when category is \`runtime-based\` or \`mixed\`): each item is a runtime object with:
    - **runtime** (string, required): name of the runtime, e.g. \`node\` or \`python\`.
    - **dependencies** (array, optional): each item has \`library\` (string) and \`version\` (string).
    - **envs** (array, optional): each item has \`var\` (string, UPPER_SNAKE_CASE) and \`description\` (string).
  - **tools** (array, required when category is \`tool-based\` or \`mixed\`): each item is a tool object with:
    - **tool** (string, required): name of the tool.
    - **type** (string, required): one of \`local\`, \`mcp\`.
    - **mcp-servers** (array, optional, when type is \`mcp\`): each item has \`mcp\` (string) and \`version\` (string).
  - **tags** (array, optional): array of string tags, e.g. \`[text-processing, summarize]\`.

### Optional Frontmatter Fields

- **license** (string, optional): use if making skill open source (e.g. \`MIT\`, \`Apache-2.0\`).
- **compatibility** (string, optional): must be under 500 characters. Describes intended product, required system packages, network access needs, etc.
`;

export function createFormatRulesRoutes(
  tokenService: TokenVerifier,
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  const authMiddleware = createAuthMiddleware(tokenService);

  /**
   * GET /skill-format/rules
   * Anonymous access — returns the skill format rules as markdown text.
   */
  app.get("/skill-format/rules", async (c) => {
    return c.json({
      data: { rules: SKILL_FORMAT_RULES },
      error: null,
    });
  });

  /**
   * POST /skill-format/validate
   * Authenticated — accepts a ZIP file, validates against all format rules.
   * Input: application/zip request body
   * Output: { data: { valid: true/false, violations?: [...] }, error: null }
   */
  app.post("/skill-format/validate", authMiddleware, async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.includes("application/zip") && !contentType.includes("application/octet-stream")) {
      throw AppError.badRequest("INVALID_CONTENT_TYPE", "Expected application/zip content type");
    }

    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0) {
      throw AppError.badRequest("EMPTY_BODY", "Request body is empty");
    }

    const zipBuffer = new Uint8Array(body);
    const violations = await validateSkillPackageZip(zipBuffer);

    if (violations.length === 0) {
      return c.json({
        data: { valid: true },
        error: null,
      });
    }

    return c.json({
      data: { valid: false, violations },
      error: null,
    });
  });

  return app;
}
