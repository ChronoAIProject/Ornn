/**
 * SkillAuditSection — risk threshold + LLM audit + AgentSeal toggles.
 *
 * `riskThreshold` floats 0..10 (used by the audit pipeline to decide
 * waiver vs. require-review). `llmAuditDefaultProviderId` is required
 * when `llmAuditEnabled` is true. `agentSealTimeoutMs` 1000..600000.
 *
 * @module pages/admin/settings/sections/SkillAuditSection
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
  type SkillAuditSection as SA,
} from "@/services/settingsApi";

const Schema = z
  .object({
    llmAuditEnabled: z.boolean(),
    llmAuditDefaultProviderId: z.string().min(1).nullable(),
    llmAuditDefaultModelId: z.string().nullable(),
    riskThreshold: z.number().min(0).max(10),
    agentSealEnabled: z.boolean(),
    agentSealTimeoutMs: z.number().int().min(1000).max(600_000),
    updatedAt: z.string().optional(),
    updatedBy: z.string().optional(),
  })
  .refine(
    (v) => !v.llmAuditEnabled || !!v.llmAuditDefaultProviderId,
    {
      path: ["llmAuditDefaultProviderId"],
      message: "Required when LLM audit is enabled",
    },
  ) satisfies z.ZodType<SA>;

export function SkillAuditSection() {
  const providers = useQuery({
    queryKey: ["admin", "settings", "llm-providers", "list"] as const,
    queryFn: listLlmProviders,
    staleTime: 60_000,
  });

  const form = useSectionForm<SA>({
    queryKey: ["admin", "settings", "skill-audit"] as const,
    fetcher: () => fetchSection<SA>("skill-audit"),
    saver: (input) => putSection<SA>("skill-audit", input),
    schema: Schema,
    successMessage: "Skill audit saved",
  });

  const draft = form.draft;
  const provider = providers.data?.find(
    (p) => p._id === draft?.llmAuditDefaultProviderId,
  );
  const auditModels = provider?.models.filter((m) => m.enabledForSkillGen && !m.removed) ?? [];

  return (
    <>
      <UnsavedChangesGuard when={form.isDirty} />
      <SectionShell
        title="Skill auditing"
        description="LLM-driven audit, AgentSeal hardening, risk threshold."
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
            <Toggle
              label="LLM audit enabled"
              value={draft.llmAuditEnabled}
              onChange={(v) => form.patchDraft({ llmAuditEnabled: v })}
            />

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                LLM audit provider
              </span>
              <select
                value={draft.llmAuditDefaultProviderId ?? ""}
                onChange={(e) =>
                  form.patchDraft({
                    llmAuditDefaultProviderId: e.target.value || null,
                    llmAuditDefaultModelId: null,
                  })
                }
                disabled={!draft.llmAuditEnabled}
                className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none disabled:opacity-50"
              >
                <option value="">— select —</option>
                {(providers.data ?? []).map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                LLM audit model (optional)
              </span>
              <select
                value={draft.llmAuditDefaultModelId ?? ""}
                onChange={(e) =>
                  form.patchDraft({
                    llmAuditDefaultModelId: e.target.value || null,
                  })
                }
                disabled={!draft.llmAuditEnabled || !draft.llmAuditDefaultProviderId}
                className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none disabled:opacity-50"
              >
                <option value="">— provider default —</option>
                {auditModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.id})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                Risk threshold (0..10)
              </span>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={draft.riskThreshold}
                onChange={(e) =>
                  form.patchDraft({ riskThreshold: Number(e.target.value) || 0 })
                }
                className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
              />
            </label>

            <Toggle
              label="AgentSeal enabled"
              value={draft.agentSealEnabled}
              onChange={(v) => form.patchDraft({ agentSealEnabled: v })}
            />

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                AgentSeal timeout (ms) — 1000..600000
              </span>
              <input
                type="number"
                min={1000}
                max={600_000}
                step={1000}
                value={draft.agentSealTimeoutMs}
                onChange={(e) =>
                  form.patchDraft({
                    agentSealTimeoutMs: Number(e.target.value) || 0,
                  })
                }
                disabled={!draft.agentSealEnabled}
                className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none disabled:opacity-50"
              />
            </label>
          </div>
        )}
      </SectionShell>
    </>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-3">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-[var(--color-accent-primary)]"
      />
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-strong">
        {label}
      </span>
    </label>
  );
}
