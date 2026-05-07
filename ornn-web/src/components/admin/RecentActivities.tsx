/**
 * RecentActivities — top-10 list widget on the admin dashboard.
 *
 * Pulls from `GET /api/v1/admin/dashboard/recent-activities?limit=10`.
 * Empty state shows mono uppercase "No activity yet" copy; the View all
 * link points to the existing /admin/activities log.
 *
 * @module components/admin/RecentActivities
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import {
  fetchRecentActivities,
  type RecentActivity,
} from "@/services/adminDashboardApi";

function formatDateSGT(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-SG", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function actionTone(
  action: string,
): "green" | "muted" | "cyan" | "yellow" | "red" | "magenta" {
  switch (action) {
    case "login":
      return "green";
    case "logout":
      return "muted";
    case "skill:create":
      return "cyan";
    case "skill:update":
      return "yellow";
    case "skill:delete":
      return "red";
    case "skill:visibility_change":
      return "magenta";
    default:
      return "muted";
  }
}

interface ActivityRowProps {
  activity: RecentActivity;
}

function ActivityRow({ activity }: ActivityRowProps) {
  const detail =
    activity.details && Object.keys(activity.details).length > 0
      ? ((activity.details as Record<string, unknown>).skillName as string) ??
        JSON.stringify(activity.details)
      : null;

  return (
    <li className="flex flex-col gap-2 rounded border border-accent/10 bg-card p-3 sm:flex-row sm:items-center sm:gap-4">
      <span className="shrink-0 font-mono text-[11px] text-meta">
        {formatDateSGT(activity.createdAt)}
      </span>
      <span className="font-text text-sm text-strong">
        {activity.userDisplayName || activity.userEmail}
      </span>
      <Badge color={actionTone(activity.action)}>{activity.action}</Badge>
      {detail && (
        <span className="truncate font-text text-sm text-meta">{detail}</span>
      )}
    </li>
  );
}

export function RecentActivities() {
  const query = useQuery({
    queryKey: ["admin", "dashboard", "recent"] as const,
    queryFn: () => fetchRecentActivities(10),
    staleTime: 30_000,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.25 }}
    >
      <Card>
        <header className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold uppercase tracking-tight text-strong">
            Recent activity
          </h2>
          <Link
            to="/admin/activities"
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent hover:text-accent-muted"
          >
            View all
          </Link>
        </header>

        {query.isLoading ? (
          <Skeleton lines={5} />
        ) : query.error ? (
          <p
            role="alert"
            className="py-6 text-center font-text text-danger"
          >
            {query.error instanceof Error
              ? query.error.message
              : "Failed to load activities"}
          </p>
        ) : (query.data ?? []).length === 0 ? (
          <p className="py-6 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-meta">
            No activity yet
          </p>
        ) : (
          <ul className="space-y-2">
            {(query.data ?? []).map((a) => (
              <ActivityRow key={a.id} activity={a} />
            ))}
          </ul>
        )}
      </Card>
    </motion.div>
  );
}
