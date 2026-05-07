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

interface NavEntry {
  to: string;
  label: string;
}

const SECTIONS: NavEntry[] = [
  { to: "/admin/settings/llm-providers", label: "LLM Providers" },
  { to: "/admin/settings/playground", label: "Playground" },
  { to: "/admin/settings/skill-generation", label: "Skill Generation" },
  { to: "/admin/settings/mirror", label: "GitHub Mirror" },
  { to: "/admin/settings/integrations/nyxid", label: "NyxID Integration" },
  { to: "/admin/settings/integrations/services", label: "Other Services" },
  { to: "/admin/settings/skill-audit", label: "Skill Auditing" },
  { to: "/admin/settings/telemetry", label: "Telemetry" },
  { to: "/admin/settings/quota", label: "Quota Defaults" },
  { to: "/admin/settings/extras", label: "Extras" },
  { to: "/admin/settings/export-import", label: "Export / Import" },
];

interface SettingsNavProps {
  className?: string;
}

export function SettingsNav({ className = "" }: SettingsNavProps) {
  return (
    <nav
      aria-label="Settings sections"
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
          {s.label}
        </NavLink>
      ))}
    </nav>
  );
}
