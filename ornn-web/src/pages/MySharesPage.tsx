/**
 * /my-shares — caller's full share-request history.
 *
 * Shows every request the caller initiated, across all statuses:
 * pending-audit / needs-justification / pending-review / accepted /
 * rejected / cancelled. Rows link to the detail page for follow-up.
 *
 * @module pages/MySharesPage
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { BackLink } from "@/components/layout/BackLink";
import { useMyShareRequests } from "@/hooks/useShares";
import type { ShareRequest, ShareStatus } from "@/types/shares";

type StatusFilter = "all" | "active" | "decided";

const STATUS_LABEL: Record<ShareStatus, string> = {
  "pending-audit": "Auditing",
  green: "Green",
  "needs-justification": "Needs justification",
  "pending-review": "Pending review",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<ShareStatus, string> = {
  "pending-audit": "border-neon-cyan/30 bg-neon-cyan/5 text-neon-cyan",
  green: "border-neon-cyan/30 bg-neon-cyan/5 text-neon-cyan",
  "needs-justification": "border-neon-yellow/30 bg-neon-yellow/5 text-neon-yellow",
  "pending-review": "border-neon-yellow/30 bg-neon-yellow/5 text-neon-yellow",
  accepted: "border-neon-cyan/20 bg-neon-cyan/5 text-neon-cyan",
  rejected: "border-neon-red/20 bg-neon-red/5 text-neon-red",
  cancelled: "border-neon-cyan/10 bg-bg-surface/40 text-text-muted",
};

const DECIDED: ReadonlySet<ShareStatus> = new Set([
  "accepted",
  "rejected",
  "cancelled",
]);

function targetLabel(req: ShareRequest): string {
  if (req.target.type === "public") return "Public";
  const prefix = req.target.type === "org" ? "Org" : "User";
  return `${prefix} ${req.target.id ?? ""}`.trim();
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function MySharesPage() {
  const { t } = useTranslation();
  const { data: requests = [], isLoading, isError } = useMyShareRequests();
  const [filter, setFilter] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    const sorted = [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (filter === "active") return sorted.filter((r) => !DECIDED.has(r.status));
    if (filter === "decided") return sorted.filter((r) => DECIDED.has(r.status));
    return sorted;
  }, [requests, filter]);

  return (
    <PageTransition>
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <nav className="mb-4">
          <BackLink label={t("common.back", "Back")} />
        </nav>
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl text-text-primary">
              {t("myShares.title", "My sharing requests")}
            </h1>
            <p className="mt-1 font-body text-sm text-text-muted">
              {t(
                "myShares.subtitle",
                "Every audit-gated share you've initiated — active, decided, and cancelled.",
              )}
            </p>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-neon-cyan/20 bg-bg-surface/40">
            {([
              ["all", t("myShares.filterAll", "All")],
              ["active", t("myShares.filterActive", "Active")],
              ["decided", t("myShares.filterDecided", "Decided")],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 font-body text-sm transition-colors cursor-pointer ${
                  filter === key
                    ? "bg-neon-cyan/15 text-neon-cyan"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {isLoading ? (
          <p className="py-16 text-center font-body text-sm text-text-muted">
            {t("myShares.loading", "Loading…")}
          </p>
        ) : isError ? (
          <p className="py-16 text-center font-body text-sm text-neon-red">
            {t("myShares.loadFailed", "Could not load share requests.")}
          </p>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-neon-cyan/10 bg-bg-surface/30 py-16 text-center">
            <p className="font-body text-sm text-text-muted">
              {filter === "all"
                ? t("myShares.empty", "You haven't initiated any share requests yet.")
                : filter === "active"
                  ? t("myShares.emptyActive", "No active share requests.")
                  : t("myShares.emptyDecided", "No decided share requests yet.")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neon-cyan/10 overflow-hidden rounded-lg border border-neon-cyan/10 bg-bg-surface/30">
            {filtered.map((req) => (
              <li key={req._id}>
                <Link
                  to={`/shares/${encodeURIComponent(req._id)}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-neon-cyan/5 cursor-pointer"
                >
                  <div className="min-w-0 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded border px-2 py-0.5 font-heading text-[10px] uppercase tracking-wider ${STATUS_TONE[req.status]}`}
                      >
                        {STATUS_LABEL[req.status]}
                      </span>
                      <span className="font-body text-sm text-text-primary">
                        {t("myShares.to", "To")}: {targetLabel(req)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-text-muted">
                      <span>
                        {t("myShares.skill", "skill")}: {req.skillGuid.slice(0, 8)}… · v{req.skillVersion}
                      </span>
                      {req.auditVerdict && (
                        <span>
                          {t("myShares.audit", "audit")}: {req.auditVerdict}
                          {typeof req.auditOverallScore === "number" && (
                            <> · {req.auditOverallScore.toFixed(1)}/10</>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="font-mono text-xs text-text-muted">
                      {formatTimestamp(req.createdAt)}
                    </span>
                    <span className="font-body text-xs text-neon-cyan">
                      {t("myShares.view", "View →")}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageTransition>
  );
}
