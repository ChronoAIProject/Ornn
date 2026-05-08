/**
 * MintRedemptionCodeModal — admin form to mint a single redemption code.
 *
 * After the POST succeeds we DON'T close the modal: the generated code
 * is the whole point and the admin needs to copy it before dismissing.
 * The modal swaps to a "success" state showing the code in a large copy
 * card with a single "Done" CTA.
 *
 * Form rules (mirror backend zod):
 *   - 1..2 grants, no duplicate surfaces
 *   - amount is positive integer ≤ 100,000
 *   - note ≤ 500 chars (optional)
 *   - expiresAt must be > now
 *
 * @module components/admin/redemption-codes/MintRedemptionCodeModal
 */

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/stores/toastStore";
import { useMintCode } from "@/hooks/useRedemptionCodes";
import type {
  MintCodeRequest,
  RedemptionCode,
  Surface,
} from "@/services/redemptionCodesApi";

const MAX_AMOUNT = 100_000;
const MAX_NOTE = 500;

const SURFACE_OPTIONS: Array<{ value: Surface; label: string }> = [
  { value: "playground", label: "Playground" },
  { value: "skillGen", label: "Skill generation" },
];

const PRESET_DAYS: Array<{ days: number; label: string }> = [
  { days: 7, label: "+7 days" },
  { days: 30, label: "+30 days" },
  { days: 90, label: "+90 days" },
];

interface GrantRow {
  surface: Surface | "";
  amount: string;
}

const EMPTY_GRANT: GrantRow = { surface: "playground", amount: "100" };

/** Build the local-time string accepted by `<input type="datetime-local">`. */
function isoToLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export interface MintRedemptionCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MintRedemptionCodeModal({
  isOpen,
  onClose,
}: MintRedemptionCodeModalProps) {
  const [grants, setGrants] = useState<GrantRow[]>([{ ...EMPTY_GRANT }]);
  const [note, setNote] = useState("");
  const [expiresLocal, setExpiresLocal] = useState<string>(
    isoToLocalInputValue(daysFromNowIso(30)),
  );
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<RedemptionCode | null>(null);
  const [copied, setCopied] = useState(false);

  const mint = useMintCode();
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    if (isOpen) {
      setGrants([{ ...EMPTY_GRANT }]);
      setNote("");
      setExpiresLocal(isoToLocalInputValue(daysFromNowIso(30)));
      setError(null);
      setMinted(null);
      setCopied(false);
    }
  }, [isOpen]);

  const usedSurfaces = useMemo(
    () => new Set(grants.map((g) => g.surface).filter(Boolean) as Surface[]),
    [grants],
  );

  const updateGrant = (idx: number, patch: Partial<GrantRow>) => {
    setGrants((prev) =>
      prev.map((g, i) => (i === idx ? { ...g, ...patch } : g)),
    );
  };

  const addGrantRow = () => {
    if (grants.length >= SURFACE_OPTIONS.length) return;
    const remaining = SURFACE_OPTIONS.find(
      (opt) => !usedSurfaces.has(opt.value),
    );
    setGrants((prev) => [
      ...prev,
      { surface: remaining?.value ?? "", amount: "100" },
    ]);
  };

  const removeGrantRow = (idx: number) => {
    setGrants((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (grants.length === 0) {
      setError("Add at least one grant.");
      return;
    }
    const seen = new Set<Surface>();
    const normalized: MintCodeRequest["grants"] = [];
    for (const row of grants) {
      if (!row.surface) {
        setError("Pick a surface for every grant row.");
        return;
      }
      if (seen.has(row.surface)) {
        setError("Each grant must target a different surface.");
        return;
      }
      seen.add(row.surface);
      const n = Number(row.amount);
      if (!Number.isInteger(n) || n <= 0 || n > MAX_AMOUNT) {
        setError(
          `Amount must be a positive whole number (1..${MAX_AMOUNT.toLocaleString()}).`,
        );
        return;
      }
      normalized.push({ surface: row.surface, amount: n });
    }

    if (note.length > MAX_NOTE) {
      setError(`Note must be ${MAX_NOTE} characters or fewer.`);
      return;
    }

    const expiresIso = localInputToIso(expiresLocal);
    if (!expiresIso) {
      setError("Pick an expiration date.");
      return;
    }
    if (new Date(expiresIso).getTime() <= Date.now()) {
      setError("Expiration must be in the future.");
      return;
    }

    setError(null);
    try {
      const res = await mint.mutateAsync({
        grants: normalized,
        note: note.trim() || undefined,
        expiresAt: expiresIso,
      });
      setMinted(res.code);
      addToast({
        type: "success",
        message: "Redemption code minted. Copy it before closing.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mint failed");
    }
  };

  const onCopyMinted = async () => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy failed — select the code manually.");
    }
  };

  const onPickPreset = (days: number) => {
    setExpiresLocal(isoToLocalInputValue(daysFromNowIso(days)));
  };

  const title = minted ? "Code minted" : "Mint redemption code";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      {minted ? (
        <div className="space-y-4">
          <div className="rounded border border-accent/40 bg-accent/5 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
              Code (single-use, share once)
            </p>
            <p className="mt-2 break-all font-mono text-lg font-semibold text-accent">
              {minted.code}
            </p>
            <button
              type="button"
              onClick={onCopyMinted}
              className="mt-3 inline-flex items-center gap-2 rounded-sm border border-accent-muted bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-page hover:bg-accent-muted"
            >
              {copied ? "Copied" : "Copy code"}
            </button>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                Grants
              </dt>
              <dd className="mt-1 space-y-1 font-mono text-[11px] text-strong">
                {minted.grants.map((g) => (
                  <div key={g.surface}>
                    {SURFACE_OPTIONS.find((s) => s.value === g.surface)?.label ??
                      g.surface}
                    {" "}+{g.amount.toLocaleString("en-US")}
                  </div>
                ))}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                Expires
              </dt>
              <dd className="mt-1 font-mono text-[11px] text-strong">
                {new Date(minted.expiresAt).toLocaleString()}
              </dd>
            </div>
          </dl>

          {error && (
            <p
              role="alert"
              className="rounded border border-danger/40 bg-danger-soft px-3 py-2 font-mono text-[11px] text-danger"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <fieldset className="space-y-3">
            <legend className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
              Grants
            </legend>
            {grants.map((row, idx) => {
              const availableForThisRow = SURFACE_OPTIONS.filter(
                (opt) =>
                  opt.value === row.surface || !usedSurfaces.has(opt.value),
              );
              return (
                <div key={idx} className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Surface
                    </span>
                    <select
                      value={row.surface}
                      onChange={(e) =>
                        updateGrant(idx, {
                          surface: e.target.value as Surface,
                        })
                      }
                      aria-label={`Grant ${idx + 1} surface`}
                      className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
                    >
                      {availableForThisRow.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                      Amount
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={MAX_AMOUNT}
                      step={1}
                      value={row.amount}
                      onChange={(e) =>
                        updateGrant(idx, { amount: e.target.value })
                      }
                      aria-label={`Grant ${idx + 1} amount`}
                      className="w-32 rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeGrantRow(idx)}
                    aria-label={`Remove grant ${idx + 1}`}
                    disabled={grants.length <= 1}
                    className="h-9 rounded-sm border border-subtle bg-elevated/40 px-3 font-mono text-[14px] text-meta hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    −
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={addGrantRow}
              disabled={grants.length >= SURFACE_OPTIONS.length}
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent hover:text-accent-muted disabled:cursor-not-allowed disabled:text-meta/60"
            >
              + Add grant
            </button>
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Note (optional, ≤ {MAX_NOTE} chars)
            </span>
            <textarea
              maxLength={MAX_NOTE}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason for issuing — surfaced in admin audit"
              rows={3}
              className="rounded-sm border border-subtle bg-card px-3 py-2 font-text text-sm text-strong focus:border-accent focus:outline-none"
            />
          </label>

          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                Expires at
              </span>
              <input
                type="datetime-local"
                value={expiresLocal}
                onChange={(e) => setExpiresLocal(e.target.value)}
                className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_DAYS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => onPickPreset(p.days)}
                  className="rounded-sm border border-subtle bg-elevated/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-meta hover:border-accent hover:text-accent"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

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
            <Button size="sm" type="submit" loading={mint.isPending}>
              Mint code
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
