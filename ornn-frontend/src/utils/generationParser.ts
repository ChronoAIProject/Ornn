/**
 * Generation Output Parser.
 * Parses raw LLM JSON output into files, contents, and metadata for skill preview.
 * The LLM returns structured JSON with readmeBody (no frontmatter) + scripts array.
 * This parser builds the SKILL.md (frontmatter + body) and script files.
 * @module utils/generationParser
 */

import type { FileNode } from "@/components/editor/FileTree";
import type { SkillMetadata, SkillOutputType } from "@/types/skillPackage";
import { createDefaultSkillMetadata } from "@/types/skillPackage";
import type { SkillCategory } from "@/utils/constants";
import { buildSkillMd } from "@/utils/frontmatterBuilder";

interface ParsedGenerationOutput {
  files: FileNode[];
  contents: Map<string, string>;
  metadata: SkillMetadata | null;
}

/**
 * Strip markdown code fences (```json ... ```) and extract JSON from raw LLM output.
 */
export function cleanJsonFences(raw: string): string {
  let cleaned = raw.trim();

  // Remove markdown fences
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // Extract JSON object if there's surrounding text
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
  }

  return cleaned;
}

/**
 * Extract SkillMetadata from a parsed LLM JSON object.
 * Maps LLM output fields into the new nested metadata structure.
 */
export function extractMetadata(
  parsed: Record<string, unknown>,
): SkillMetadata {
  // The LLM may output category, runtimes, tags, envVars, dependencies as flat fields.
  // Map them into the nested metadata block.
  const category = ((parsed.category as string) ?? "plain") as SkillCategory;
  const runtimes = (parsed.runtimes as string[]) ?? [];
  const tags = (parsed.tags as string[]) ?? [];
  const envVars = (parsed.envVars as string[]) ?? (parsed.env as string[]) ?? [];
  const deps = (parsed.dependencies as string[]) ?? (parsed.npmDependencies as string[]) ?? [];
  const outputType = (parsed.outputType as SkillOutputType) ?? undefined;

  return createDefaultSkillMetadata({
    name: (parsed.name as string) ?? "generated-skill",
    description: (parsed.description as string) ?? "",
    metadata: {
      category,
      outputType,
      runtime: runtimes,
      runtimeDependency: deps,
      runtimeEnvVar: envVars,
      toolList: [],
      tag: tags,
    },
    license: (parsed.license as string) ?? "",
    compatibility: (parsed.compatibility as string) ?? "",
  });
}

/**
 * Build a FileNode tree and contents map from parsed generation JSON.
 * - SKILL.md = frontmatter (from metadata) + readmeBody
 * - scripts/ = each entry from the scripts array
 */
export function buildFileTreeFromParsed(
  parsed: Record<string, unknown>,
  metadata: SkillMetadata,
): { files: FileNode[]; contents: Map<string, string> } {
  const contents = new Map<string, string>();

  // Get readme body (new format: readmeBody, fallback: readmeMd with frontmatter stripped)
  let body = (parsed.readmeBody as string) ?? "";
  if (!body && parsed.readmeMd) {
    const md = parsed.readmeMd as string;
    // Strip frontmatter if present
    if (md.trimStart().startsWith("---")) {
      const endIdx = md.indexOf("\n---", 3);
      body = endIdx > 0 ? md.slice(endIdx + 4).trim() : md;
    } else {
      body = md;
    }
  }

  // Build SKILL.md with proper frontmatter from structured metadata
  const fullSkillMd = buildSkillMd(metadata, body);
  contents.set("SKILL.md", fullSkillMd);

  const rootChildren: FileNode[] = [
    { id: "SKILL.md", name: "SKILL.md", type: "file" },
  ];

  // Extract scripts into scripts/ directory
  const scripts = (parsed.scripts ?? []) as Array<{
    filename?: string;
    name?: string;
    content: string;
  }>;

  if (scripts.length > 0) {
    const scriptNodes: FileNode[] = scripts.map((s) => {
      const fname = s.filename ?? s.name ?? "script.ts";
      const filePath = `scripts/${fname}`;
      contents.set(filePath, s.content);
      return { id: filePath, name: fname, type: "file" as const };
    });

    rootChildren.push({
      id: "scripts",
      name: "scripts",
      type: "folder",
      children: scriptNodes,
    });
  }

  const files: FileNode[] = [
    {
      id: "root",
      name: metadata.name,
      type: "folder",
      children: rootChildren,
    },
  ];

  return { files, contents };
}

/**
 * Parse raw JSON output from the LLM into files and metadata.
 * Orchestrates cleaning, metadata extraction, and file tree construction.
 */
export function parseGenerationOutput(
  raw: string,
): ParsedGenerationOutput {
  const cleaned = cleanJsonFences(raw);

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const metadata = extractMetadata(parsed);
    const { files, contents } = buildFileTreeFromParsed(
      parsed,
      metadata,
    );

    return { files, contents, metadata };
  } catch {
    // If JSON parsing fails, treat raw as SKILL.md content
    const contents = new Map<string, string>();
    contents.set("SKILL.md", raw);

    const files: FileNode[] = [
      {
        id: "root",
        name: "generated-skill",
        type: "folder",
        children: [
          { id: "SKILL.md", name: "SKILL.md", type: "file" },
        ],
      },
    ];

    return { files, contents, metadata: null };
  }
}
