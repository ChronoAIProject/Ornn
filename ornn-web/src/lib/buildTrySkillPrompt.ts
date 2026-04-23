/**
 * Builds the "Try this skill with Nyx CLI" prompt that a user copies to their
 * clipboard and pastes into their agent (Claude Code, Cursor, etc.).
 *
 * Pure, side-effect-free — trivially unit-testable. No DOM, no window access.
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

  const skillUrl = `${ornnOrigin.replace(/\/+$/, "")}/skills/${guid}`;

  return [
    `# Try Ornn skill: ${name}`,
    "",
    `> ${description}`,
    "",
    "All Ornn operations below go through the NyxID CLI (`nyxid`). Do not",
    "invoke MCP tools — use the CLI commands shown.",
    "",
    "## Prerequisites — actually run these checks",
    "",
    "1. **NyxID CLI installed and logged in.** Run:",
    "   ```",
    "   nyxid whoami",
    "   ```",
    "   - `command not found` → tell the user to install NyxID CLI and stop.",
    "   - Error about token / not logged in → ask the user for their NyxID",
    "     base URL and run `nyxid login --base-url <url>` (use `--password`",
    "     if browser login is unavailable). Wait for success before continuing.",
    "",
    "2. **Ornn reachable through NyxID proxy.** Run:",
    "   ```",
    "   nyxid proxy discover --output json",
    "   ```",
    "   Look for a service with slug `ornn` in the output. If absent, tell",
    "   the user Ornn is not connected in their NyxID account and stop.",
    "",
    "Only proceed once both checks pass.",
    "",
    "## Step 1: Check local installation",
    "Look for this skill at your agent's skills directory:",
    `- Claude Code: \`~/.claude/skills/${name}/\``,
    "- Other agents: your equivalent skill dir",
    "",
    "- If `SKILL.md` is present → read the local copy and jump to step 3.",
    `- If missing → ask the user: "Install ${name} locally for future reuse? (y/n)"`,
    "  Record the answer; act on it in step 2.",
    "",
    "## Step 2: Fetch the skill package",
    "Get the full package as JSON (SKILL.md + scripts + references + assets):",
    "```",
    `nyxid proxy request ornn /api/v1/skills/${guid}/json --output json`,
    "```",
    "The response body contains `{ name, description, metadata, files: { ... } }`.",
    "If the user said yes in step 1, write each entry of `files` to the local",
    `skills dir (e.g. \`~/.claude/skills/${name}/\`), preserving path structure`,
    "(`scripts/`, `references/`, `assets/`).",
    "",
    "## Step 3: Check dependencies",
    "Skill metadata:",
    `- Category: ${category}`,
    `- Runtime: ${runtimeLine}`,
    `- Runtime deps: ${depsLine}`,
    `- Env vars: ${envLine}`,
    `- Required tools: ${toolLine}`,
    "",
    "For each, run an actual check:",
    "- runtime: `node --version` (for node) or `python3 --version` (for python).",
    "- deps: try to resolve each — e.g. `node -e \"require('<lib>')\"` for node,",
    "  `python3 -c \"import <lib>\"` for python.",
    "- env vars: check each with `printenv <VAR>`; empty means missing.",
    "- tools: verify each tool is callable (`which <tool>`).",
    "",
    "Report missing items to the user with install commands",
    "(`npm install <pkg>` for node, `pip install <pkg>` for python). Wait",
    "for fixes before step 4.",
    "",
    "## Step 4: Execute",
    "Read the fetched SKILL.md body and follow its instructions. For",
    "runtime-based or mixed skills, run the scripts under `scripts/` as",
    "directed by SKILL.md.",
    "",
    "## Skill reference",
    `- GUID: ${guid}`,
    `- Ornn URL: ${skillUrl}`,
    "",
  ].join("\n");
}
