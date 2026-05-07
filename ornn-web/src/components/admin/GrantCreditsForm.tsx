/**
 * GrantCreditsForm — per-user grant for the admin quota detail row.
 *
 * Two integer inputs (playground / skill-gen) + an optional note. Submit
 * fires the appropriate POST(s) — only non-zero amounts result in a
 * grant call, so the form can be used to issue a grant on one surface
 * without touching the other.
 *
 * Per the v1 quota redefinition, grants apply to the **current calendar
 * month only** and reset on the 1st (UTC). There is no expiry knob.
 *
 * @module components/admin/GrantCreditsForm
 */

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/stores/toastStore";
import { useGrantQuota } from "@/hooks/useQuota";

interface GrantCreditsFormProps {
  userId: string;
  email: string;
  displayName: string;
  /** Called after every successful grant so parents can refresh lists. */
  onGranted?: () => void;
  className?: string;
}

const MAX_AMOUNT = 100_000;
const MAX_NOTE = 500;

export function GrantCreditsForm({
  userId,
  email,
  displayName,
  onGranted,
  className = "",
}: GrantCreditsFormProps) {
  const [playground, setPlayground] = useState("");
  const [skillGen, setSkillGen] = useState("");
  const [note, setNote] = useState("");
  const grant = useGrantQuota();
  const addToast = useToastStore((s) => s.addToast);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pg = Number(playground);
    const sg = Number(skillGen);
    const valid = (n: number) =>
      Number.isInteger(n) && n > 0 && n <= MAX_AMOUNT;
    const pgValid = playground.trim() !== "" && valid(pg);
    const sgValid = skillGen.trim() !== "" && valid(sg);
    if (!pgValid && !sgValid) {
      addToast({
        type: "warning",
        message: `Enter a positive whole number (≤ ${MAX_AMOUNT.toLocaleString()}) on at least one surface.`,
      });
      return;
    }
    try {
      if (pgValid) {
        await grant.mutateAsync({
          userId,
          surface: "playground",
          amount: pg,
          note: note || undefined,
        });
      }
      if (sgValid) {
        await grant.mutateAsync({
          userId,
          surface: "skillGen",
          amount: sg,
          note: note || undefined,
        });
      }
      const summary = [
        pgValid ? `+${pg} playground` : null,
        sgValid ? `+${sg} skill-gen` : null,
      ]
        .filter(Boolean)
        .join(", ");
      addToast({
        type: "success",
        message: `Granted ${summary} to ${displayName || email} (current month only).`,
      });
      setPlayground("");
      setSkillGen("");
      setNote("");
      onGranted?.();
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Grant failed",
      });
    }
  };

  return (
    <form
      onSubmit={submit}
      className={`rounded border border-subtle bg-elevated/40 p-4 ${className}`}
    >
      <header className="mb-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          [§ GRANT — ADD TO CURRENT MONTH]
        </p>
        <p className="mt-1 font-text text-sm text-strong">
          {displayName || email}
        </p>
        <p className="font-mono text-[11px] text-meta">{email}</p>
        <p className="mt-1.5 font-text text-[11px] text-meta">
          Each grant is{" "}
          <span className="font-semibold text-strong">additive</span> and
          applies to the current month only. Unused capacity does NOT roll
          over — every grant resets on the 1st (UTC).
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
            Playground grant
          </span>
          <input
            type="number"
            min={0}
            max={MAX_AMOUNT}
            value={playground}
            onChange={(e) => setPlayground(e.target.value)}
            placeholder="0"
            className="w-full rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
            Skill-gen grant
          </span>
          <input
            type="number"
            min={0}
            max={MAX_AMOUNT}
            value={skillGen}
            onChange={(e) => setSkillGen(e.target.value)}
            placeholder="0"
            className="w-full rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
          Note (optional)
        </span>
        <input
          type="text"
          maxLength={MAX_NOTE}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason for grant — surfaced in audit trail"
          className="w-full rounded-sm border border-subtle bg-card px-3 py-2 font-text text-sm text-strong focus:border-accent focus:outline-none"
        />
      </label>

      <div className="mt-4 flex justify-end">
        <Button type="submit" loading={grant.isPending} size="sm">
          Grant
        </Button>
      </div>
    </form>
  );
}
