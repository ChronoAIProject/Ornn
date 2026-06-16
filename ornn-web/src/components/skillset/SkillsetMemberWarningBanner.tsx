/**
 * SkillsetMemberWarningBanner — owner/admin-only warning (#1136) shown on the
 * Skillset Detail Page when one or more member skills are no longer readable
 * by the caller.
 *
 * Because a skillset's visibility is DERIVED from its members, an unreadable
 * member shrinks the skillset's reach: the people who could use it before
 * can't anymore. This banner lists the affected member refs and the fix —
 * publish a new version without them, or get the skill owner to re-grant
 * access. Styled in forge-gold (warning), or kiln-red when the members are
 * unresolvable (hard-broken).
 *
 * @module components/skillset/SkillsetMemberWarningBanner
 */

import { useTranslation } from "react-i18next";

export interface SkillsetMemberWarningBannerProps {
  /** Member refs the caller can't read at this version (non-empty to render). */
  unreadableMembers: string[];
  /** `unresolvable` → red (hard-broken); otherwise gold (access lost). */
  unresolvable: boolean;
  className?: string | undefined;
}

export function SkillsetMemberWarningBanner({
  unreadableMembers,
  unresolvable,
  className = "",
}: SkillsetMemberWarningBannerProps) {
  const { t } = useTranslation();
  if (unreadableMembers.length === 0) return null;

  // Kiln-red when refs are hard-gone (unresolvable); forge-gold for a plain
  // access loss the owner can still repair by re-granting. Full class strings
  // (not interpolated) so Tailwind's static extraction keeps them.
  const accentText = unresolvable ? "text-danger" : "text-warning";

  return (
    <div
      role="alert"
      className={`flex flex-col gap-2 rounded border bg-card p-4 ${
        unresolvable ? "border-danger/40 bg-danger/5" : "border-warning/40 bg-warning/5"
      } ${className}`}
    >
      <div className="flex items-start gap-3">
        <svg
          className={`mt-0.5 h-5 w-5 shrink-0 ${accentText}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3l-6.93-12a2 2 0 00-3.48 0l-6.93 12a2 2 0 001.74 3z"
          />
        </svg>
        <div className="min-w-0 flex-1">
          <p className={`font-display text-sm ${accentText}`}>
            {unresolvable
              ? t(
                  "skillsetDetail.memberWarning.brokenTitle",
                  "Some member skills no longer exist",
                )
              : t(
                  "skillsetDetail.memberWarning.lostTitle",
                  "You no longer have access to some member skills",
                )}
          </p>
          <p className="mt-1 font-text text-sm text-strong/90">
            {t(
              "skillsetDetail.memberWarning.body",
              "This skillset is bounded by its members, so it can no longer be used or discovered by everyone who could before. Re-gain access to the skill(s) below — or publish a new version of this skillset without them.",
            )}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {unreadableMembers.map((ref) => (
              <li
                key={ref}
                className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] ${
                  unresolvable
                    ? "border-danger/40 bg-danger-soft text-danger"
                    : "border-warning/40 bg-warning-soft text-warning"
                }`}
              >
                {ref}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
