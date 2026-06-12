/**
 * SettingsNav — left rail of the admin /admin/settings page.
 *
 * Mono uppercase labels, deep-linkable. Each entry is its own NavLink;
 * the SettingsLayout reads `dirtySection` so that switching sections
 * with unsaved changes triggers the UnsavedChangesGuard prompt before
 * the route change commits.
 *
 * @module components/admin/settings/SettingsNav
 */

import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface NavEntrySource {
  to: string;
  i18nKey: string;
}

const SECTIONS: NavEntrySource[] = [
  { to: "/admin/settings/llm-providers", i18nKey: "llmProviders" },
  { to: "/admin/settings/playground", i18nKey: "playground" },
  { to: "/admin/settings/skill-generation", i18nKey: "skillGeneration" },
  { to: "/admin/settings/mirror", i18nKey: "githubMirror" },
  { to: "/admin/settings/integrations/nyxid", i18nKey: "nyxidIntegration" },
  { to: "/admin/settings/skill-audit", i18nKey: "skillAuditing" },
  { to: "/admin/settings/posthog", i18nKey: "postHog" },
  { to: "/admin/settings/extras", i18nKey: "serviceBinding" },
  { to: "/admin/settings/export-import", i18nKey: "exportImport" },
];

interface SettingsNavProps {
  className?: string;
}

export function SettingsNav({ className = "" }: SettingsNavProps) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("aria.settingsSections")}
      className={`flex flex-col gap-0.5 ${className}`}
    >
      {SECTIONS.map((s) => (
        <NavLink
          key={s.to}
          to={s.to}
          className={({ isActive }) =>
            `block rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors duration-150 ${
              isActive
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-transparent text-meta hover:bg-elevated hover:text-strong"
            }`
          }
        >
          {t(`adminSettingsNav.${s.i18nKey}`)}
        </NavLink>
      ))}
    </nav>
  );
}
