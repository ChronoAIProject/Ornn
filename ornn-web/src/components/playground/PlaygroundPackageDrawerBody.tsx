/**
 * Package drawer body extracted from PlaygroundPage (#453).
 *
 * Renders the skill package preview (file tree + viewer) inside the
 * drawer, with a footer that pins a registry link to the bottom. The
 * preview is read-only; the parent owns the files + contents +
 * metadata and the package-loading flag.
 *
 * @module components/playground/PlaygroundPackageDrawerBody
 */

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/Skeleton";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import type { FileNode } from "@/components/editor/FileTree";
import type { SkillMetadata } from "@/types/skillPackage";

export interface PlaygroundPackageDrawerBodyProps {
  packageLoading: boolean;
  packageFiles: FileNode[];
  /** Matches `useSkillPackage().fileContents` shape (path → text). */
  packageContents: Map<string, string>;
  /** `null` while the skill is still loading; SkillPackagePreview tolerates either. */
  previewMetadata: SkillMetadata | null;
  /** When present, the footer shows `name@vversion` + a link to the registry. */
  skill: { name: string; version: string } | null | undefined;
}

export function PlaygroundPackageDrawerBody({
  packageLoading,
  packageFiles,
  packageContents,
  previewMetadata,
  skill,
}: PlaygroundPackageDrawerBodyProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Padded content area — must itself be a flex column so the
          preview's `flex-1 min-h-0` actually claims the remaining
          height and the file viewer scrolls internally instead of
          bleeding past the footer. */}
      <div className="flex min-h-0 flex-1 flex-col p-4">
        {packageLoading ? (
          <Skeleton lines={8} />
        ) : packageFiles.length > 0 ? (
          <SkillPackagePreview
            files={packageFiles}
            fileContents={packageContents}
            metadata={previewMetadata}
            editable={false}
            className="min-h-0 flex-1"
          />
        ) : (
          <div className="flex h-32 items-center justify-center">
            <p className="font-text text-xs text-meta">{t("playground.noPackage")}</p>
          </div>
        )}
      </div>

      {/* Footer — registry link pinned at the bottom, matching the
          Skill drawer's pattern. */}
      {skill && (
        <div className="flex shrink-0 items-center justify-between border-t border-subtle bg-elevated/30 px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
            {skill.name}@v{skill.version}
          </span>
          <Link
            to={`/skills/${encodeURIComponent(skill.name)}`}
            className="font-mono text-[11px] text-accent hover:underline"
          >
            {t("playground.openInRegistry", "Open in registry →")}
          </Link>
        </div>
      )}
    </div>
  );
}
