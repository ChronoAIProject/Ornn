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
    "## Prerequisites",
    "You need: (1) NyxID CLI installed and logged in, (2) the Ornn service",
    "connected via `nyxid__nyx__connect_service`. If either is missing, guide",
    "the user to set these up first.",
    "",
    "## Step 1: Check local installation",
    "Look for this skill in your agent's skills directory:",
    `- Claude Code: \`~/.claude/skills/${name}/\``,
    "- Other agents: your equivalent skill dir",
    "",
    "If found → load SKILL.md and jump to step 3.",
    `If not → ask the user: "Install ${name} locally for future reuse? (y/n)"`,
    "",
    "## Step 2: Fetch + (optionally) install",
    `Call \`ornn__getskilljson(id="${guid}")\` to get the full package as JSON`,
    "(SKILL.md + scripts). If the user said yes in step 1, write the returned",
    `files to the local skills dir (e.g. \`~/.claude/skills/${name}/\`).`,
    "",
    "## Step 3: Check dependencies",
    "Skill metadata:",
    `- Category: ${category}`,
    `- Runtime: ${runtimeLine}`,
    `- Runtime deps: ${depsLine}`,
    `- Env vars: ${envLine}`,
    `- Required tools: ${toolLine}`,
    "",
    "Verify each; report any missing to the user with install commands",
    "(`npm install <pkg>` for node, `pip install <pkg>` for python).",
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
