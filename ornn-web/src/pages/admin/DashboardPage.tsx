/**
 * Admin Dashboard Page.
 * Overview stats and recent activity for administrators.
 * @module pages/admin/DashboardPage
 */

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { apiGet } from "@/services/apiClient";

/** Stats response shape from the API. */
interface AdminStats {
  totalUsers: number;
  totalSkills: number;
  publicSkills: number;
  privateSkills: number;
  recentActivities: number;
}

/** Activity item shape. */
interface Activity {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  action: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

interface ActivitiesResponse {
  items: Activity[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Format a date string to SGT (Asia/Singapore) timestamp. */
function formatDateSGT(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** Badge color for activity actions. */
function getActionBadgeColor(action: string): "green" | "muted" | "cyan" | "yellow" | "red" | "magenta" {
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

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: "cyan" | "magenta" | "green" | "yellow" | "red";
  delay: number;
}

const COLOR_CLASSES = {
  cyan: "text-accent border-accent/30 bg-accent/5",
  magenta: "text-accent-support border-accent-support/30 bg-accent-support/5",
  green: "text-success border-success/30 bg-success/5",
  yellow: "text-warning border-warning/30 bg-warning/5",
  red: "text-danger border-danger/30 bg-danger/5",
} as const;

function StatCard({ label, value, icon, color, delay }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
    >
      <div className={`glass rounded-xl border p-5 ${COLOR_CLASSES[color]}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-body text-xs uppercase tracking-wider text-meta">
              {label}
            </p>
            <p className={`mt-2 font-heading text-3xl font-bold ${COLOR_CLASSES[color].split(" ")[0]}`}>
              {value.toLocaleString()}
            </p>
          </div>
          <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${COLOR_CLASSES[color]}`}>
            {icon}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function DashboardPage() {
  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: async () => {
      const res = await apiGet<AdminStats>("/api/v1/admin/stats");
      return res.data!;
    },
  });

  const {
    data: recentActivities,
    isLoading: activitiesLoading,
    error: activitiesError,
  } = useQuery({
    queryKey: ["admin", "activities", "recent"],
    queryFn: async () => {
      const res = await apiGet<ActivitiesResponse>("/api/v1/admin/activities", {
        pageSize: 5,
      });
      return res.data!;
    },
  });

  const isLoading = statsLoading || activitiesLoading;
  const error = statsError || activitiesError;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-accent-support accent-support">
          Dashboard
        </h1>
        <p className="mt-1 font-body text-meta">
          Platform overview and recent activity
        </p>
      </div>

      {/* Stats Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <Skeleton lines={3} />
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card>
          <div className="py-8 text-center">
            <p className="font-body text-danger">
              {error instanceof Error ? error.message : "Failed to load dashboard data"}
            </p>
          </div>
        </Card>
      ) : stats ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label="Total Users"
            value={stats.totalUsers}
            color="cyan"
            delay={0}
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            }
          />
          <StatCard
            label="Total Skills"
            value={stats.totalSkills}
            color="magenta"
            delay={0.05}
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            }
          />
          <StatCard
            label="Public Skills"
            value={stats.publicSkills}
            color="green"
            delay={0.1}
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            label="Private Skills"
            value={stats.privateSkills}
            color="yellow"
            delay={0.15}
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            }
          />
          <StatCard
            label="Recent Activities"
            value={stats.recentActivities}
            color="red"
            delay={0.2}
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
          />
        </div>
      ) : null}

      {/* Recent Activity */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.25 }}
      >
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold text-accent">
              Recent Activity
            </h2>
            <a
              href="/admin/activities"
              className="font-body text-sm text-meta hover:text-accent transition-colors"
            >
              View all
            </a>
          </div>

          {activitiesLoading ? (
            <Skeleton lines={5} />
          ) : activitiesError ? (
            <div className="py-8 text-center">
              <p className="font-body text-danger">
                {activitiesError instanceof Error
                  ? activitiesError.message
                  : "Failed to load activities"}
              </p>
            </div>
          ) : recentActivities?.items.length === 0 ? (
            <p className="py-8 text-center font-body text-meta">
              No recent activity.
            </p>
          ) : (
            <div className="space-y-3">
              {recentActivities?.items.map((activity) => (
                <div
                  key={activity.id}
                  className="flex flex-col gap-2 rounded-lg border border-accent/10 bg-card p-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <span className="shrink-0 font-body text-xs text-meta">
                    {formatDateSGT(activity.createdAt)}
                  </span>
                  <span className="font-body text-sm text-strong">
                    {activity.userEmail}
                  </span>
                  <Badge color={getActionBadgeColor(activity.action)}>
                    {activity.action}
                  </Badge>
                  {activity.details && Object.keys(activity.details).length > 0 && (
                    <span className="font-body text-sm text-meta">
                      {(activity.details as Record<string, unknown>).skillName as string ?? JSON.stringify(activity.details)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
