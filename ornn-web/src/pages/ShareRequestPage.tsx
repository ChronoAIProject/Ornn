/**
 * /shares/:requestId — share-request detail + justification form +
 * reviewer accept/reject controls.
 *
 * Access-controlled by the backend (`GET /shares/:requestId` rejects
 * non-owners / non-reviewers). The page shows:
 *   - Audit findings from the cached audit record
 *   - Owner's justification form (while `needs-justification`) → read-only
 *     once submitted
 *   - Reviewer's accept/reject controls (while `pending-review` and the
 *     caller isn't the owner) → read-only decision once recorded
 *
 * @module pages/ShareRequestPage
 */

import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ArrowLeftIcon } from "@/components/icons";
import {
  useCancelShareRequest,
  useReviewShareRequest,
  useShareRequest,
  useSubmitShareJustification,
} from "@/hooks/useShares";
import { useSkillAudit } from "@/hooks/useAudit";
import { useCurrentUser } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import {
  CANCELLABLE_STATUSES,
  type ShareRequest,
  type ShareStatus,
} from "@/types/shares";
import type { AuditFinding } from "@/types/audit";

const STATUS_STYLE: Record<
  ShareStatus,
  { label: string; accent: string; dot: string; ring: string; bg: string }
> = {
  "pending-audit": {
    label: "Auditing",
    accent: "text-neon-cyan",
    dot: "bg-neon-cyan",
    ring: "border-neon-cyan/30",
    bg: "bg-neon-cyan/5",
  },
  green: {
    label: "Green · awaiting apply",
    accent: "text-neon-cyan",
    dot: "bg-neon-cyan",
    ring: "border-neon-cyan/30",
    bg: "bg-neon-cyan/5",
  },
  "needs-justification": {
    label: "Needs justification",
    accent: "text-neon-yellow",
    dot: "bg-neon-yellow",
    ring: "border-neon-yellow/30",
    bg: "bg-neon-yellow/5",
  },
  "pending-review": {
    label: "Pending review",
    accent: "text-neon-yellow",
    dot: "bg-neon-yellow",
    ring: "border-neon-yellow/30",
    bg: "bg-neon-yellow/5",
  },
  accepted: {
    label: "Accepted",
    accent: "text-neon-cyan",
    dot: "bg-neon-cyan",
    ring: "border-neon-cyan/20",
    bg: "bg-neon-cyan/5",
  },
  rejected: {
    label: "Rejected",
    accent: "text-neon-red",
    dot: "bg-neon-red",
    ring: "border-neon-red/20",
    bg: "bg-neon-red/5",
  },
  cancelled: {
    label: "Cancelled",
    accent: "text-text-muted",
    dot: "bg-text-muted",
    ring: "border-neon-cyan/10",
    bg: "bg-bg-surface/40",
  },
};

function targetLabel(req: ShareRequest): string {
  if (req.target.type === "public") return "Public";
  const prefix = req.target.type === "org" ? "Org" : "User";
  return `${prefix} ${req.target.id ?? ""}`.trim();
}

function StatusPill({ status }: { status: ShareStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border ${s.ring} ${s.bg} px-3 py-1`}
    >
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      <span className={`font-heading text-xs uppercase tracking-wider ${s.accent}`}>
        {s.label}
      </span>
    </span>
  );
}

function FindingRow({ f }: { f: AuditFinding }) {
  const severityStyle =
    f.severity === "critical"
      ? "text-neon-red border-neon-red/30 bg-neon-red/5"
      : f.severity === "warning"
        ? "text-neon-yellow border-neon-yellow/30 bg-neon-yellow/5"
        : "text-text-muted border-neon-cyan/15 bg-bg-surface/30";
  return (
    <div className={`flex flex-col gap-1 rounded-lg border px-3 py-2 ${severityStyle}`}>
      <div className="flex items-center gap-2">
        <span className="font-heading text-[10px] uppercase tracking-wider">{f.severity}</span>
        <span className="font-heading text-[10px] uppercase tracking-wider text-text-muted">
          {f.dimension.replace(/_/g, " ")}
        </span>
        {f.file && (
          <span className="font-mono text-xs text-text-muted">
            {f.file}
            {typeof f.line === "number" ? `:${f.line}` : ""}
          </span>
        )}
      </div>
      <p className="font-body text-sm text-text-primary/90">{f.message}</p>
    </div>
  );
}

function JustificationReadonly({
  j,
}: {
  j: NonNullable<ShareRequest["justifications"]>;
}) {
  const { t } = useTranslation();
  const submitted = new Date(j.submittedAt);
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-sm uppercase tracking-wider text-text-primary">
          {t("shareDetail.justificationHeading", "Justifications submitted")}
        </h3>
        <span className="font-mono text-xs text-text-muted">
          {Number.isNaN(submitted.getTime()) ? j.submittedAt : submitted.toLocaleString()}
        </span>
      </div>
      <dl className="space-y-4">
        <div>
          <dt className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-1">
            {t("shareDetail.whyCannotPass", "Why audit can't pass on its own")}
          </dt>
          <dd className="font-body text-sm text-text-primary whitespace-pre-wrap">
            {j.whyCannotPass || <span className="text-text-muted">—</span>}
          </dd>
        </div>
        <div>
          <dt className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-1">
            {t("shareDetail.whySafe", "Why this is still safe")}
          </dt>
          <dd className="font-body text-sm text-text-primary whitespace-pre-wrap">
            {j.whySafe || <span className="text-text-muted">—</span>}
          </dd>
        </div>
        <div>
          <dt className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-1">
            {t("shareDetail.whyShare", "Why this should be shared")}
          </dt>
          <dd className="font-body text-sm text-text-primary whitespace-pre-wrap">
            {j.whyShare || <span className="text-text-muted">—</span>}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function JustificationForm({ request }: { request: ShareRequest }) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const submit = useSubmitShareJustification();

  const [whyCannotPass, setWhyCannotPass] = useState("");
  const [whySafe, setWhySafe] = useState("");
  const [whyShare, setWhyShare] = useState("");

  const canSubmit =
    !submit.isPending &&
    whyCannotPass.trim().length > 0 &&
    whySafe.trim().length > 0 &&
    whyShare.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await submit.mutateAsync({
        requestId: request._id,
        input: {
          whyCannotPass: whyCannotPass.trim(),
          whySafe: whySafe.trim(),
          whyShare: whyShare.trim(),
        },
      });
      addToast({
        type: "success",
        message: t("shareDetail.justificationSubmitted", "Justification submitted."),
      });
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : t("shareDetail.submitFailed", "Could not submit justification."),
      });
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="font-heading text-sm uppercase tracking-wider text-text-primary">
          {t("shareDetail.justificationFormHeading", "Submit justifications")}
        </h3>
        <p className="mt-1 font-body text-sm text-text-muted">
          {t(
            "shareDetail.justificationFormHint",
            "The audit flagged one or more findings. Answer all three prompts so a reviewer can decide whether to accept the share anyway.",
          )}
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        {[
          {
            id: "whyCannotPass",
            label: t("shareDetail.whyCannotPass", "Why audit can't pass on its own"),
            hint: t(
              "shareDetail.whyCannotPassHint",
              "What is the auditor missing? A false-positive explanation, a known limitation, etc.",
            ),
            value: whyCannotPass,
            setter: setWhyCannotPass,
          },
          {
            id: "whySafe",
            label: t("shareDetail.whySafe", "Why this is still safe"),
            hint: t(
              "shareDetail.whySafeHint",
              "What mitigations or context make the risk acceptable?",
            ),
            value: whySafe,
            setter: setWhySafe,
          },
          {
            id: "whyShare",
            label: t("shareDetail.whyShare", "Why this should be shared"),
            hint: t("shareDetail.whyShareHint", "Value to the recipient — why is the trade-off worth it?"),
            value: whyShare,
            setter: setWhyShare,
          },
        ].map((f) => (
          <div key={f.id}>
            <label
              htmlFor={f.id}
              className="mb-1 block font-heading text-[11px] uppercase tracking-wider text-text-muted"
            >
              {f.label} <span className="text-neon-red">*</span>
            </label>
            <textarea
              id={f.id}
              value={f.value}
              onChange={(e) => f.setter(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-neon-cyan/20 bg-bg-surface px-3 py-2 font-body text-sm text-text-primary focus:outline-none focus:border-neon-cyan/60 focus:ring-2 focus:ring-neon-cyan/30"
            />
            <p className="mt-1 font-body text-xs text-text-muted">{f.hint}</p>
          </div>
        ))}
        <div className="flex justify-end">
          <Button type="submit" disabled={!canSubmit} loading={submit.isPending}>
            {t("shareDetail.submit", "Submit for review")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ReviewerActions({ request }: { request: ShareRequest }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const review = useReviewShareRequest();

  const [note, setNote] = useState("");

  const handleDecision = async (decision: "accept" | "reject") => {
    try {
      await review.mutateAsync({
        requestId: request._id,
        input: { decision, note: note.trim() || undefined },
      });
      addToast({
        type: "success",
        message:
          decision === "accept"
            ? t("shareDetail.acceptedToast", "Share accepted.")
            : t("shareDetail.rejectedToast", "Share rejected."),
      });
      // Kick the caller back to their queue; the request will no longer
      // be pending-review there.
      navigate("/reviews");
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : t("shareDetail.reviewFailed", "Review failed."),
      });
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="font-heading text-sm uppercase tracking-wider text-text-primary">
          {t("shareDetail.reviewHeading", "Your decision")}
        </h3>
        <p className="mt-1 font-body text-sm text-text-muted">
          {t(
            "shareDetail.reviewHint",
            "Accept grants access to the target. Reject keeps the skill private. Either decision notifies the owner.",
          )}
        </p>
      </div>
      <div>
        <label
          htmlFor="review-note"
          className="mb-1 block font-heading text-[11px] uppercase tracking-wider text-text-muted"
        >
          {t("shareDetail.reviewNote", "Note (optional)")}
        </label>
        <textarea
          id="review-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-neon-cyan/20 bg-bg-surface px-3 py-2 font-body text-sm text-text-primary focus:outline-none focus:border-neon-cyan/60 focus:ring-2 focus:ring-neon-cyan/30"
          placeholder={
            t(
              "shareDetail.reviewNotePlaceholder",
              "Short explanation shared with the owner.",
            ) as string
          }
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          variant="danger"
          onClick={() => handleDecision("reject")}
          disabled={review.isPending}
          loading={review.isPending && review.variables?.input.decision === "reject"}
        >
          {t("shareDetail.reject", "Reject")}
        </Button>
        <Button
          onClick={() => handleDecision("accept")}
          disabled={review.isPending}
          loading={review.isPending && review.variables?.input.decision === "accept"}
        >
          {t("shareDetail.accept", "Accept")}
        </Button>
      </div>
    </Card>
  );
}

function ReviewerDecisionReadonly({
  decision,
}: {
  decision: NonNullable<ShareRequest["reviewerDecision"]>;
}) {
  const { t } = useTranslation();
  const reviewed = new Date(decision.reviewedAt);
  const tone =
    decision.decision === "accept"
      ? { ring: "border-neon-cyan/30", bg: "bg-neon-cyan/5", text: "text-neon-cyan" }
      : { ring: "border-neon-red/30", bg: "bg-neon-red/5", text: "text-neon-red" };
  return (
    <Card className={`space-y-2 border p-5 ${tone.ring} ${tone.bg}`}>
      <div className="flex items-center justify-between">
        <span className={`font-heading text-xs uppercase tracking-wider ${tone.text}`}>
          {decision.decision === "accept"
            ? t("shareDetail.accepted", "Accepted")
            : t("shareDetail.rejected", "Rejected")}
        </span>
        <span className="font-mono text-xs text-text-muted">
          {Number.isNaN(reviewed.getTime()) ? decision.reviewedAt : reviewed.toLocaleString()}
        </span>
      </div>
      {decision.note && (
        <p className="font-body text-sm text-text-primary whitespace-pre-wrap">
          {decision.note}
        </p>
      )}
      <p className="font-mono text-xs text-text-muted">
        {t("shareDetail.reviewedBy", "by")} {decision.reviewerUserId}
      </p>
    </Card>
  );
}

export function ShareRequestPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { requestId } = useParams<{ requestId: string }>();
  const currentUser = useCurrentUser();
  const addToast = useToastStore((s) => s.addToast);

  const { data: request, isLoading, isError, error } = useShareRequest(requestId);
  const audit = useSkillAudit(request?.skillGuid, { version: request?.skillVersion });
  const cancel = useCancelShareRequest();

  // Reset to top on load; long pages + React Router don't do this by default.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [requestId]);

  if (isLoading) {
    return (
      <PageTransition>
        <div className="mx-auto w-full max-w-3xl px-6 py-10">
          <Skeleton lines={8} />
        </div>
      </PageTransition>
    );
  }

  if (isError || !request) {
    return (
      <PageTransition>
        <div className="mx-auto w-full max-w-3xl px-6 py-10 text-center">
          <h1 className="font-heading text-2xl text-neon-red">
            {t("shareDetail.notFound", "Share request not found")}
          </h1>
          <p className="mt-2 font-body text-sm text-text-muted">
            {error instanceof Error
              ? error.message
              : t(
                  "shareDetail.notFoundHint",
                  "The request may have been cancelled or you don't have access to it.",
                )}
          </p>
          <Button className="mt-6" onClick={() => navigate(-1)}>
            {t("common.back", "Back")}
          </Button>
        </div>
      </PageTransition>
    );
  }

  const isOwner = Boolean(currentUser && currentUser.id === request.ownerUserId);
  const canCancel = isOwner && CANCELLABLE_STATUSES.has(request.status);
  const showJustificationForm = isOwner && request.status === "needs-justification";
  const created = new Date(request.createdAt);
  const updated = new Date(request.updatedAt);

  const handleCancel = async () => {
    if (!requestId) return;
    try {
      await cancel.mutateAsync(requestId);
      addToast({
        type: "success",
        message: t("shareDetail.cancelled", "Share request cancelled."),
      });
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : t("shareDetail.cancelFailed", "Could not cancel."),
      });
    }
  };

  return (
    <PageTransition>
      <div className="mx-auto w-full max-w-3xl px-6 py-8 space-y-6">
        <Link
          to={`/skills/${encodeURIComponent(request.skillGuid)}`}
          className="inline-flex items-center gap-2 font-body text-sm text-text-muted transition-colors hover:text-text-primary"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {t("shareDetail.backToSkill", "Back to skill")}
        </Link>

        {/* Header */}
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-2xl text-text-primary">
              {t("shareDetail.title", "Share request")}
            </h1>
            <StatusPill status={request.status} />
            {canCancel && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancel.isPending}
                className="ml-auto rounded-lg border border-neon-red/30 px-3 py-1 font-body text-sm text-neon-red transition-colors hover:bg-neon-red/10 cursor-pointer disabled:opacity-50"
              >
                {cancel.isPending
                  ? t("shareDetail.cancelling", "Cancelling…")
                  : t("shareDetail.cancel", "Cancel request")}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
                {t("shareDetail.target", "Target")}
              </span>
              <p className="font-body text-text-primary">{targetLabel(request)}</p>
            </div>
            <div>
              <span className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
                {t("shareDetail.skillVersion", "Skill version")}
              </span>
              <p className="font-mono text-text-primary">v{request.skillVersion}</p>
            </div>
            <div>
              <span className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
                {t("shareDetail.created", "Created")}
              </span>
              <p className="font-mono text-text-primary">
                {Number.isNaN(created.getTime()) ? request.createdAt : created.toLocaleString()}
              </p>
            </div>
            <div>
              <span className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
                {t("shareDetail.updated", "Updated")}
              </span>
              <p className="font-mono text-text-primary">
                {Number.isNaN(updated.getTime()) ? request.updatedAt : updated.toLocaleString()}
              </p>
            </div>
          </div>
        </header>

        {/* Audit findings */}
        <Card className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-sm uppercase tracking-wider text-text-primary">
              {t("shareDetail.auditHeading", "Audit findings")}
            </h2>
            {request.auditVerdict && (
              <span className="font-mono text-sm text-text-muted">
                verdict: <span className="text-text-primary">{request.auditVerdict}</span>
                {typeof request.auditOverallScore === "number" && (
                  <>
                    {" "}· score:{" "}
                    <span className="text-text-primary">
                      {request.auditOverallScore.toFixed(1)} / 10
                    </span>
                  </>
                )}
              </span>
            )}
          </div>
          {audit.isLoading ? (
            <Skeleton lines={3} />
          ) : !audit.data ? (
            <p className="font-body text-sm text-text-muted">
              {t(
                "shareDetail.auditUnavailable",
                "Audit record not available yet. If the audit is still running, refresh in a moment.",
              )}
            </p>
          ) : audit.data.findings.length === 0 ? (
            <p className="font-body text-sm text-text-muted">
              {t("shareDetail.noFindings", "No findings — audit was clean.")}
            </p>
          ) : (
            <div className="space-y-2">
              {audit.data.findings.map((f, idx) => (
                <FindingRow key={`${f.dimension}-${idx}`} f={f} />
              ))}
            </div>
          )}
        </Card>

        {/* Justifications — form for owner on needs-justification; readonly once submitted */}
        {showJustificationForm ? (
          <JustificationForm request={request} />
        ) : request.justifications ? (
          <JustificationReadonly j={request.justifications} />
        ) : null}

        {/* Reviewer controls — shown for non-owners when the request is
            pending review. The backend re-checks authorization; we just
            gate on obvious signals client-side to avoid showing controls
            to the owner. */}
        {request.status === "pending-review" && !isOwner && (
          <ReviewerActions request={request} />
        )}

        {/* Reviewer decision (read-only once recorded) */}
        {request.reviewerDecision && (
          <ReviewerDecisionReadonly decision={request.reviewerDecision} />
        )}
      </div>
    </PageTransition>
  );
}
