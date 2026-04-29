/**
 * Builds the "Install this Ornn skill into my agent" prompt that a user
 * copies from the skill detail page and pastes into their agent (Claude
 * Code, OpenAI Codex CLI, Cursor, custom agents — anything that takes a
 * system / instruction prompt).
 *
 * Goals:
 *  - **Agent-agnostic.** Don't assume Claude-only file layout or
 *    Nyx-only fetch path. List the common runtimes the agent might be
 *    running under and let it pick.
 *  - **Multiple fetch paths.** A connected NyxID CLI is the easiest;
 *    a direct HTTPS GET with a bearer token works too. Public skills can
 *    even be pulled anonymously.
 *  - **Real verification.** Before executing, the agent runs actual
 *    `--version` / `import` / `which` checks instead of trusting metadata.
 *
 * Pure, side-effect-free — trivially unit-testable. No DOM, no window
 * access; the caller passes `ornnOrigin` explicitly.
 */

export interface TrySkillPromptRuntimeDependency {
  library: string;
  version: string;
}

export interface TrySkillPromptRuntime {
  runtime: string;
  dependencies?: TrySkillPromptRuntimeDependency[];
  envs?: Array<{ var: string; description?: string }>;
}

export interface TrySkillPromptTool {
  tool: string;
  type?: string;
}

export interface TrySkillPromptMetadata {
  category?: string;
  runtimes?: TrySkillPromptRuntime[];
  tools?: TrySkillPromptTool[];
}

export interface BuildTrySkillPromptInput {
  guid: string;
  name: string;
  description: string;
  metadata: TrySkillPromptMetadata | Record<string, unknown>;
  /** e.g. `window.location.origin` passed in by the caller. */
  ornnOrigin: string;
}

const NONE = "none";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readRuntimes(metadata: BuildTrySkillPromptInput["metadata"]): TrySkillPromptRuntime[] {
  const raw = (metadata as { runtimes?: unknown }).runtimes;
  return Array.isArray(raw) ? (raw as TrySkillPromptRuntime[]) : [];
}

function readTools(metadata: BuildTrySkillPromptInput["metadata"]): TrySkillPromptTool[] {
  const raw = (metadata as { tools?: unknown }).tools;
  return Array.isArray(raw) ? (raw as TrySkillPromptTool[]) : [];
}

function renderRuntimeList(runtimes: TrySkillPromptRuntime[]): string {
  if (runtimes.length === 0) return "plain (no runtime)";
  return runtimes.map((r) => r.runtime).filter(Boolean).join(", ") || "plain (no runtime)";
}

function renderDependencyList(runtimes: TrySkillPromptRuntime[]): string {
  const flat = runtimes.flatMap((r) => r.dependencies ?? []);
  if (flat.length === 0) return NONE;
  return flat.map((d) => `${d.library}@${d.version}`).join(", ");
}

function renderEnvVarList(runtimes: TrySkillPromptRuntime[]): string {
  const flat = runtimes.flatMap((r) => r.envs ?? []);
  if (flat.length === 0) return NONE;
  return flat.map((e) => e.var).filter(Boolean).join(", ") || NONE;
}

function renderToolList(tools: TrySkillPromptTool[]): string {
  if (tools.length === 0) return NONE;
  return tools.map((t) => t.tool).filter(Boolean).join(", ") || NONE;
}

export function buildTrySkillPrompt(input: BuildTrySkillPromptInput): string {
  const { guid, name, description, metadata, ornnOrigin } = input;
  const category = asString((metadata as { category?: unknown }).category) ?? "plain";
  const runtimes = readRuntimes(metadata);
  const tools = readTools(metadata);

  const runtimeLine = renderRuntimeList(runtimes);
  const depsLine = renderDependencyList(runtimes);
  const envLine = renderEnvVarList(runtimes);
  const toolLine = renderToolList(tools);

  const origin = ornnOrigin.replace(/\/+$/, "");
  const skillUrl = `${origin}/skills/${guid}`;
  const apiUrl = `${origin}/api/v1/skills/${guid}/json`;

  return [
    `# Install Ornn skill: ${name}`,
    "",
    `> ${description}`,
    "",
    "You're being given an Ornn skill — a packaged AI capability",
    "(`SKILL.md` prompt + optional scripts + metadata). Follow the steps",
    "below to fetch it, install it locally if your runtime supports a",
    "skills directory, verify dependencies, and use it.",
    "",
    "## Step 1: Fetch the skill content",
    "",
    `The skill is at \`${apiUrl}\`. Pick whichever fetch path is`,
    "available in your environment:",
    "",
    "**Option A — via NyxID CLI** (if `nyxid` is installed and you've run `nyxid login`):",
    "```",
    `nyxid proxy request ornn-api /api/v1/skills/${guid}/json --output json`,
    "```",
    "",
    "**Option B — direct HTTPS** (if you have a NyxID bearer token):",
    "```",
    `curl -H "Authorization: Bearer $TOKEN" \\`,
    `  "${apiUrl}"`,
    "```",
    "",
    "**Option C — anonymous** (only works if this skill is public):",
    "```",
    `curl "${apiUrl}"`,
    "```",
    "",
    "Response shape:",
    "```",
    "{ name, description, metadata, files: { \"SKILL.md\": \"…\", \"scripts/…\": \"…\", … } }",
    "```",
    "",
    "## Step 2: Install locally (optional but recommended for reuse)",
    "",
    `Ask the user: "Install \`${name}\` locally for future reuse? (y/n)".`,
    "",
    "If yes, write each `files[path]` entry to your platform's local",
    "skills directory, preserving the path structure (`scripts/`,",
    "`references/`, `assets/`). Common per-agent conventions:",
    "",
    `- **Claude Code:** \`~/.claude/skills/${name}/\``,
    `- **OpenAI Codex CLI:** \`~/.codex/skills/${name}/\` if your install`,
    "  uses one, otherwise project-local `skills/<name>/`.",
    `- **Cursor:** workspace \`.cursor/rules/${name}.md\` (paste the SKILL.md body).`,
    "- **Other agents / no skills dir:** keep the `SKILL.md` content in",
    "  your conversation context for the rest of this session.",
    "",
    "If the user said no, skip the write — just hold `SKILL.md` in context.",
    "",
    "**Either way, append a record for this skill to `~/.ornn/installed-skills.json`**",
    "so future sessions (yours or any other agent's) know it's already installed.",
    "The file is a flat JSON array; create it as `[]` if it doesn't exist. Record",
    "shape: `{ name, ornnGuid, installedVersion, installedAt, localPath? }`. If you",
    "later overwrite to a newer version, bump `installedVersion` + `installedAt` in",
    "place. See the `ornn-agent-manual-cli` / `ornn-agent-manual-http` skill, §0.5,",
    "for the full registry contract.",
    "",
    "## Step 3: Verify dependencies",
    "",
    "Skill metadata:",
    `- Category: ${category}`,
    `- Runtime: ${runtimeLine}`,
    `- Runtime deps: ${depsLine}`,
    `- Env vars: ${envLine}`,
    `- Required tools: ${toolLine}`,
    "",
    "Run actual checks before executing — don't trust the metadata blindly:",
    "- runtime: `node --version` (node) · `python3 --version` (python) ·",
    "  the equivalent for whatever runtime is listed.",
    "- deps: try to resolve each — `node -e \"require('<lib>')\"` for node,",
    "  `python3 -c \"import <lib>\"` for python.",
    "- env vars: `printenv <VAR>` — empty output means missing.",
    "- tools: `which <tool>` (or your runtime's equivalent).",
    "",
    "Report missing items to the user with install commands",
    "(`npm install <pkg>` for node, `pip install <pkg>` for python). Wait",
    "for fixes before step 4.",
    "",
    "## Step 4: Execute",
    "",
    "Read the fetched `SKILL.md` body and follow its instructions. For",
    "runtime-based or mixed skills, run scripts under `scripts/` as",
    "directed by `SKILL.md`.",
    "",
    "## Skill reference",
    `- GUID: ${guid}`,
    `- Ornn URL: ${skillUrl}`,
    "",
  ].join("\n");
}
