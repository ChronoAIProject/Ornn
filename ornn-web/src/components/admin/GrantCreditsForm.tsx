/**
 * GrantCreditsForm — per-user grant for the admin quota detail row.
 *
 * Two integer inputs (playground / skill-gen) + an optional note. Submit
 * fires the appropriate POST(s) — only non-zero amounts result in a
 * grant call, so the form can be used to issue credit on one surface
 * without touching the other.
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
    if ((!pg || pg <= 0) && (!sg || sg <= 0)) {
      addToast({
        type: "warning",
        message: "Enter a positive amount on at least one surface.",
      });
      return;
    }
    try {
      if (pg > 0) {
        await grant.mutateAsync({ userId, surface: "playground", amount: pg, note: note || undefined });
      }
      if (sg > 0) {
        await grant.mutateAsync({ userId, surface: "skillGen", amount: sg, note: note || undefined });
      }
      const summary = [
        pg > 0 ? `+${pg} playground` : null,
        sg > 0 ? `+${sg} skill-gen` : null,
      ]
        .filter(Boolean)
        .join(", ");
      addToast({
        type: "success",
        message: `Granted ${summary} to ${displayName || email}.`,
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
          [§ GRANT — BETA CREDITS]
        </p>
        <p className="mt-1 font-text text-sm text-strong">
          {displayName || email}
        </p>
        <p className="font-mono text-[11px] text-meta">{email}</p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
            Playground credits
          </span>
          <input
            type="number"
            min={0}
            max={100000}
            value={playground}
            onChange={(e) => setPlayground(e.target.value)}
            placeholder="0"
            className="w-full rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
            Skill-gen credits
          </span>
          <input
            type="number"
            min={0}
            max={100000}
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
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason for grant — surfaced in audit trail"
          className="w-full rounded-sm border border-subtle bg-card px-3 py-2 font-text text-sm text-strong focus:border-accent focus:outline-none"
        />
      </label>

      <div className="mt-4 flex justify-end">
        <Button type="submit" loading={grant.isPending} size="sm">
          Grant credits
        </Button>
      </div>
    </form>
  );
}
