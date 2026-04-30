/**
 * Admin Users Page.
 * User list with stats and navigation to user skills.
 * @module pages/admin/UsersPage
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { apiGet } from "@/services/apiClient";

/** User summary shape from the API. */
interface UserSummary {
  userId: string;
  email: string;
  displayName: string;
  lastActiveAt: string;
  skillCount: number;
  activityCount: number;
}

interface UsersResponse {
  items: UserSummary[];
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

const PAGE_SIZE = 20;

export function UsersPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "users", page],
    queryFn: async () => {
      const res = await apiGet<UsersResponse>("/api/v1/admin/users", {
        page,
        pageSize: PAGE_SIZE,
      });
      return res.data!;
    },
  });

  const handleUserClick = (userId: string) => {
    navigate(`/admin/skills?userId=${userId}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-accent-support accent-support">
          Users
        </h1>
        <p className="mt-1 font-text text-meta">
          Platform users and their activity
        </p>
      </div>

      {/* Users Table */}
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
              <p className="font-text text-danger">
                {error instanceof Error ? error.message : "Failed to load users"}
              </p>
            </div>
          ) : data?.items.length === 0 ? (
            <p className="py-8 text-center font-text text-meta">
              No users found.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-accent/20">
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      User
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Skills
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Activities
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Last Active
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((user) => (
                    <tr
                      key={user.userId}
                      onClick={() => handleUserClick(user.userId)}
                      className="cursor-pointer border-b border-accent/10 transition-colors hover:bg-elevated/50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-sm font-semibold text-accent">
                            {(user.displayName || user.email).charAt(0).toUpperCase()}
                          </div>
                          <span className="font-text text-sm font-medium text-strong">
                            {user.displayName || "-"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-text text-sm text-meta">
                        {user.email}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color="cyan">{user.skillCount}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color="magenta">{user.activityCount}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-text text-xs text-meta">
                        {user.lastActiveAt ? formatDateSGT(user.lastActiveAt) : "-"}
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
