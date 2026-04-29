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

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { VersionDiffView } from "@/components/skill/VersionDiffView";
import { useSkillVersionDiff } from "@/hooks/useSkills";
import type { SkillVersionEntry } from "@/types/domain";

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

  // Default `from` = current; `to` = latest. If the user is already on
  // latest, default `from` to the second-newest so the picker isn't
  // pointing at the same row on both sides.
  const [fromVersion, setFromVersion] = useState<string>(() => {
    if (currentVersion && currentVersion !== latestVersion) return currentVersion;
    return versions[1]?.version ?? currentVersion ?? "";
  });
  const [toVersion, setToVersion] = useState<string>(latestVersion);

  // If the user reopens the modal after viewing a different version, snap
  // the defaults to the new `currentVersion`. Skipped while open so manual
  // picks aren't trampled mid-session.
  useEffect(() => {
    if (!isOpen) {
      const nextFrom =
        currentVersion && currentVersion !== latestVersion
          ? currentVersion
          : versions[1]?.version ?? currentVersion ?? "";
      setFromVersion(nextFrom);
      setToVersion(latestVersion);
    }
  }, [isOpen, currentVersion, latestVersion, versions]);

  const sameVersion = fromVersion && toVersion && fromVersion === toVersion;
  const enoughVersions = versions.length >= 2;

  const { data, isLoading, isFetching, error } = useSkillVersionDiff(
    idOrName,
    fromVersion,
    toVersion,
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("versionDiff.title", "Compare versions") as string}
      className="!max-w-4xl"
    >
      {!enoughVersions ? (
        <p className="font-body text-sm text-text-muted">
          {t(
            "versionDiff.needTwoVersions",
            "This skill only has one version — there's nothing to compare yet.",
          )}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block font-heading text-[10px] uppercase tracking-wider text-text-muted">
                {t("versionDiff.fromLabel", "From")}
              </span>
              <select
                value={fromVersion}
                onChange={(e) => setFromVersion(e.target.value)}
                className="
                  rounded border border-strong-edge bg-card px-2.5 py-1.5
                  font-mono text-sm text-text-primary
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

            <span className="pb-2 font-mono text-text-muted" aria-hidden>
              →
            </span>

            <label className="space-y-1">
              <span className="block font-heading text-[10px] uppercase tracking-wider text-text-muted">
                {t("versionDiff.toLabel", "To")}
              </span>
              <select
                value={toVersion}
                onChange={(e) => setToVersion(e.target.value)}
                className="
                  rounded border border-strong-edge bg-card px-2.5 py-1.5
                  font-mono text-sm text-text-primary
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
            <p className="font-body text-sm text-text-muted">
              {t(
                "versionDiff.sameVersion",
                "Pick two different versions to see a diff.",
              )}
            </p>
          )}

          {!sameVersion && (isLoading || isFetching) && !data && (
            <p className="font-body text-sm text-text-muted">
              {t("versionDiff.loading", "Computing diff…")}
            </p>
          )}

          {!sameVersion && error && (
            <p className="font-body text-sm text-danger">
              {error instanceof Error
                ? error.message
                : t("versionDiff.error", "Failed to compute diff.")}
            </p>
          )}

          {!sameVersion && data && <VersionDiffView diff={data.diff} showSummary />}
        </div>
      )}
    </Modal>
  );
}
