/**
 * GrantQuotaModal — single-user grant modal for the admin Quota page.
 *
 * Drives a single `POST /api/v1/admin/quota/grant` for the configured
 * surface. v1 grants apply to the **current calendar month only** —
 * unused capacity does NOT roll over. The disclaimer is mandatory copy
 * and must read literally as specified by Architecture §6.
 *
 * @module components/admin/quota/GrantQuotaModal
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/stores/toastStore";
import { useGrantQuota } from "@/hooks/useQuota";
import type { Surface } from "@/services/quotaApi";
import { translateError } from "@/utils/translateError";

const MAX_AMOUNT = 100_000;
const MAX_NOTE = 500;

const SURFACE_LABEL: Record<Surface, string> = {
  playground: "Playground",
  skillGen: "Skill Generation",
};

export interface GrantQuotaModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-selected surface — defaults from the active tab on QuotaManagementPage. */
  surface: Surface;
  user: { userId: string; email: string; displayName: string } | null;
  onGranted?: () => void;
}

export function GrantQuotaModal({
  isOpen,
  onClose,
  surface,
  user,
  onGranted,
}: GrantQuotaModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Grant ${SURFACE_LABEL[surface]} quota`}
    >
      {/* Keyed on `isOpen` so the form's internal state (amount / note /
          error) resets by construction on each open — no reset effect,
          no cascading render (#888). The outer Modal owns the open/close
          animation, so its AnimatePresence stays stable. */}
      <GrantQuotaForm
        key={isOpen ? "open" : "closed"}
        surface={surface}
        user={user}
        onClose={onClose}
        onGranted={onGranted}
        t={t}
      />
    </Modal>
  );
}

interface GrantQuotaFormProps {
  surface: Surface;
  user: GrantQuotaModalProps["user"];
  onClose: () => void;
  onGranted?: (() => void) | undefined;
  t: ReturnType<typeof useTranslation>["t"];
}

function GrantQuotaForm({ surface, user, onClose, onGranted, t }: GrantQuotaFormProps) {
  const [amountStr, setAmountStr] = useState("10");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const grant = useGrantQuota();
  const addToast = useToastStore((s) => s.addToast);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const n = Number(amountStr);
    if (!Number.isInteger(n) || n <= 0 || n > MAX_AMOUNT) {
      setError(`Amount must be a positive whole number (1..${MAX_AMOUNT.toLocaleString()}).`);
      return;
    }
    if (note.length > MAX_NOTE) {
      setError(`Note must be ${MAX_NOTE} characters or fewer.`);
      return;
    }
    setError(null);
    try {
      await grant.mutateAsync({
        userId: user.userId,
        surface,
        amount: n,
        note: note.trim() || undefined,
      });
      addToast({
        type: "success",
        message: `Granted +${n} ${SURFACE_LABEL[surface]} (current month) to ${user.displayName || user.email}.`,
      });
      onGranted?.();
      onClose();
    } catch (err) {
      setError(translateError(err, "Grant failed"));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
        {user && (
          <div className="rounded border border-subtle bg-elevated/40 p-3">
            <p className="font-text text-sm text-strong">
              {user.displayName || user.email}
            </p>
            <p className="font-mono text-[11px] text-meta">{user.email}</p>
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
            Amount
          </span>
          <input
            type="number"
            min={1}
            max={MAX_AMOUNT}
            step={1}
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
            aria-label={t("aria.grantAmount")}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
            Note (optional, ≤ {MAX_NOTE} chars)
          </span>
          <input
            type="text"
            maxLength={MAX_NOTE}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason for grant — surfaced in audit trail"
            className="rounded-sm border border-subtle bg-card px-3 py-2 font-text text-sm text-strong focus:border-accent focus:outline-none"
          />
        </label>

        {/* Disclaimer copy — Architecture §6.4. Do not soften. */}
        <p
          role="note"
          className="rounded border border-accent-support/40 bg-warning-soft px-3 py-2 font-text text-xs leading-relaxed text-body"
        >
          This grant applies to the current month only and resets on the 1st.
        </p>

        {error && (
          <p
            role="alert"
            className="rounded border border-danger/40 bg-danger-soft px-3 py-2 font-mono text-[11px] text-danger"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            type="submit"
            loading={grant.isPending}
            disabled={!user}
          >
            Grant
          </Button>
        </div>
    </form>
  );
}
