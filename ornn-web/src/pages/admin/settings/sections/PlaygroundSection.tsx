/**
 * PlaygroundSection — runtime knobs for the in-app Playground surface.
 *
 * Currently: defaultProviderId + defaultModelId (resolved against the
 * active LlmProvider list — selectable from a dropdown of enabled
 * non-removed models) + sseKeepAliveMs (1000..600000).
 *
 * @module pages/admin/settings/sections/PlaygroundSection
 */

import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { SectionShell } from "@/components/admin/settings/SectionShell";
import { UnsavedChangesGuard } from "@/components/admin/settings/UnsavedChangesGuard";
import { useSectionForm } from "@/components/admin/settings/useSectionForm";
import {
  fetchSection,
  listLlmProviders,
  putSection,
  type PlaygroundSection as PS,
} from "@/services/settingsApi";

const Schema = z.object({
  defaultProviderId: z.string().min(1).nullable(),
  defaultModelId: z.string().min(1).nullable(),
  sseKeepAliveMs: z.number().int().min(1000).max(600_000),
  defaultMonthlyQuota: z.number().int().min(0).max(1_000_000),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
}) satisfies z.ZodType<PS>;

export function PlaygroundSection() {
  const providers = useQuery({
    queryKey: ["admin", "settings", "llm-providers", "list"] as const,
    queryFn: listLlmProviders,
    staleTime: 60_000,
  });

  const form = useSectionForm<PS>({
    queryKey: ["admin", "settings", "playground"] as const,
    fetcher: () => fetchSection<PS>("playground"),
    saver: (input) => putSection<PS>("playground", input),
    schema: Schema,
    successMessage: "Playground settings saved",
  });

  const draft = form.draft;
  const provider = providers.data?.find(
    (p) => p._id === draft?.defaultProviderId,
  );
  const availableModels = provider?.models.filter(
    (m) => m.enabledForPlayground && !m.removed,
  ) ?? [];

  return (
    <>
      <UnsavedChangesGuard when={form.isDirty} />
      <SectionShell
        title="Playground"
        description="Runtime defaults for the playground surface."
        isLoading={form.isLoading}
        isSaving={form.isSaving}
        isDirty={form.isDirty}
        error={form.error}
        onSave={form.save}
        onReset={form.reset}
        updatedAt={form.serverValue?.updatedAt}
        updatedBy={form.serverValue?.updatedBy}
      >
        {draft && (
          <div className="space-y-4">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                Default provider
              </span>
              <select
                value={draft.defaultProviderId ?? ""}
                onChange={(e) =>
                  form.patchDraft({
                    defaultProviderId: e.target.value || null,
                    defaultModelId: null,
                  })
                }
                className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
              >
                <option value="">— none —</option>
                {(providers.data ?? []).map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                Default model
              </span>
              <select
                value={draft.defaultModelId ?? ""}
                onChange={(e) =>
                  form.patchDraft({ defaultModelId: e.target.value || null })
                }
                disabled={!draft.defaultProviderId}
                className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none disabled:opacity-50"
              >
                <option value="">— provider default —</option>
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.id})
                  </option>
                ))}
              </select>
              <span className="font-mono text-[10px] text-meta">
                Only enabled, non-removed models from the selected provider
                appear.
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                SSE keep-alive (ms) — 1000..600000
              </span>
              <input
                type="number"
                min={1000}
                max={600_000}
                step={1000}
                value={draft.sseKeepAliveMs}
                onChange={(e) =>
                  form.patchDraft({
                    sseKeepAliveMs: Number(e.target.value) || 0,
                  })
                }
                className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                Default monthly quota — non-admin users (0..1,000,000)
              </span>
              <input
                type="number"
                min={0}
                max={1_000_000}
                step={1}
                value={draft.defaultMonthlyQuota}
                onChange={(e) =>
                  form.patchDraft({
                    defaultMonthlyQuota: Number(e.target.value) || 0,
                  })
                }
                className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
              />
              <span className="font-mono text-[10px] text-meta">
                Raising the default mid-month grants existing users
                headroom; lowering does not retroactively claw back.
              </span>
            </label>
          </div>
        )}
      </SectionShell>
    </>
  );
}
