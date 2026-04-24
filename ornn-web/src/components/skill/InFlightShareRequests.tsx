/**
 * Inline list of the caller's share requests for the current skill.
 * Renders under the metadata column on `SkillDetailPage`. Each row shows
 * the request's target, status, and offers a Cancel button while the
 * request is still pending.
 *
 * Full detail view (audit findings + justification + reviewer decision)
 * lives at `/shares/:requestId` — this component just links there.
 *
 * @module components/skill/InFlightShareRequests
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCancelShareRequest, useMyShareRequests } from "@/hooks/useShares";
import { CANCELLABLE_STATUSES, type ShareRequest, type ShareStatus } from "@/types/shares";
import { useToastStore } from "@/stores/toastStore";

const STATUS_STYLE: Record<
  ShareStatus,
  { label: string; text: string; bg: string; ring: string }
> = {
  "pending-audit": {
    label: "Auditing",
    text: "text-neon-cyan",
    bg: "bg-neon-cyan/10",
    ring: "border-neon-cyan/30",
  },
  green: {
    label: "Green — awaiting apply",
    text: "text-neon-cyan",
    bg: "bg-neon-cyan/10",
    ring: "border-neon-cyan/30",
  },
  "needs-justification": {
    label: "Needs justification",
    text: "text-neon-yellow",
    bg: "bg-neon-yellow/10",
    ring: "border-neon-yellow/30",
  },
  "pending-review": {
    label: "Pending review",
    text: "text-neon-yellow",
    bg: "bg-neon-yellow/10",
    ring: "border-neon-yellow/30",
  },
  accepted: {
    label: "Accepted",
    text: "text-neon-cyan",
    bg: "bg-neon-cyan/5",
    ring: "border-neon-cyan/20",
  },
  rejected: {
    label: "Rejected",
    text: "text-neon-red",
    bg: "bg-neon-red/5",
    ring: "border-neon-red/20",
  },
  cancelled: {
    label: "Cancelled",
    text: "text-text-muted",
    bg: "bg-bg-surface/40",
    ring: "border-neon-cyan/10",
  },
};

function targetLabel(req: ShareRequest): string {
  if (req.target.type === "public") return "Public";
  if (req.target.type === "org") return `Org ${req.target.id ?? ""}`.trim();
  return `User ${req.target.id ?? ""}`.trim();
}

interface InFlightShareRequestsProps {
  /** Current skill's guid — used to filter the caller's request list. */
  skillGuid: string;
  className?: string;
}

export function InFlightShareRequests({ skillGuid, className }: InFlightShareRequestsProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: requests = [], isLoading } = useMyShareRequests();
  const cancelMutation = useCancelShareRequest();

  const forThisSkill = useMemo(
    () =>
      requests
        .filter((r) => r.skillGuid === skillGuid)
        // Newest first so the active request is always on top.
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [requests, skillGuid],
  );

  if (isLoading || forThisSkill.length === 0) return null;

  const handleCancel = async (req: ShareRequest) => {
    try {
      await cancelMutation.mutateAsync(req._id);
      addToast({
        type: "success",
        message: t("share.cancelled", "Share request cancelled."),
      });
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : t("share.cancelFailed", "Failed to cancel."),
      });
    }
  };

  return (
    <div className={`glass rounded-xl p-5 space-y-3 ${className ?? ""}`}>
      <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
        {t("share.myRequestsHeading", "Your share requests for this skill")}
      </p>
      <ul className="space-y-2">
        {forThisSkill.map((req) => {
          const style = STATUS_STYLE[req.status];
          const canCancel = CANCELLABLE_STATUSES.has(req.status);
          return (
            <li
              key={req._id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border ${style.ring} ${style.bg} px-3 py-2`}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-heading text-[10px] uppercase tracking-wider ${style.text}`}
                  >
                    {style.label}
                  </span>
                  <span className="font-body text-xs text-text-muted truncate">
                    · {targetLabel(req)}
                  </span>
                </div>
                <span className="font-mono text-xs text-text-muted">
                  {new Date(req.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/shares/${req._id}`}
                  className="rounded-md border border-neon-cyan/20 px-2 py-1 font-body text-xs text-text-muted transition-colors hover:text-text-primary"
                >
                  {t("share.viewDetails", "Details")}
                </Link>
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => handleCancel(req)}
                    disabled={cancelMutation.isPending}
                    className="rounded-md border border-neon-red/30 px-2 py-1 font-body text-xs text-neon-red transition-colors hover:bg-neon-red/10 cursor-pointer disabled:opacity-50"
                  >
                    {t("share.cancel", "Cancel")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
