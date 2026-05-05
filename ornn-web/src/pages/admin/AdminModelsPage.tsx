/**
 * Admin Models page (#251).
 *
 * Shows the on-disk model catalog. Admin can:
 *   - refresh from upstream (Chrono LLM via NyxID proxy),
 *   - filter / search,
 *   - toggle per-surface enable flags,
 *   - set the per-surface default (radio — server enforces at-most-one).
 *   - see archived (no longer in upstream) rows segregated below active.
 *
 * @module pages/admin/AdminModelsPage
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { LlmProviderConfigCard } from "@/components/admin/LlmProviderConfigCard";
import { useToastStore } from "@/stores/toastStore";
import {
  useAdminModels,
  usePatchModelFlags,
  useRefreshModels,
} from "@/hooks/useModels";
import type { AdminModelRow } from "@/services/modelsApi";

function formatDateSGT(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-SG", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface ToggleProps {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  label: string;
}

function Toggle({ checked, onToggle, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`
        relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-sm border transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
        ${checked ? "border-accent bg-accent/20" : "border-strong-edge bg-elevated"}
        ${disabled ? "cursor-not-allowed opacity-50" : ""}
      `}
    >
      <span
        className={`
          absolute h-3 w-3 rounded-sm transition-transform duration-150
          ${checked ? "translate-x-[18px] bg-accent" : "translate-x-1 bg-meta"}
        `}
      />
    </button>
  );
}

interface RadioProps {
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  label: string;
}

function Radio({ checked, onSelect, disabled, label }: RadioProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      onClick={onSelect}
      disabled={disabled}
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

interface ModelRowProps {
  model: AdminModelRow;
}

function ModelRow({ model }: ModelRowProps) {
  const patch = usePatchModelFlags();
  const addToast = useToastStore((s) => s.addToast);

  const handle = (
    payload: Parameters<typeof patch.mutateAsync>[0]["patch"],
  ) =>
    patch
      .mutateAsync({ modelId: model.modelId, patch: payload })
      .catch((err) => {
        addToast({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to update model",
        });
      });

  return (
    <tr
      className={`border-b border-accent/10 transition-colors ${
        model.archived ? "opacity-60" : "hover:bg-elevated/40"
      }`}
    >
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="font-mono text-sm font-semibold text-strong">
            {model.modelId}
          </span>
          {model.displayName && model.displayName !== model.modelId && (
            <span className="font-text text-xs text-meta">{model.displayName}</span>
          )}
          {model.archived && (
            <span className="mt-1 inline-flex w-fit">
              <Badge color="muted">archived</Badge>
            </span>
          )}
        </div>
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Toggle
            checked={model.enabledForPlayground}
            disabled={model.archived || patch.isPending}
            onToggle={() =>
              handle({ enabledForPlayground: !model.enabledForPlayground })
            }
            label="Enable for playground"
          />
          <Radio
            checked={model.defaultForPlayground}
            disabled={
              model.archived || !model.enabledForPlayground || patch.isPending
            }
            onSelect={() => handle({ defaultForPlayground: true })}
            label="Default for playground"
          />
        </div>
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Toggle
            checked={model.enabledForSkillGen}
            disabled={model.archived || patch.isPending}
            onToggle={() =>
              handle({ enabledForSkillGen: !model.enabledForSkillGen })
            }
            label="Enable for skill-gen"
          />
          <Radio
            checked={model.defaultForSkillGen}
            disabled={
              model.archived || !model.enabledForSkillGen || patch.isPending
            }
            onSelect={() => handle({ defaultForSkillGen: true })}
            label="Default for skill-gen"
          />
        </div>
      </td>

      <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-meta">
        {formatDateSGT(model.lastSyncedAt)}
      </td>
    </tr>
  );
}

const TABLE_HEADERS = [
  { key: "model", label: "Model" },
  { key: "playground", label: "Playground · default" },
  { key: "skillGen", label: "Skill-gen · default" },
  { key: "synced", label: "Last synced" },
];

export function AdminModelsPage() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState("");
  const { data, isLoading, error } = useAdminModels(includeArchived);
  const refresh = useRefreshModels();
  const addToast = useToastStore((s) => s.addToast);

  const items = useMemo(() => data?.items ?? [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (m) =>
        m.modelId.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q),
    );
  }, [items, query]);

  const active = filtered.filter((m) => !m.archived);
  const archived = filtered.filter((m) => m.archived);

  const handleRefresh = async () => {
    try {
      const out = await refresh.mutateAsync();
      addToast({
        type: "success",
        message: `Catalog refreshed — ${out.added} added, ${out.updated} updated, ${out.archived} archived.`,
      });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Refresh failed",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-strong">
            Models
          </h1>
          <p className="mt-1 font-text text-meta">
            Curate the LLM catalog exposed to playground and skill-gen surfaces.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => setIncludeArchived((v) => !v)}
            size="sm"
          >
            {includeArchived ? "Hide archived" : "Show archived"}
          </Button>
          <Button onClick={handleRefresh} loading={refresh.isPending} size="sm">
            Refresh catalog
          </Button>
        </div>
      </div>

      {/* LLM provider override — sits above the catalog so admins see
          which gateway the models are actually being served from. */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        <LlmProviderConfigCard />
      </motion.div>

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by model id…"
          className="w-full max-w-sm rounded-sm border border-subtle bg-elevated/40 px-3 py-2 font-mono text-xs text-strong placeholder:text-meta/70 focus:border-accent focus:outline-none focus:bg-card"
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta">
          {filtered.length} / {items.length} models
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          {isLoading ? (
            <Skeleton lines={8} />
          ) : error ? (
            <p className="py-8 text-center font-text text-danger">
              {error instanceof Error ? error.message : "Failed to load catalog"}
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center font-text text-meta">
              No models match. Hit "Refresh catalog" to pull from upstream.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-accent/20">
                    {TABLE_HEADERS.map((h) => (
                      <th
                        key={h.key}
                        className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta"
                      >
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {active.map((m) => (
                    <ModelRow key={m.modelId} model={m} />
                  ))}
                  {includeArchived && archived.length > 0 && (
                    <>
                      <tr>
                        <td colSpan={TABLE_HEADERS.length} className="px-4 pt-6">
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                            [§ ARCHIVED — REMOVED FROM UPSTREAM]
                          </p>
                        </td>
                      </tr>
                      {archived.map((m) => (
                        <ModelRow key={m.modelId} model={m} />
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
