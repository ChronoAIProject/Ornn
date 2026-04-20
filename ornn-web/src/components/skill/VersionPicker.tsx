import { useTranslation } from "react-i18next";
import type { SkillVersionEntry } from "@/types/domain";
import { formatVersionLabel } from "@/lib/versionLabel";

export interface VersionPickerProps {
  /** All available versions, already sorted newest-first. */
  versions: SkillVersionEntry[];
  /** Version currently shown on the page (may be latest or a specific pick). */
  currentVersion: string;
  /**
   * Fire when the user picks a different version. Passed `null` when the user
   * explicitly picks the "latest" sentinel (so the caller can drop the
   * `?version=` URL param).
   */
  onChange: (versionOrLatest: string | null) => void;
  className?: string;
}

/**
 * Dropdown (styled `<select>`) for picking a published version of a skill.
 * Marks the latest with "· latest" and any deprecated versions with
 * "· deprecated" in the visible label. Picking "latest" fires `null` so the
 * caller drops the URL's `?version=` parameter.
 */
export function VersionPicker({
  versions,
  currentVersion,
  onChange,
  className = "",
}: VersionPickerProps) {
  const { t } = useTranslation();
  const latestVersion = versions[0]?.version;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label
        htmlFor="skill-version-picker"
        className="font-heading text-[11px] uppercase tracking-wider text-text-muted"
      >
        {t("skillDetail.version")}
      </label>
      <select
        id="skill-version-picker"
        value={currentVersion}
        onChange={(e) => {
          const picked = e.target.value;
          onChange(picked === latestVersion ? null : picked);
        }}
        className="
          glass rounded-lg border border-neon-cyan/20 bg-bg-elevated
          px-3 py-1.5 font-body text-sm text-text-primary
          cursor-pointer
          focus:outline-none focus:border-neon-cyan/60
          hover:border-neon-cyan/40
          transition-colors
        "
      >
        {versions.map((v) => (
          <option key={v.version} value={v.version} className="bg-bg-deep">
            {formatVersionLabel(v.version, {
              isLatest: v.version === latestVersion,
              isDeprecated: v.isDeprecated,
              latestText: t("skillDetail.latest"),
              deprecatedText: t("skillDetail.deprecated"),
            })}
          </option>
        ))}
      </select>
    </div>
  );
}
