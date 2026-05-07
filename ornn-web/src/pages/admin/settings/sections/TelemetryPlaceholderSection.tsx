/**
 * TelemetryPlaceholderSection — accepts/stores OTel + PostHog config
 * but no consumer wires up to it yet (Architecture §6 sub-decision 8).
 *
 * Renders all fields as disabled with a "Planned" pill so admins know
 * the section is reserved space, not active config.
 *
 * @module pages/admin/settings/sections/TelemetryPlaceholderSection
 */

import { z } from "zod";
import { SectionShell } from "@/components/admin/settings/SectionShell";
import { UnsavedChangesGuard } from "@/components/admin/settings/UnsavedChangesGuard";
import { useSectionForm } from "@/components/admin/settings/useSectionForm";
import {
  fetchSection,
  putSection,
  type TelemetrySection as TS,
} from "@/services/settingsApi";

const Schema = z.object({
  openTelemetryEnabled: z.boolean(),
  openTelemetryEndpoint: z.string(),
  postHogEnabled: z.boolean(),
  postHogApiKey: z.string(),
  postHogHost: z.string(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
}) satisfies z.ZodType<TS>;

export function TelemetryPlaceholderSection() {
  const form = useSectionForm<TS>({
    queryKey: ["admin", "settings", "telemetry"] as const,
    fetcher: () => fetchSection<TS>("telemetry"),
    saver: (input) => putSection<TS>("telemetry", input),
    schema: Schema,
    successMessage: "Telemetry config saved",
  });

  const draft = form.draft;

  return (
    <>
      <UnsavedChangesGuard when={form.isDirty} />
      <SectionShell
        title="Telemetry"
        description="OpenTelemetry + PostHog endpoints. Stored but not consumed yet."
        isLoading={form.isLoading}
        isSaving={form.isSaving}
        isDirty={form.isDirty}
        error={form.error}
        onSave={form.save}
        onReset={form.reset}
        updatedAt={form.serverValue?.updatedAt}
        updatedBy={form.serverValue?.updatedBy}
      >
        <div className="space-y-4">
          <div
            role="status"
            className="inline-flex items-center gap-2 rounded-sm border border-accent-support/40 bg-warning-soft px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-support"
          >
            Planned · No consumer wired
          </div>

          {draft && (
            <fieldset
              disabled
              className="space-y-4 opacity-60"
              aria-disabled="true"
            >
              <Field
                label="OTel endpoint"
                value={draft.openTelemetryEndpoint}
              />
              <Field label="PostHog API key" value={draft.postHogApiKey} />
              <Field label="PostHog host" value={draft.postHogHost} />
            </fieldset>
          )}
        </div>
      </SectionShell>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        {label}
      </span>
      <input
        type="text"
        value={value}
        readOnly
        disabled
        className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong"
      />
    </label>
  );
}
