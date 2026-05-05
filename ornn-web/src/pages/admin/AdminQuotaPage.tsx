/**
 * Admin Quota page (#250).
 *
 * Lists the same user pool the existing /admin/users page uses (driven
 * off the activity index) and decorates each row with both surfaces'
 * counters. Two interaction modes:
 *
 *  - per-row "Grant" expand: opens GrantCreditsForm inline so the admin
 *    doesn't lose context for adjacent rows.
 *  - selection + "Grant credits to selected" CTA: bulk grant via modal.
 *
 * Below the user table, the audit-trail card shows the latest 50
 * grants (admin, target, surface, amount, time, note) so admins can
 * verify what was issued.
 *
 * @module pages/admin/AdminQuotaPage
 */

import { Fragment, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import { GrantCreditsForm } from "@/components/admin/GrantCreditsForm";
import { BulkGrantCreditsModal } from "@/components/admin/BulkGrantCreditsModal";
import {
  useAdminQuotaGrants,
  useAdminQuotaUsers,
} from "@/hooks/useQuota";
import { useDebounce } from "@/hooks/useDebounce";

const PAGE_SIZE = 20;

function formatDateSGT(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-SG", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AdminQuotaPage() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const usersQuery = useAdminQuotaUsers({
    page,
    pageSize: PAGE_SIZE,
    q: debouncedQuery || undefined,
  });
  const auditQuery = useAdminQuotaGrants({ page: 1, pageSize: 50 });

  const items = usersQuery.data?.items ?? [];
  const totalPages = usersQuery.data?.totalPages ?? 1;

  const toggleSelected = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  // Admin rows are excluded from selection — granting credits to an
  // admin (who already bypasses the counter) is meaningless. Both the
  // per-row checkbox and the "Select page" header skip them.
  const grantableItems = items.filter((u) => !u.isAdmin);
  const allOnPageSelected =
    grantableItems.length > 0 &&
    grantableItems.every((u) => selectedIds.has(u.userId));

  const togglePage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        grantableItems.forEach((u) => next.delete(u.userId));
      } else {
        grantableItems.forEach((u) => next.add(u.userId));
      }
      return next;
    });
  };

  const selectedArr = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const usersError = usersQuery.error;
  const auditError = auditQuery.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-strong">
            Quota
          </h1>
          <p className="mt-1 font-text text-meta">
            Per-user playground and skill-gen counters with admin-granted credits.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta">
            {selectedIds.size} selected
          </span>
          <Button
            size="sm"
            disabled={selectedIds.size === 0}
            onClick={() => setBulkOpen(true)}
          >
            Grant credits to selected
          </Button>
        </div>
      </div>

      {/* Admin self-quota banner — admins bypass the counter on the
          backend; surface that here so the page reads unambiguously as
          "manage other users' quotas, your own is unlimited". */}
      <div
        role="status"
        className="flex items-center gap-3 rounded border border-accent/30 bg-accent/5 px-4 py-3"
      >
        <svg
          className="h-4 w-4 shrink-0 text-accent"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14" />
          <path d="M19 5v14" />
        </svg>
        <div className="flex-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
            Admin · Unlimited
          </p>
          <p className="mt-0.5 font-text text-xs leading-relaxed text-body">
            Your own playground and skill-gen usage bypasses every counter and
            ceiling. This page manages quota for everyone else.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Filter by email…"
          className="w-full max-w-sm rounded-sm border border-subtle bg-elevated/40 px-3 py-2 font-mono text-xs text-strong placeholder:text-meta/70 focus:border-accent focus:outline-none focus:bg-card"
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          {usersQuery.isLoading ? (
            <Skeleton lines={8} />
          ) : usersError ? (
            <p className="py-8 text-center font-text text-danger">
              {usersError instanceof Error
                ? usersError.message
                : "Failed to load users"}
            </p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center font-text text-meta">
              No users match.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-accent/20">
                    <th className="px-3 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={togglePage}
                        aria-label="Select page"
                        className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-accent-primary)]"
                      />
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      User
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Playground · used / limit · +bonus
                    </th>
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Skill-gen · used / limit · +bonus
                    </th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((u) => {
                    const expanded = expandedUserId === u.userId;
                    return (
                      <Fragment key={u.userId}>
                        <tr className="border-b border-accent/10 hover:bg-elevated/40">
                          <td className="px-3 py-3">
                            {u.isAdmin ? (
                              // Admins can't be selected — bulk grant skips them.
                              <span className="inline-block h-3.5 w-3.5" aria-hidden />
                            ) : (
                              <input
                                type="checkbox"
                                checked={selectedIds.has(u.userId)}
                                onChange={() => toggleSelected(u.userId)}
                                aria-label={`Select ${u.email}`}
                                className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-accent-primary)]"
                              />
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <p className="font-text text-sm text-strong">
                                {u.displayName || "—"}
                              </p>
                              {u.isAdmin && (
                                <span
                                  title="Admin · ornn:admin:skill"
                                  className="inline-flex items-center gap-1 rounded-sm border border-accent/40 bg-accent/5 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-accent"
                                >
                                  Admin
                                </span>
                              )}
                            </div>
                            <p className="font-mono text-[11px] text-meta">
                              {u.email}
                            </p>
                          </td>
                          {u.isAdmin ? (
                            <td
                              colSpan={2}
                              className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-accent"
                            >
                              <span className="inline-flex items-center gap-2">
                                <svg
                                  className="h-3 w-3"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden
                                >
                                  <path d="M5 12h14" />
                                  <path d="M19 5v14" />
                                </svg>
                                Unlimited — quota bypassed for both surfaces
                              </span>
                            </td>
                          ) : (
                            <>
                              <td className="px-4 py-3 font-mono text-[12px] text-strong">
                                <span title="Used / monthly base limit">
                                  {u.playground.monthlyUsed}
                                  <span className="text-meta">
                                    {" "}/ {u.playground.monthlyLimit}
                                  </span>
                                </span>
                                <span className="text-meta opacity-60">{" · "}</span>
                                <span
                                  className="text-meta"
                                  title="Daily used / daily ceiling"
                                >
                                  d {u.playground.dailyUsed}/{u.playground.dailyLimit}
                                </span>
                                <span className="text-meta opacity-60">{" · "}</span>
                                <span
                                  className="text-accent"
                                  title="Active granted bonus credits"
                                >
                                  +{u.playground.creditsBalance}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-mono text-[12px] text-strong">
                                <span title="Used / monthly base limit">
                                  {u.skillGen.monthlyUsed}
                                  <span className="text-meta">
                                    {" "}/ {u.skillGen.monthlyLimit}
                                  </span>
                                </span>
                                <span className="text-meta opacity-60">{" · "}</span>
                                <span
                                  className="text-meta"
                                  title="Daily used / daily ceiling"
                                >
                                  d {u.skillGen.dailyUsed}/{u.skillGen.dailyLimit}
                                </span>
                                <span className="text-meta opacity-60">{" · "}</span>
                                <span
                                  className="text-accent"
                                  title="Active granted bonus credits"
                                >
                                  +{u.skillGen.creditsBalance}
                                </span>
                              </td>
                            </>
                          )}
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            {u.isAdmin ? (
                              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta/60">
                                —
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedUserId(expanded ? null : u.userId)
                                }
                                className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent hover:text-accent-muted"
                              >
                                {expanded ? "Close" : "Grant"}
                              </button>
                            )}
                          </td>
                        </tr>
                        {expanded && !u.isAdmin && (
                          <tr className="border-b border-accent/10 bg-elevated/20">
                            <td />
                            <td colSpan={4} className="px-4 py-4">
                              <GrantCreditsForm
                                userId={u.userId}
                                email={u.email}
                                displayName={u.displayName}
                                onGranted={() => {
                                  setExpandedUserId(null);
                                }}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </motion.div>

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        <Card>
          <header className="mb-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
              [§ AUDIT TRAIL]
            </p>
            <h2 className="mt-1 font-display text-lg font-semibold uppercase tracking-tight text-strong">
              Recent grants
            </h2>
          </header>
          {auditQuery.isLoading ? (
            <Skeleton lines={4} />
          ) : auditError ? (
            <p className="py-4 text-center font-text text-danger">
              {auditError instanceof Error
                ? auditError.message
                : "Failed to load audit trail"}
            </p>
          ) : (auditQuery.data?.items.length ?? 0) === 0 ? (
            <p className="py-4 text-center font-text text-meta">
              No grants recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-accent/20">
                    <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      When
                    </th>
                    <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Admin
                    </th>
                    <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Target
                    </th>
                    <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Surface
                    </th>
                    <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Amount
                    </th>
                    <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Note
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {auditQuery.data?.items.map((row) => (
                    <tr key={row._id} className="border-b border-accent/10">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[11px] text-meta">
                        {formatDateSGT(row.createdAt)}
                      </td>
                      <td className="px-4 py-2 font-text text-xs text-strong">
                        {row.adminDisplayName || row.adminEmail || row.adminUserId}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-meta">
                        {row.targetUserId}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-strong">
                        {row.surface === "playground" ? "playground" : "skill-gen"}
                      </td>
                      <td className="px-4 py-2 font-mono text-[12px] text-accent">
                        +{row.amount}
                      </td>
                      <td className="px-4 py-2 font-text text-xs text-body">
                        {row.note || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </motion.div>

      <BulkGrantCreditsModal
        isOpen={bulkOpen}
        onClose={() => setBulkOpen(false)}
        userIds={selectedArr}
      />
    </div>
  );
}
