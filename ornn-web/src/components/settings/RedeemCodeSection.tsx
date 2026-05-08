/**
 * RedeemCodeSection — caller-facing redeem form for the Settings page.
 *
 * Single text input + submit. Per-error-code messaging maps the
 * backend `code` to a user-facing line so the user knows whether to
 * retype, contact admin, or accept the code is gone. On success we
 * show a green panel listing the per-surface grants and clear it
 * after 8s.
 *
 * Optional "Recently redeemed" section uses
 * `useMyRedemptionHistory` and only renders when the list is
 * non-empty.
 *
 * @module components/settings/RedeemCodeSection
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { ApiClientError } from "@/services/apiClient";
import {
  useMyRedemptionHistory,
  useRedeemCode,
} from "@/hooks/useRedemptionCodes";
import type {
  RedeemAppliedGrant,
  RedemptionHistoryItem,
  Surface,
} from "@/services/redemptionCodesApi";

const SURFACE_LABEL: Record<Surface, string> = {
  playground: "Playground",
  skillGen: "Skill generation",
};

const ERROR_MESSAGES: Record<string, string> = {
  REDEMPTION_CODE_NOT_FOUND: "Code not found. Double-check the spelling.",
  REDEMPTION_CODE_EXPIRED: "This code has expired.",
  REDEMPTION_CODE_INVALIDATED:
    "This code has been revoked. Contact admin if you think this is wrong.",
  REDEMPTION_CODE_ALREADY_REDEEMED:
    "This code has already been used. Each code is single-use.",
};

const DEFAULT_ERROR =
  "Couldn't redeem this code. Please try again or contact admin.";

const SUCCESS_AUTO_CLEAR_MS = 8_000;

function formatGrantSummary(grants: RedeemAppliedGrant[]): string {
  return grants
    .map((g) => `${SURFACE_LABEL[g.surface]} +${g.amount.toLocaleString("en-US")}`)
    .join(", ");
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function HistoryRow({ item }: { item: RedemptionHistoryItem }) {
  const summary = item.grants
    .map(
      (g) => `${SURFACE_LABEL[g.surface]} +${g.amount.toLocaleString("en-US")}`,
    )
    .join(", ");
  return (
    <li className="flex flex-col gap-1 rounded-sm border border-subtle bg-elevated/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-mono text-[11px] text-strong">{item.code}</p>
        <p className="font-text text-xs text-body">{summary}</p>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        {formatDateTime(item.redeemedAt)}
      </p>
    </li>
  );
}

export function RedeemCodeSection() {
  const [value, setValue] = useState("");
  const [success, setSuccess] = useState<RedeemAppliedGrant[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const redeem = useRedeemCode();
  const history = useMyRedemptionHistory({ page: 1, pageSize: 5 });
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  const clearSuccessTimer = () => {
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess(null);
    setErrorMsg(null);
    clearSuccessTimer();

    const trimmed = value.trim();
    if (!trimmed) {
      setErrorMsg("Enter a code to redeem.");
      return;
    }

    try {
      const result = await redeem.mutateAsync(trimmed);
      setSuccess(result.grants);
      setValue("");
      successTimerRef.current = setTimeout(() => {
        setSuccess(null);
        successTimerRef.current = null;
      }, SUCCESS_AUTO_CLEAR_MS);
    } catch (err) {
      let code: string | undefined;
      if (err instanceof ApiClientError) {
        code = err.code;
      }
      setErrorMsg(
        (code && ERROR_MESSAGES[code]) ||
          (err instanceof Error && err.message
            ? ERROR_MESSAGES[err.message] ?? DEFAULT_ERROR
            : DEFAULT_ERROR),
      );
    }
  };

  const dismissSuccess = () => {
    clearSuccessTimer();
    setSuccess(null);
  };

  const showInitialHelp = !success && !errorMsg && !redeem.isPending;
  const historyItems = history.data?.items ?? [];

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05 }}
      className="bg-card rounded border border-accent/20 p-6"
      aria-labelledby="redeem-code-heading"
    >
      <h3
        id="redeem-code-heading"
        className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-strong"
      >
        Redeem code
      </h3>

      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ENTER YOUR CODE"
          aria-label="Redemption code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          className="flex-1 rounded-sm border border-subtle bg-elevated/40 px-3 py-2 font-mono text-sm uppercase tracking-[0.12em] text-strong placeholder:text-meta/70 focus:border-accent focus:bg-card focus:outline-none"
        />
        <Button
          size="md"
          type="submit"
          loading={redeem.isPending}
          disabled={value.trim().length === 0}
        >
          Redeem
        </Button>
      </form>

      <div className="mt-4">
        {showInitialHelp && (
          <p className="font-text text-sm text-meta">
            Got a code from the team? Enter it here to add quota to your
            account.
          </p>
        )}

        {success && (
          <div
            role="status"
            className="flex items-start justify-between gap-3 rounded border border-success/40 bg-success-soft px-3 py-3"
          >
            <div className="font-text text-sm text-body">
              <p>
                <span className="font-semibold text-success">Added:</span>{" "}
                {formatGrantSummary(success)}.
              </p>
              <p className="mt-1 text-meta">Active until end of month.</p>
            </div>
            <button
              type="button"
              onClick={dismissSuccess}
              aria-label="Dismiss"
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta hover:text-strong"
            >
              Dismiss
            </button>
          </div>
        )}

        {errorMsg && (
          <p
            role="alert"
            className="rounded border border-danger/40 bg-danger-soft px-3 py-2 font-text text-sm text-danger"
          >
            {errorMsg}
          </p>
        )}
      </div>

      {historyItems.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
            Recently redeemed
          </h4>
          <ul className="space-y-1.5">
            {historyItems.map((item) => (
              <HistoryRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
    </motion.section>
  );
}
