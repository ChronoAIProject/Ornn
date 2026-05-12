/**
 * Admin Dashboard Page.
 *
 * Six tiles + RecentActivities widget. Tiles cover users (total / admin /
 * normal) and skills (system / public / private), giving admins a single
 * snapshot of platform shape. The "system + public + private = total"
 * partition is enforced server-side by `isSystemSkill` ⊆ `!isPrivate` —
 * see Architecture §0 Q5.
 *
 * @module pages/admin/DashboardPage
 */

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DashboardTile } from "@/components/admin/DashboardTile";
import { RecentActivities } from "@/components/admin/RecentActivities";
import { fetchDashboardStats } from "@/services/adminDashboardApi";
import { translateError } from "@/utils/translateError";

export function DashboardPage() {
  const { t } = useTranslation();
  const stats = useQuery({
    queryKey: ["admin", "dashboard", "stats"] as const,
    queryFn: fetchDashboardStats,
    staleTime: 30_000,
  });

  const errorMsg = stats.error
    ? translateError(stats.error, t("adminPages.dashboard.loadFailed"))
    : null;

  const data = stats.data;

  // Skill-visibility helper labels are code identifiers, not natural
  // language — kept verbatim across locales on purpose.
  const SKILL_PREDICATE_SYSTEM = "isSystemSkill: true";
  const SKILL_PREDICATE_PUBLIC = "!isPrivate ∧ !isSystemSkill";
  const SKILL_PREDICATE_PRIVATE = "isPrivate: true";

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-strong">
          {t("adminPages.dashboard.heading")}
        </h1>
        <p className="mt-1 font-text text-meta">
          {t("adminPages.dashboard.subtitle")}
        </p>
      </header>

      <section
        aria-label={t("adminPages.dashboard.users.ariaLabel")}
        className="space-y-3"
      >
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
          {t("adminPages.dashboard.users.heading")}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <DashboardTile
            label={t("adminPages.dashboard.users.total")}
            value={data?.users.total}
            tone="accent"
            isLoading={stats.isLoading}
            errorMessage={errorMsg}
            delay={0}
          />
          <DashboardTile
            label={t("adminPages.dashboard.users.admin")}
            value={data?.users.admin}
            tone="support"
            helper={t("adminPages.dashboard.users.bypassQuota")}
            isLoading={stats.isLoading}
            errorMessage={errorMsg}
            delay={0.05}
          />
          <DashboardTile
            label={t("adminPages.dashboard.users.normal")}
            value={data?.users.normal}
            tone="neutral"
            isLoading={stats.isLoading}
            errorMessage={errorMsg}
            delay={0.1}
          />
        </div>
      </section>

      <section
        aria-label={t("adminPages.dashboard.skills.ariaLabel")}
        className="space-y-3"
      >
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
          {t("adminPages.dashboard.skills.heading")}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <DashboardTile
            label={t("adminPages.dashboard.skills.system")}
            value={data?.skills.system}
            tone="accent"
            helper={SKILL_PREDICATE_SYSTEM}
            isLoading={stats.isLoading}
            errorMessage={errorMsg}
            delay={0.15}
          />
          <DashboardTile
            label={t("adminPages.dashboard.skills.public")}
            value={data?.skills.public}
            tone="support"
            helper={SKILL_PREDICATE_PUBLIC}
            isLoading={stats.isLoading}
            errorMessage={errorMsg}
            delay={0.2}
          />
          <DashboardTile
            label={t("adminPages.dashboard.skills.private")}
            value={data?.skills.private}
            tone="neutral"
            helper={SKILL_PREDICATE_PRIVATE}
            isLoading={stats.isLoading}
            errorMessage={errorMsg}
            delay={0.25}
          />
        </div>
      </section>

      <RecentActivities />
    </div>
  );
}
