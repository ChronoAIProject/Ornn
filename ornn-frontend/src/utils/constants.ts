/** Skill-type categories (4-category system) */
export const SKILL_CATEGORIES = [
  "plain",
  "tool-based",
  "runtime-based",
  "mixed",
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/** Category display info with labels and descriptions */
export const SKILL_CATEGORY_INFO: Record<SkillCategory, { label: string; description: string }> = {
  plain: {
    label: "Plain Skill",
    description:
      "A text-only skill with instructions and documentation. No executable code or tool requirements.",
  },
  "tool-based": {
    label: "Tool-Based Skill",
    description:
      "Requires specific Claude tools (e.g., Bash, Write, Read). The skill references tools that must be available in the client.",
  },
  "runtime-based": {
    label: "Runtime-Based Skill",
    description:
      "Includes executable scripts that run in a specific runtime environment (e.g., Node.js or Python).",
  },
  mixed: {
    label: "Mixed Skill",
    description: "Combines tool requirements with executable runtime scripts.",
  },
};

/** Available runtime environments */
export const AVAILABLE_RUNTIMES = ["node", "python"] as const;
export type AvailableRuntime = (typeof AVAILABLE_RUNTIMES)[number];

/** Runtime display info */
export const RUNTIME_INFO: Record<AvailableRuntime, { label: string }> = {
  node: { label: "Node.js (JavaScript)" },
  python: { label: "Python" },
};

/** Standard skill package folder names */
export const SKILL_FOLDERS = ["scripts", "references", "assets"] as const;

/** Suggested Claude tools for the ToolsInput component */
export const SUGGESTED_TOOLS = [
  "Bash",
  "Write",
  "Read",
  "Edit",
  "Glob",
  "Grep",
  "Task",
] as const;

/** Backward-compatible alias for SKILL_CATEGORIES */
export const CATEGORIES = SKILL_CATEGORIES;
/** Backward-compatible alias for SkillCategory */
export type Category = SkillCategory;

/** Sort options */
export const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "downloads", label: "Most Downloads" },
  { value: "name", label: "Alphabetical" },
] as const;

/** Pagination defaults */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Upload limits */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_FILE_SIZE_LABEL = "50 MB";
export const ACCEPTED_FILE_TYPES = [".tar.gz", ".zip"];
export const MAX_TAGS = 10;
