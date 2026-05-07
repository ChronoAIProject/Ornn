/**
 * BulkGrantCreditsModal — dispatches `+N credits` to every selected
 * user on a chosen surface in one POST.
 *
 * Backend caps payloads at 500 user ids — the modal disables submission
 * past that ceiling and surfaces a single error message instead of
 * silently truncating.
 *
 * @module components/admin/BulkGrantCreditsModal
 */

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/stores/toastStore";
import { useBulkGrantQuota } from "@/hooks/useQuota";
import type { Surface } from "@/services/quotaApi";

const MAX_USERS = 500;

interface BulkGrantCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userIds: string[];
  /** Optional human label — "12 selected users". Falls back to count. */
  selectionLabel?: string;
}

export function BulkGrantCreditsModal({
  isOpen,
  onClose,
  userIds,
  selectionLabel,
}: BulkGrantCreditsModalProps) {
  const [surface, setSurface] = useState<Surface>("playground");
  const [amount, setAmount] = useState("10");
  const [note, setNote] = useState("");
  const grant = useBulkGrantQuota();
  const addToast = useToastStore((s) => s.addToast);

  const tooMany = userIds.length > MAX_USERS;
  const empty = userIds.length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0 || n > 100_000) {
      addToast({
        type: "warning",
        message: "Enter a positive whole number ≤ 100,000.",
      });
      return;
    }
    if (tooMany) {
      addToast({
        type: "error",
        message: `Cannot grant in one batch — ${userIds.length} selected, ${MAX_USERS} max.`,
      });
      return;
    }
    if (empty) return;
    try {
      const out = await grant.mutateAsync({
        userIds,
        surface,
        amount: n,
        note: note || undefined,
      });
      addToast({
        type: "success",
        message: `Granted +${n} ${surface === "playground" ? "playground" : "skill-gen"} (current month only) to ${out.applied}/${out.requested} users.`,
      });
      onClose();
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Bulk grant failed",
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Grant to selected">
      <form onSubmit={submit} className="space-y-4">
        <p className="font-text text-sm text-body">
          Grant to{" "}
          <strong className="text-strong">
            {selectionLabel ?? `${userIds.length} selected user${userIds.length === 1 ? "" : "s"}`}
          </strong>
          . Each grant is <strong className="text-strong">additive</strong> and
          stacks on top of the recipient's existing current-month grant.
        </p>

        {tooMany && (
          <div className="rounded border border-danger/40 bg-danger-soft px-3 py-2 font-mono text-[11px] text-danger">
            Selection exceeds {MAX_USERS}-user batch limit. Trim before granting.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Surface
            </span>
            <select
              value={surface}
              onChange={(e) => setSurface(e.target.value as Surface)}
              className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
            >
              <option value="playground">Playground</option>
              <option value="skillGen">Skill Generation</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Amount per user
            </span>
            <input
              type="number"
              min={1}
              max={100000}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
            />
          </label>
        </div>

        <p className="rounded border border-subtle bg-elevated/40 px-3 py-2 font-mono text-[10px] text-meta">
          Grants apply to the current calendar month only and reset on
          the 1st (UTC). There is no expiry knob.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
            Note (optional)
          </span>
          <input
            type="text"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason for grant — surfaced in audit trail"
            className="rounded-sm border border-subtle bg-card px-3 py-2 font-text text-sm text-strong focus:border-accent focus:outline-none"
          />
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            size="sm"
            type="submit"
            loading={grant.isPending}
            disabled={tooMany || empty}
          >
            Grant
          </Button>
        </div>
      </form>
    </Modal>
  );
}
