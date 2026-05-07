/**
 * QuotaDefaultsSection — admin-tunable monthly default allotments.
 *
 * Two integers: defaultPlaygroundMonthly + defaultSkillGenMonthly.
 * Bounds 0..1_000_000. The runtime QuotaService computes the effective
 * default as `max(bucket.defaultAllotment, currentSettingsDefault)` so
 * raising mid-month gives existing users immediate headroom.
 *
 * @module pages/admin/settings/sections/QuotaDefaultsSection
 */

import { z } from "zod";
import { SectionShell } from "@/components/admin/settings/SectionShell";
import { UnsavedChangesGuard } from "@/components/admin/settings/UnsavedChangesGuard";
import { useSectionForm } from "@/components/admin/settings/useSectionForm";
import {
  fetchSection,
  putSection,
  type QuotaDefaultsSection as QD,
} from "@/services/settingsApi";

const Schema = z.object({
  defaultPlaygroundMonthly: z.number().int().min(0).max(1_000_000),
  defaultSkillGenMonthly: z.number().int().min(0).max(1_000_000),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
}) satisfies z.ZodType<QD>;

export function QuotaDefaultsSection() {
  const form = useSectionForm<QD>({
    queryKey: ["admin", "settings", "quota"] as const,
    fetcher: () => fetchSection<QD>("quota"),
    saver: (input) => putSection<QD>("quota", input),
    schema: Schema,
    successMessage: "Quota defaults saved",
  });

  const draft = form.draft;

  return (
    <>
      <UnsavedChangesGuard when={form.isDirty} />
      <SectionShell
        title="Quota defaults"
        description="Monthly allotment per surface for non-admin users. Raising mid-month gives existing users immediate headroom; lowering does not retroactively shrink."
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumberField
              label="Playground (monthly)"
              value={draft.defaultPlaygroundMonthly}
              onChange={(n) =>
                form.patchDraft({ defaultPlaygroundMonthly: n })
              }
            />
            <NumberField
              label="Skill generation (monthly)"
              value={draft.defaultSkillGenMonthly}
              onChange={(n) =>
                form.patchDraft({ defaultSkillGenMonthly: n })
              }
            />
          </div>
        )}
      </SectionShell>
    </>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        {label}
      </span>
      <input
        type="number"
        min={0}
        max={1_000_000}
        step={1}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
      />
    </label>
  );
}
