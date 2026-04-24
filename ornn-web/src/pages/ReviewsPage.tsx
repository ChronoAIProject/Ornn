/**
 * /reviews — share-request queue for the caller.
 *
 * Backend scopes the list via `/shares/review-queue`: requests that are
 * pending-review where the caller is either the target user, an admin of
 * the target org, or a platform admin. This page just lists them — the
 * actual decision UI lives on `/shares/:requestId` (see ShareRequestPage
 * reviewer block).
 *
 * @module pages/ReviewsPage
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { useShareReviewQueue } from "@/hooks/useShares";
import type { ShareRequest } from "@/types/shares";

function targetLabel(req: ShareRequest): string {
  if (req.target.type === "public") return "Public";
  const prefix = req.target.type === "org" ? "Org" : "User";
  return `${prefix} ${req.target.id ?? ""}`.trim();
}

function verdictTone(verdict?: string): string {
  if (verdict === "green") return "text-neon-cyan";
  if (verdict === "yellow") return "text-neon-yellow";
  if (verdict === "red") return "text-neon-red";
  return "text-text-muted";
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ReviewsPage() {
  const { t } = useTranslation();
  const { data: queue = [], isLoading, isError } = useShareReviewQueue();

  const sorted = useMemo(
    () => [...queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [queue],
  );

  return (
    <PageTransition>
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <header className="mb-6">
          <h1 className="font-heading text-3xl text-text-primary">
            {t("reviews.title", "Review queue")}
          </h1>
          <p className="mt-1 font-body text-sm text-text-muted">
            {t(
              "reviews.subtitle",
              "Share requests awaiting your decision. Click one to see the audit findings and the owner's justifications.",
            )}
          </p>
        </header>

        {isLoading ? (
          <p className="py-16 text-center font-body text-sm text-text-muted">
            {t("reviews.loading", "Loading…")}
          </p>
        ) : isError ? (
          <p className="py-16 text-center font-body text-sm text-neon-red">
            {t("reviews.loadFailed", "Could not load the review queue.")}
          </p>
        ) : sorted.length === 0 ? (
          <div className="rounded-lg border border-neon-cyan/10 bg-bg-surface/30 py-16 text-center">
            <p className="font-body text-sm text-text-muted">
              {t("reviews.empty", "No share requests awaiting your review.")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neon-cyan/10 overflow-hidden rounded-lg border border-neon-cyan/10 bg-bg-surface/30">
            {sorted.map((req) => (
              <li key={req._id}>
                <Link
                  to={`/shares/${encodeURIComponent(req._id)}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-neon-cyan/5 cursor-pointer"
                >
                  <div className="min-w-0 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-neon-yellow/30 bg-neon-yellow/10 px-2 py-0.5 font-heading text-[10px] uppercase tracking-wider text-neon-yellow">
                        {t("reviews.pending", "Pending review")}
                      </span>
                      <span className="font-body text-sm text-text-primary">
                        {t("reviews.target", "To")}: {targetLabel(req)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-xs text-text-muted">
                      <span>
                        {t("reviews.skill", "skill")}: {req.skillGuid.slice(0, 8)}… ·{" "}
                        v{req.skillVersion}
                      </span>
                      {req.auditVerdict && (
                        <span>
                          {t("reviews.audit", "audit")}:{" "}
                          <span className={verdictTone(req.auditVerdict)}>
                            {req.auditVerdict}
                          </span>
                          {typeof req.auditOverallScore === "number" && (
                            <> · {req.auditOverallScore.toFixed(1)}/10</>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="font-mono text-xs text-text-muted">
                      {formatRelative(req.createdAt)}
                    </span>
                    <span className="font-body text-xs text-neon-cyan">
                      {t("reviews.review", "Review →")}
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
