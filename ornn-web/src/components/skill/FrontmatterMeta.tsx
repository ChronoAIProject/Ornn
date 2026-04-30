/**
 * Frontmatter Meta Display Component.
 * Renders parsed YAML frontmatter metadata from skill content.
 * Supports both new nested `metadata` structure and old flat keys.
 * @module components/skill/FrontmatterMeta
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { extractFrontmatter } from "@/utils/frontmatter";

export interface FrontmatterMetaProps {
  /** Raw markdown content that may contain YAML frontmatter */
  content: string;
  className?: string;
}

const TOOL_COLORS: Record<string, "cyan" | "magenta" | "yellow" | "green"> = {
  Bash: "cyan",
  Write: "magenta",
  Read: "green",
  Edit: "yellow",
};

function getToolColor(tool: string): "cyan" | "magenta" | "yellow" | "green" {
  return TOOL_COLORS[tool] ?? "cyan";
}

function MetaSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-2 font-display text-xs uppercase tracking-wider text-meta">
        {title}
      </h4>
      {children}
    </div>
  );
}

/**
 * Renders parsed YAML frontmatter metadata from skill content.
 * Displays runtimes, tools, npm dependencies, environment variables,
 * and compatibility info as badge groups within a glass panel.
 * Supports both new nested metadata structure and old flat keys.
 */
export function FrontmatterMeta({
  content,
  className = "",
}: FrontmatterMetaProps) {
  const frontmatter = useMemo(() => extractFrontmatter(content), [content]);

  if (!frontmatter) return null;

  // Extract from nested metadata structure (new format, applied by adapter)
  const meta = frontmatter.metadata;

  const runtimes = meta?.runtime ?? [];
  const tools = meta?.toolList ?? [];
  const deps = meta?.runtimeDependency ?? [];
  const envVars = meta?.runtimeEnvVar ?? [];
  const compatibility = (frontmatter as Record<string, unknown>)
    .compatibility as string | undefined;

  const hasRuntimes = runtimes.length > 0;
  const hasTools = tools.length > 0;
  const hasDeps = deps.length > 0;
  const hasEnv = envVars.length > 0;
  const hasCompat = !!compatibility;

  if (!hasRuntimes && !hasTools && !hasDeps && !hasEnv && !hasCompat) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`glass space-y-4 rounded-lg border border-accent/10 p-4 ${className}`}
    >
      {hasRuntimes && (
        <MetaSection title="Runtime">
          <div className="flex flex-wrap gap-1.5">
            {runtimes.map((rt) => (
              <Badge key={rt} color="green">
                {rt}
              </Badge>
            ))}
          </div>
        </MetaSection>
      )}

      {hasTools && (
        <MetaSection title="Required Tools">
          <div className="flex flex-wrap gap-1.5">
            {tools.map((tool) => (
              <Badge key={tool} color={getToolColor(tool)}>
                {tool}
              </Badge>
            ))}
          </div>
        </MetaSection>
      )}

      {hasDeps && (
        <MetaSection title="Dependencies">
          <div className="flex flex-wrap gap-1.5">
            {deps.map((dep) => (
              <Badge key={dep} color="magenta">
                {dep}
              </Badge>
            ))}
          </div>
        </MetaSection>
      )}

      {hasEnv && (
        <MetaSection title="Environment Variables">
          <div className="flex flex-wrap gap-1.5">
            {envVars.map((envVar) => (
              <Badge key={envVar} color="yellow">
                {envVar}
              </Badge>
            ))}
          </div>
        </MetaSection>
      )}

      {hasCompat && (
        <MetaSection title="Compatibility">
          <p className="font-text text-sm text-strong">
            {compatibility}
          </p>
        </MetaSection>
      )}
    </motion.div>
  );
}
