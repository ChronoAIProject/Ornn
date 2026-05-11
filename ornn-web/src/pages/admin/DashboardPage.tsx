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
import { DashboardTile } from "@/components/admin/DashboardTile";
import { RecentActivities } from "@/components/admin/RecentActivities";
import { fetchDashboardStats } from "@/services/adminDashboardApi";
import { translateError } from "@/utils/translateError";

export function DashboardPage() {
  const stats = useQuery({
    queryKey: ["admin", "dashboard", "stats"] as const,
    queryFn: fetchDashboardStats,
    staleTime: 30_000,
  });

  const errorMsg = stats.error
    ? translateError(stats.error, "Failed to load stats")
    : null;

  const data = stats.data;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-strong">
          Dashboard
        </h1>
        <p className="mt-1 font-text text-meta">
          Platform snapshot — user breakdown, skill visibility partition,
          and the latest 10 activities.
        </p>
      </header>

      <section
        aria-label="Users overview"
        className="space-y-3"
      >
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
          Users
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <DashboardTile
            label="Total users"
            value={data?.users.total}
            tone="accent"
            isLoading={stats.isLoading}
            errorMessage={errorMsg}
            delay={0}
          />
          <DashboardTile
            label="Admin users"
            value={data?.users.admin}
            tone="support"
            helper="Bypass quota"
            isLoading={stats.isLoading}
            errorMessage={errorMsg}
            delay={0.05}
          />
          <DashboardTile
            label="Normal users"
            value={data?.users.normal}
            tone="neutral"
            isLoading={stats.isLoading}
            errorMessage={errorMsg}
            delay={0.1}
          />
        </div>
      </section>

      <section
        aria-label="Skills overview"
        className="space-y-3"
      >
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
          Skills
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <DashboardTile
            label="System skills"
            value={data?.skills.system}
            tone="accent"
            helper="isSystemSkill: true"
            isLoading={stats.isLoading}
            errorMessage={errorMsg}
            delay={0.15}
          />
          <DashboardTile
            label="Public skills"
            value={data?.skills.public}
            tone="support"
            helper="!isPrivate ∧ !isSystemSkill"
            isLoading={stats.isLoading}
            errorMessage={errorMsg}
            delay={0.2}
          />
          <DashboardTile
            label="Private skills"
            value={data?.skills.private}
            tone="neutral"
            helper="isPrivate: true"
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
