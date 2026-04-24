/**
 * /admin/review-history — past review decisions by the caller.
 *
 * Shows every share request where the caller is the recorded reviewer
 * (`reviewerDecision.reviewerUserId`). Complements `/reviews` (pending
 * queue); together they give an org admin / platform admin a full
 * before-and-after view of their review workload.
 *
 * @module pages/admin/ReviewHistoryPage
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { useMyReviewedShareHistory } from "@/hooks/useShares";
import type { ShareRequest } from "@/types/shares";

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

export function ReviewHistoryPage() {
  const { t } = useTranslation();
  const { data: history = [], isLoading, isError } = useMyReviewedShareHistory();

  const sorted = useMemo(
    () =>
      [...history].sort((a, b) => {
        const ad = a.reviewerDecision?.reviewedAt ?? a.updatedAt;
        const bd = b.reviewerDecision?.reviewedAt ?? b.updatedAt;
        return bd.localeCompare(ad);
      }),
    [history],
  );

  return (
    <PageTransition>
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <header className="mb-6">
          <h1 className="font-heading text-3xl text-text-primary">
            {t("reviewHistory.title", "Review history")}
          </h1>
          <p className="mt-1 font-body text-sm text-text-muted">
            {t(
              "reviewHistory.subtitle",
              "Share requests you've accepted or rejected. Use the review queue for anything still pending.",
            )}
          </p>
        </header>

        {isLoading ? (
          <p className="py-16 text-center font-body text-sm text-text-muted">
            {t("reviewHistory.loading", "Loading…")}
          </p>
        ) : isError ? (
          <p className="py-16 text-center font-body text-sm text-neon-red">
            {t("reviewHistory.loadFailed", "Could not load review history.")}
          </p>
        ) : sorted.length === 0 ? (
          <div className="rounded-lg border border-neon-cyan/10 bg-bg-surface/30 py-16 text-center">
            <p className="font-body text-sm text-text-muted">
              {t("reviewHistory.empty", "You haven't reviewed any share requests yet.")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neon-cyan/10 overflow-hidden rounded-lg border border-neon-cyan/10 bg-bg-surface/30">
            {sorted.map((req) => {
              const decision = req.reviewerDecision?.decision;
              const tone =
                decision === "accept"
                  ? "border-neon-cyan/30 bg-neon-cyan/5 text-neon-cyan"
                  : "border-neon-red/30 bg-neon-red/5 text-neon-red";
              return (
                <li key={req._id}>
                  <Link
                    to={`/shares/${encodeURIComponent(req._id)}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-neon-cyan/5 cursor-pointer"
                  >
                    <div className="min-w-0 flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded border px-2 py-0.5 font-heading text-[10px] uppercase tracking-wider ${tone}`}
                        >
                          {decision === "accept"
                            ? t("reviewHistory.accepted", "Accepted")
                            : t("reviewHistory.rejected", "Rejected")}
                        </span>
                        <span className="font-body text-sm text-text-primary">
                          {t("reviewHistory.target", "To")}: {targetLabel(req)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-text-muted">
                        <span>
                          {t("reviewHistory.skill", "skill")}: {req.skillGuid.slice(0, 8)}… · v{req.skillVersion}
                        </span>
                        {req.auditVerdict && (
                          <span>
                            {t("reviewHistory.audit", "audit")}: {req.auditVerdict}
                            {typeof req.auditOverallScore === "number" && (
                              <> · {req.auditOverallScore.toFixed(1)}/10</>
                            )}
                          </span>
                        )}
                      </div>
                      {req.reviewerDecision?.note && (
                        <p className="font-body text-xs text-text-muted italic">
                          "{req.reviewerDecision.note}"
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="font-mono text-xs text-text-muted">
                        {formatTimestamp(
                          req.reviewerDecision?.reviewedAt ?? req.updatedAt,
                        )}
                      </span>
                      <span className="font-body text-xs text-neon-cyan">
                        {t("reviewHistory.view", "Open →")}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageTransition>
  );
}
