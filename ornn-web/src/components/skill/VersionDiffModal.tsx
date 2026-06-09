/**
 * VersionDiffModal — pick two published versions of a skill and render a
 * file-level diff between them.
 *
 * Hits `GET /api/v1/skills/:idOrName/versions/:from/diff/:to`. Server
 * inlines text content for both sides of every modified file (capped at
 * ~64 KiB per side; flag `truncated: true` when capped) so we can do
 * line-level diff client-side without a second round-trip. Binary files
 * come back without inline content; we just report the size + hash
 * change.
 *
 * The default (`from`, `to`) lands as (currently-viewed version, latest)
 * so the common case — "what changed since the version I'm looking at" —
 * is one click away. The user can re-pick either side; same-version
 * compares are short-circuited locally (the backend would 400 with
 * `SAME_VERSION` and the round-trip is wasted).
 *
 * Diff rendering is delegated to `VersionDiffView` so the same renderer
 * powers the GitHub-link sync-preview flow on the advanced options
 * panel.
 *
 * @module components/skill/VersionDiffModal
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { VersionDiffView } from "@/components/skill/VersionDiffView";
import { useSkillVersionDiff } from "@/hooks/useSkills";
import type { SkillVersionEntry } from "@/types/domain";
import { translateError } from "@/utils/translateError";

export interface VersionDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Skill id or name — passed straight to the diff endpoint. */
  idOrName: string;
  /** Full version list (already-fetched). Newest first. */
  versions: SkillVersionEntry[];
  /** Version the page is currently rendering — defaults the `from` picker. */
  currentVersion: string;
}

export function VersionDiffModal({
  isOpen,
  onClose,
  idOrName,
  versions,
  currentVersion,
}: VersionDiffModalProps) {
  const { t } = useTranslation();

  // Latest is the first row (versions are newest-first).
  const latestVersion = versions[0]?.version ?? "";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("versionDiff.title", "Compare versions") as string}
      className="!max-w-4xl"
    >
      {/* Keyed on the current/latest version so the picker defaults
          re-seed by construction when the modal reopens after the page
          moved to a different version — no snap-on-close effect, no
          cascading render (#888). The outer Modal owns the open/close
          animation. */}
      <VersionDiffBody
        key={`${currentVersion}:${latestVersion}`}
        idOrName={idOrName}
        versions={versions}
        currentVersion={currentVersion}
        latestVersion={latestVersion}
        t={t}
      />
    </Modal>
  );
}

interface VersionDiffBodyProps {
  idOrName: string;
  versions: VersionDiffModalProps["versions"];
  currentVersion: string;
  latestVersion: string;
  t: ReturnType<typeof useTranslation>["t"];
}

function VersionDiffBody({
  idOrName,
  versions,
  currentVersion,
  latestVersion,
  t,
}: VersionDiffBodyProps) {
  // Default `from` = current; `to` = latest. If the user is already on
  // latest, default `from` to the second-newest so the picker isn't
  // pointing at the same row on both sides.
  const [fromVersion, setFromVersion] = useState<string>(() => {
    if (currentVersion && currentVersion !== latestVersion) return currentVersion;
    return versions[1]?.version ?? currentVersion ?? "";
  });
  const [toVersion, setToVersion] = useState<string>(latestVersion);

  const sameVersion = fromVersion && toVersion && fromVersion === toVersion;
  const enoughVersions = versions.length >= 2;

  const { data, isLoading, isFetching, error } = useSkillVersionDiff(
    idOrName,
    fromVersion,
    toVersion,
  );

  return (
    <>
      {!enoughVersions ? (
        <p className="font-text text-sm text-meta">
          {t(
            "versionDiff.needTwoVersions",
            "This skill only has one version — there's nothing to compare yet.",
          )}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block font-display text-[10px] uppercase tracking-wider text-meta">
                {t("versionDiff.fromLabel", "From")}
              </span>
              <select
                value={fromVersion}
                onChange={(e) => setFromVersion(e.target.value)}
                className="
                  rounded border border-strong-edge bg-card px-2.5 py-1.5
                  font-mono text-sm text-strong
                  focus:outline-none focus:border-strong
                "
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version}
                    {v.version === latestVersion ? ` (${t("skillDetail.latest")})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <span className="pb-2 font-mono text-meta" aria-hidden>
              →
            </span>

            <label className="space-y-1">
              <span className="block font-display text-[10px] uppercase tracking-wider text-meta">
                {t("versionDiff.toLabel", "To")}
              </span>
              <select
                value={toVersion}
                onChange={(e) => setToVersion(e.target.value)}
                className="
                  rounded border border-strong-edge bg-card px-2.5 py-1.5
                  font-mono text-sm text-strong
                  focus:outline-none focus:border-strong
                "
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version}
                    {v.version === latestVersion ? ` (${t("skillDetail.latest")})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {sameVersion && (
            <p className="font-text text-sm text-meta">
              {t(
                "versionDiff.sameVersion",
                "Pick two different versions to see a diff.",
              )}
            </p>
          )}

          {!sameVersion && (isLoading || isFetching) && !data && (
            <p className="font-text text-sm text-meta">
              {t("versionDiff.loading", "Computing diff…")}
            </p>
          )}

          {!sameVersion && error && (
            <p className="font-text text-sm text-danger">
              {translateError(error, t("versionDiff.error", "Failed to compute diff."))}
            </p>
          )}

          {!sameVersion && data && <VersionDiffView diff={data.diff} showSummary />}
        </div>
      )}
    </>
  );
}
