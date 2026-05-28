/**
 * AdminUsersTable — sortable, paginated, searchable user list.
 *
 * Six columns: username (= displayName), email, #skills, last active,
 * #activities, first joined. Per-row "Grant quota" CTA deep-links to
 * /admin/quota. Used by both Admin Users + Normal Users sections via the
 * `role` prop.
 *
 * @module components/admin/AdminUsersTable
 */

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import { useDebounce } from "@/hooks/useDebounce";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAdminUsers,
  type AdminUserRole,
  type AdminUsersSort,
  type AdminUserRow,
} from "@/services/adminUsersApi";
import { translateError } from "@/utils/translateError";

const PAGE_SIZE = 20;

interface AdminUsersTableProps {
  role: AdminUserRole;
  /** Section title rendered above the table. */
  title: string;
  /** Optional sub-copy under the title. */
  description?: string;
}

type ColumnDef = {
  id: keyof AdminUserRow | "actions";
  label: string;
  sortAsc?: AdminUsersSort;
  sortDesc?: AdminUsersSort;
  align?: "left" | "right";
};

function formatDateUTC(iso: string | null, nullLabel: string): string {
  if (!iso) return nullLabel;
  try {
    return new Date(iso).toLocaleDateString("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AdminUsersTable({ role, title, description }: AdminUsersTableProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);
  const [sort, setSort] = useState<AdminUsersSort>("lastActiveAt:desc");

  // COLUMNS rebuild per-`t` so column headers + sort aria labels
  // follow the active UI language (#697).
  const COLUMNS = useMemo<ColumnDef[]>(() => [
    { id: "displayName", label: t("adminUsersTable.columnUsername"), sortAsc: "displayName:asc", sortDesc: "displayName:desc" },
    { id: "email", label: t("adminUsersTable.columnEmail"), sortAsc: "email:asc", sortDesc: "email:desc" },
    { id: "skillCount", label: t("adminUsersTable.columnSkills"), sortAsc: "skillCount:asc", sortDesc: "skillCount:desc", align: "right" },
    { id: "lastActiveAt", label: t("adminUsersTable.columnLastActive"), sortAsc: "lastActiveAt:asc", sortDesc: "lastActiveAt:desc", align: "right" },
    { id: "activityCount", label: t("adminUsersTable.columnActivities"), sortAsc: "activityCount:asc", sortDesc: "activityCount:desc", align: "right" },
    { id: "firstJoinedAt", label: t("adminUsersTable.columnFirstJoined"), sortAsc: "firstJoinedAt:asc", sortDesc: "firstJoinedAt:desc", align: "right" },
    { id: "actions", label: "", align: "right" },
  ], [t]);

  const usersQuery = useQuery({
    queryKey: ["admin", "users", role, debounced, page, sort] as const,
    queryFn: () =>
      fetchAdminUsers({
        role,
        q: debounced || undefined,
        page,
        pageSize: PAGE_SIZE,
        sort,
      }),
    staleTime: 15_000,
  });

  const items = usersQuery.data?.items ?? [];
  const totalPages = usersQuery.data?.totalPages ?? 1;

  const toggleSort = (col: ColumnDef) => {
    if (!col.sortAsc || !col.sortDesc) return;
    if (sort === col.sortDesc) setSort(col.sortAsc);
    else setSort(col.sortDesc);
    setPage(1);
  };

  return (
    <section aria-label={title} className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold uppercase tracking-tight text-strong">
            {title}
          </h2>
          {description && (
            <p className="font-text text-xs text-meta">{description}</p>
          )}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder={t("adminUsersTable.filterPlaceholder")}
          aria-label={`Filter ${title}`}
          className="w-full max-w-xs rounded-sm border border-subtle bg-elevated/40 px-3 py-2 font-mono text-xs text-strong placeholder:text-meta/70 focus:border-accent focus:bg-card focus:outline-none"
        />
      </header>

      <Card>
        {usersQuery.isLoading ? (
          <Skeleton lines={6} />
        ) : usersQuery.error ? (
          <p className="py-8 text-center font-text text-danger">
            {translateError(usersQuery.error, "Failed to load users")}
          </p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center font-text text-meta">{t("adminUsersTable.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-accent/20">
                  {COLUMNS.map((col) => {
                    const sortable = Boolean(col.sortAsc && col.sortDesc);
                    const isAsc = sortable && sort === col.sortAsc;
                    const isDesc = sortable && sort === col.sortDesc;
                    return (
                      <th
                        key={col.id}
                        scope="col"
                        className={`px-4 py-3 ${col.align === "right" ? "text-right" : "text-left"} font-mono text-[10px] uppercase tracking-[0.14em] text-meta`}
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col)}
                            aria-label={t("adminUsersTable.sortByPrefix", { label: col.label })}
                            className={`inline-flex items-center gap-1 hover:text-accent ${
                              isAsc || isDesc ? "text-strong" : ""
                            }`}
                          >
                            {col.label}
                            {isAsc ? <span aria-hidden>▲</span> : null}
                            {isDesc ? <span aria-hidden>▼</span> : null}
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr
                    key={u.userId}
                    className="border-b border-accent/10 hover:bg-elevated/40"
                  >
                    <td className="px-4 py-3 font-text text-sm text-strong">
                      {u.displayName || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-meta">
                      {u.email}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] text-body">
                      {u.skillCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[11px] text-meta">
                      {formatDateUTC(u.lastActiveAt, t("adminUsersTable.never"))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] text-body">
                      {u.activityCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[11px] text-meta">
                      {formatDateUTC(u.firstJoinedAt, "—")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/admin/quota?userId=${encodeURIComponent(u.userId)}&surface=playground`}
                        className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent hover:text-accent-muted"
                      >
                        {t("adminUsersTable.grantQuota")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      )}
    </section>
  );
}
