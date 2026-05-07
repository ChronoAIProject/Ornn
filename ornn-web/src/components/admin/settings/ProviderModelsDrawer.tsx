/**
 * ProviderModelsDrawer — single-source per-provider model management
 * (#270). Right-edge slide-in (640px wide — wider than the provider
 * edit drawer to fit the per-row matrix).
 *
 * Rows show every model on `provider.models[]`. For each row the
 * operator can:
 *   - toggle "Enabled for Playground"
 *   - toggle "Enabled for SkillGen"
 *   - radio-pick "Default for Playground" (server enforces at-most-one
 *     across **all** providers, so flipping one default unselects every
 *     other provider's default for that surface in the same write)
 *   - radio-pick "Default for SkillGen" (same)
 *
 * Removed-from-upstream rows (`removed: true`) are segregated below the
 * active rows with an "archived" badge and a disabled toggle column —
 * the server refuses PATCHes against them.
 *
 * Each toggle/radio fires an optimistic-then-confirmed PATCH. The
 * underlying mutation invalidates the providers list cache, so a
 * sibling provider's default flip cascades into this drawer's view on
 * the next refetch.
 *
 * @module components/admin/settings/ProviderModelsDrawer
 */

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toastStore";
import {
  patchProviderModelFlags,
  type LlmProvider,
  type LlmProviderModel,
  type ModelFlagsPatchInput,
} from "@/services/settingsApi";

export interface ProviderModelsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Provider to manage. Drawer renders nothing when null. */
  provider: LlmProvider | null;
}

interface PatchVars {
  providerId: string;
  modelId: string;
  flags: ModelFlagsPatchInput;
}

export function ProviderModelsDrawer({
  isOpen,
  onClose,
  provider,
}: ProviderModelsDrawerProps) {
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const patchMut = useMutation<LlmProvider, Error, PatchVars>({
    mutationFn: ({ providerId, modelId, flags }) =>
      patchProviderModelFlags(providerId, modelId, flags),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["admin", "settings", "llm-providers"],
      });
    },
    onError: (err) =>
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Model patch failed",
      }),
  });

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const active = (provider?.models ?? []).filter((m) => !m.removed);
  const archived = (provider?.models ?? []).filter((m) => m.removed);

  const onPatch = (modelId: string, flags: ModelFlagsPatchInput) => {
    if (!provider) return;
    patchMut.mutate({ providerId: provider._id, modelId, flags });
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && provider && (
        <div className="fixed inset-0 z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 240, damping: 28, mass: 0.9 }}
            role="dialog"
            aria-label={`Models — ${provider.name}`}
            className="card-impression absolute right-0 top-0 flex h-full w-full max-w-[640px] flex-col gap-5 border-l border-subtle bg-page p-6 sm:p-8"
          >
            <header className="flex items-baseline justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                  [§ MODELS — {provider.name.toUpperCase()}]
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-strong">
                  {provider.name}
                </h2>
                <p className="mt-1 font-text text-xs text-meta">
                  {active.length} active{archived.length > 0 ? ` · ${archived.length} archived` : ""}.
                  Setting a default on a model auto-enables it for that surface
                  and clears the same default on every other model — provider-wide.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 -mt-2 inline-flex h-8 w-8 items-center justify-center rounded-sm text-meta transition-colors hover:bg-elevated hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {active.length === 0 && archived.length === 0 ? (
                <p className="py-12 text-center font-text text-sm text-meta">
                  No models yet. Click <strong>Sync</strong> on the provider row
                  to pull the upstream catalog.
                </p>
              ) : (
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="border-b border-accent/20">
                      <th className="px-2 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                        Model
                      </th>
                      <th className="px-2 py-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                        Playground
                      </th>
                      <th className="px-2 py-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                        Skill-Gen
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((m) => (
                      <ModelRow
                        key={m.id}
                        model={m}
                        disabled={patchMut.isPending}
                        onPatch={(flags) => onPatch(m.id, flags)}
                      />
                    ))}
                    {archived.length > 0 && (
                      <>
                        <tr>
                          <td colSpan={3} className="pt-6 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                            Archived (no longer in upstream catalog)
                          </td>
                        </tr>
                        {archived.map((m) => (
                          <ModelRow
                            key={m.id}
                            model={m}
                            disabled
                            onPatch={() => {}}
                          />
                        ))}
                      </>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

interface ModelRowProps {
  model: LlmProviderModel;
  disabled: boolean;
  onPatch: (flags: ModelFlagsPatchInput) => void;
}

function ModelRow({ model, disabled, onPatch }: ModelRowProps) {
  return (
    <tr
      className={`border-b border-accent/10 ${
        model.removed ? "opacity-60" : "hover:bg-elevated/40"
      }`}
    >
      <td className="px-2 py-3">
        <div className="flex flex-col">
          <span className="font-mono text-sm text-strong">{model.id}</span>
          {model.displayName && model.displayName !== model.id && (
            <span className="font-text text-xs text-meta">{model.displayName}</span>
          )}
          {model.removed && (
            <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full border border-strong-edge bg-elevated/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-meta">
              archived
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-3">
        <div className="flex items-center justify-center gap-3">
          <Toggle
            checked={model.enabledForPlayground}
            disabled={disabled || model.removed}
            label="Enabled for playground"
            onToggle={() =>
              onPatch({ enabledForPlayground: !model.enabledForPlayground })
            }
          />
          <Radio
            checked={model.defaultForPlayground}
            disabled={disabled || model.removed}
            label="Default for playground"
            onSelect={() => onPatch({ defaultForPlayground: true })}
          />
        </div>
      </td>
      <td className="px-2 py-3">
        <div className="flex items-center justify-center gap-3">
          <Toggle
            checked={model.enabledForSkillGen}
            disabled={disabled || model.removed}
            label="Enabled for skill-gen"
            onToggle={() =>
              onPatch({ enabledForSkillGen: !model.enabledForSkillGen })
            }
          />
          <Radio
            checked={model.defaultForSkillGen}
            disabled={disabled || model.removed}
            label="Default for skill-gen"
            onSelect={() => onPatch({ defaultForSkillGen: true })}
          />
        </div>
      </td>
    </tr>
  );
}

interface ToggleProps {
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}

function Toggle({ checked, disabled, label, onToggle }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`
        inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
        ${checked ? "border-accent bg-accent/15" : "border-strong-edge bg-elevated"}
        ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}
      `}
    >
      <span
        className={`
          inline-block h-3 w-3 rounded-full bg-strong transition-transform
          ${checked ? "translate-x-5" : "translate-x-1"}
        `}
      />
    </button>
  );
}

interface RadioProps {
  checked: boolean;
  disabled: boolean;
  label: string;
  onSelect: () => void;
}

function Radio({ checked, disabled, label, onSelect }: RadioProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || checked}
      role="radio"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={`
        inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
        ${checked ? "border-accent bg-accent/15" : "border-strong-edge bg-elevated"}
        ${disabled ? "cursor-not-allowed opacity-40" : ""}
      `}
    >
      {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
    </button>
  );
}
