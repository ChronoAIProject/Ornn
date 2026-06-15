/**
 * TransferOwnershipModal — hand a skill to another Ornn user (#1123).
 *
 * A Danger-Zone action: the owner picks another Ornn user (email typeahead
 * against the directory, same source the PermissionsModal uses), then types
 * the skill name to confirm. Transfer is immediate and irreversible by the
 * caller — afterwards they're no longer the owner (they keep READ access),
 * so the detail view refetches and the owner-only UI drops away.
 *
 * Single-target by design — distinct from the multi-select grant pickers.
 *
 * @module components/skill/TransferOwnershipModal
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useTransferSkillOwnership } from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";
import { searchUsersByEmail, type UserDirectoryEntry } from "@/services/usersApi";
import type { SkillDetail } from "@/types/domain";
import { translateError } from "@/utils/translateError";

interface TransferOwnershipModalProps {
  isOpen: boolean;
  onClose: () => void;
  skill: SkillDetail;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function TransferOwnershipModal({ isOpen, onClose, skill }: TransferOwnershipModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("transfer.title", "Transfer ownership") as string}
    >
      {/* Keyed on open + skill so the form resets by construction whenever
          the modal reopens — no reset effect. */}
      <TransferForm key={`${isOpen ? "open" : "closed"}:${skill.guid}`} skill={skill} onClose={onClose} t={t} />
    </Modal>
  );
}

interface TransferFormProps {
  skill: SkillDetail;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}

function TransferForm({ skill, onClose, t }: TransferFormProps) {
  const addToast = useToastStore((s) => s.addToast);
  // Two-id split (#750): guid for the write; the broad list invalidation
  // refreshes the active detail view regardless of how it was keyed.
  const transferMutation = useTransferSkillOwnership(skill.guid, skill.guid);

  const [selected, setSelected] = useState<UserDirectoryEntry | null>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const debounced = useDebouncedValue(query.trim(), 200);
  // 2-char minimum mirrors the directory search guard (#816).
  const shouldSearch = !selected && debounced.length >= 2;
  const { data: suggestions = [] } = useQuery({
    queryKey: ["users-search", debounced],
    queryFn: () => searchUsersByEmail(debounced, 8),
    enabled: shouldSearch,
    staleTime: 10_000,
  });

  const nameConfirmed = confirmName.trim() === skill.name;
  const canTransfer = !!selected && nameConfirmed && !transferMutation.isPending;

  const handleTransfer = async () => {
    if (!selected) return;
    try {
      await transferMutation.mutateAsync(selected.userId);
      addToast({
        type: "success",
        message: t("transfer.success", "Ownership transferred. You now have read access only."),
      });
      onClose();
    } catch (err) {
      addToast({ type: "error", message: translateError(err) });
    }
  };

  return (
    <>
      <p className="font-text text-sm text-meta">
        {t(
          "transfer.explain",
          "Transfer this skill to another Ornn user. They become the full owner immediately; you keep read access only and can no longer manage or delete it. This cannot be undone by you.",
        )}
      </p>

      {/* ── Target picker (single select) ── */}
      <div className="mt-4">
        <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-meta">
          {t("transfer.newOwner", "New owner")}
        </label>

        {selected ? (
          <div className="flex items-center gap-2 rounded border border-accent/30 bg-accent/5 px-3 py-2">
            <span className="font-text text-sm text-strong truncate">
              {selected.displayName || selected.email || selected.userId}
            </span>
            {selected.email && selected.email !== selected.displayName && (
              <span className="font-mono text-xs text-meta truncate">{selected.email}</span>
            )}
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setConfirmName("");
                setQuery("");
              }}
              className="ml-auto cursor-pointer font-mono text-xs text-accent hover:text-strong"
            >
              {t("transfer.change", "change")}
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder={t("transfer.searchPlaceholder", "type an email to find a user...") as string}
              className="w-full rounded border border-accent/20 bg-elevated px-3 py-2 font-text text-sm text-strong focus:border-accent/60 focus:outline-none"
            />
            {focused && debounced.length < 2 && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-accent/20 bg-card card-impression">
                <p className="px-3 py-2 font-text text-xs italic text-meta">
                  {t("transfer.searchHint", "Type at least 2 characters to search.")}
                </p>
              </div>
            )}
            {focused && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-52 overflow-y-auto rounded border border-accent/20 bg-card card-impression">
                {suggestions.map((s) => (
                  <button
                    key={s.userId}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSelected(s);
                      setFocused(false);
                      inputRef.current?.blur();
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left font-text text-sm hover:bg-accent/10"
                  >
                    <span className="truncate text-strong">{s.displayName || s.email}</span>
                    <span className="ml-auto truncate font-mono text-xs text-meta">{s.email}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1.5 font-text text-xs italic text-meta">
              {t("transfer.directoryNote", "Only users who have signed into Ornn appear here.")}
            </p>
          </div>
        )}
      </div>

      {/* ── Type-the-name confirm (only once a target is picked) ── */}
      {selected && (
        <div className="mt-4">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-danger">
            {t("transfer.confirmLabel", "Type the skill name to confirm")}
          </label>
          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={skill.name}
            autoComplete="off"
            className="w-full rounded border border-danger/30 bg-elevated px-3 py-2 font-mono text-sm text-strong focus:border-danger/60 focus:outline-none"
          />
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3 border-t border-accent/10 pt-4">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={handleTransfer}
          disabled={!canTransfer}
          loading={transferMutation.isPending}
        >
          {t("transfer.confirm", "Transfer ownership")}
        </Button>
      </div>
    </>
  );
}
