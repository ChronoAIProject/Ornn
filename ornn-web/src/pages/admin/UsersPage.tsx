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
        <h1 className="font-heading text-2xl font-bold text-neon-magenta neon-magenta">
          Users
        </h1>
        <p className="mt-1 font-body text-text-muted">
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
              <p className="font-body text-neon-red">
                {error instanceof Error ? error.message : "Failed to load users"}
              </p>
            </div>
          ) : data?.items.length === 0 ? (
            <p className="py-8 text-center font-body text-text-muted">
              No users found.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neon-cyan/20">
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
                      User
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
                      Skills
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
                      Activities
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
                      Last Active
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((user) => (
                    <tr
                      key={user.userId}
                      onClick={() => handleUserClick(user.userId)}
                      className="cursor-pointer border-b border-neon-cyan/10 transition-colors hover:bg-bg-elevated/50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-elevated text-sm font-semibold text-neon-cyan">
                            {(user.displayName || user.email).charAt(0).toUpperCase()}
                          </div>
                          <span className="font-body text-sm font-medium text-text-primary">
                            {user.displayName || "-"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-body text-sm text-text-muted">
                        {user.email}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color="cyan">{user.skillCount}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color="magenta">{user.activityCount}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-body text-xs text-text-muted">
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
