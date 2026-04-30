/**
 * Admin Activities Page.
 * Paginated activity feed with action type filtering.
 * @module pages/admin/ActivitiesPage
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { apiGet } from "@/services/apiClient";

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

/** All possible action types for filtering. */
const ACTION_TYPES = [
  { value: "", label: "All Actions" },
  { value: "login", label: "Login" },
  { value: "logout", label: "Logout" },
  { value: "skill:create", label: "Skill Create" },
  { value: "skill:update", label: "Skill Update" },
  { value: "skill:delete", label: "Skill Delete" },
  { value: "skill:visibility_change", label: "Visibility Change" },
] as const;

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

const PAGE_SIZE = 20;

export function ActivitiesPage() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "activities", page, actionFilter],
    queryFn: async () => {
      const params: Record<string, string | number | undefined> = {
        page,
        pageSize: PAGE_SIZE,
      };
      if (actionFilter) {
        params.action = actionFilter;
      }
      const res = await apiGet<ActivitiesResponse>("/api/v1/admin/activities", params);
      return res.data!;
    },
  });

  const handleActionFilterChange = (value: string) => {
    setActionFilter(value);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-accent-support accent-support">
          Activities
        </h1>
        <p className="mt-1 font-body text-meta">
          Platform activity feed and audit log
        </p>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-4">
        <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
          Filter by Action
        </label>
        <select
          value={actionFilter}
          onChange={(e) => handleActionFilterChange(e.target.value)}
          className="neon-input rounded-lg px-4 py-2 font-body text-sm text-strong bg-elevated border border-accent/20 focus:border-accent/50 outline-none transition-colors"
        >
          {ACTION_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      {/* Activities Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          {isLoading ? (
            <Skeleton lines={10} />
          ) : error ? (
            <div className="py-8 text-center">
              <p className="font-body text-danger">
                {error instanceof Error ? error.message : "Failed to load activities"}
              </p>
            </div>
          ) : data?.items.length === 0 ? (
            <p className="py-8 text-center font-body text-meta">
              No activities found.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-accent/20">
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Time
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      User
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Action
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((activity) => (
                    <tr
                      key={activity.id}
                      className="border-b border-accent/10 transition-colors hover:bg-elevated/50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-body text-xs text-meta">
                        {formatDateSGT(activity.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-elevated text-xs text-meta">
                            {(activity.userDisplayName || activity.userEmail).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-body text-sm text-strong">
                              {activity.userDisplayName || activity.userEmail}
                            </p>
                            {activity.userDisplayName && (
                              <p className="truncate font-body text-xs text-meta">
                                {activity.userEmail}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={getActionBadgeColor(activity.action)}>
                          {activity.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-body text-sm text-meta">
                        {activity.details && Object.keys(activity.details).length > 0
                          ? (activity.details.skillName as string) ?? JSON.stringify(activity.details)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={data.totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
