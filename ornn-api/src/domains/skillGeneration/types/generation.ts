/** Output shape from LLM skill generation. */
export interface GeneratedSkill {
  name: string;
  description: string;
  category: "plain" | "runtime-based";
  tags: string[];
  /** Markdown body content (no frontmatter — frontmatter built by client). */
  readmeBody: string;
  runtimes: string[];
  /** Package dependencies required by this skill (npm for node, pip for python). */
  dependencies: string[];
  /** Environment variable names required by this skill. */
  envVars: string[];
  /** Script files to place in scripts/ directory. */
  scripts: Array<{ filename: string; content: string }>;
}

/** Options for LLM completion calls. */
export interface LlmOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** System-level prompt sent as role: "system" before the user message. */
  systemPrompt?: string;
}
