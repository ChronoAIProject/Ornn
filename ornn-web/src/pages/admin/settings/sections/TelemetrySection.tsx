/**
 * TelemetrySection — admin-editable PostHog runtime config.
 *
 * Replaces the OTel + PostHog placeholder; OTel was dropped in issue
 * #271. Backend (`ornn-api`) reads this section at startup and falls
 * back to env when the API key is empty. Restart-required to apply.
 *
 * `postHogApiKey` is treated as a secret (encrypted at rest, mid-
 * masked on GET); leaving the masked sentinel unchanged on save
 * preserves the existing value.
 *
 * Frontend (`ornn-web`) currently consumes PostHog config from
 * env-injected `window.__ORNN_CONFIG__` only — DB-driven frontend
 * runtime config is a follow-up. The note on this page documents the
 * current behavior so admins know what restarts where.
 *
 * @module pages/admin/settings/sections/TelemetrySection
 */

import { z } from "zod";
import { SectionShell } from "@/components/admin/settings/SectionShell";
import { UnsavedChangesGuard } from "@/components/admin/settings/UnsavedChangesGuard";
import { useSectionForm } from "@/components/admin/settings/useSectionForm";
import {
  fetchSection,
  isSecretPreserveValue,
  putSection,
  type TelemetrySection as TS,
} from "@/services/settingsApi";

const Schema = z.object({
  postHogEnabled: z.boolean(),
  postHogApiKey: z.string(),
  postHogHost: z.string(),
  postHogProjectId: z.string(),
  postHogErrorSampleRate: z.number().min(0).max(1),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
}) satisfies z.ZodType<TS>;

export function TelemetrySection() {
  const form = useSectionForm<TS>({
    queryKey: ["admin", "settings", "telemetry"] as const,
    fetcher: () => fetchSection<TS>("telemetry"),
    saver: (input) => putSection<TS>("telemetry", input),
    schema: Schema,
    successMessage: "Telemetry config saved",
  });

  const draft = form.draft;
  const secretIsSentinel = draft
    ? isSecretPreserveValue(draft.postHogApiKey)
    : false;

  return (
    <>
      <UnsavedChangesGuard when={form.isDirty} />
      <SectionShell
        title="Telemetry"
        description="PostHog product analytics + per-request audit. Backend reads this on boot — restart ornn-api to apply changes."
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
            <div
              role="status"
              className="inline-flex items-center gap-2 rounded-sm border border-accent-support/40 bg-warning-soft px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-support"
            >
              Restart required · Backend reads on boot
            </div>

            <Toggle
              label="PostHog enabled"
              value={draft.postHogEnabled}
              onChange={(v) => form.patchDraft({ postHogEnabled: v })}
            />

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                Project API key
              </span>
              <input
                type="text"
                value={draft.postHogApiKey}
                onChange={(e) =>
                  form.patchDraft({ postHogApiKey: e.target.value })
                }
                placeholder="phc_..."
                className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
              />
              <span className="font-mono text-[10px] text-meta">
                {secretIsSentinel
                  ? "(unchanged — secret preserved)"
                  : "Public project key from your PostHog dashboard. Empty disables analytics."}
              </span>
            </label>

            <Field
              label="Host"
              value={draft.postHogHost}
              onChange={(v) => form.patchDraft({ postHogHost: v })}
              placeholder="https://eu.i.posthog.com"
              hint="https://us.i.posthog.com or https://eu.i.posthog.com depending on your region."
            />

            <Field
              label="Project ID"
              value={draft.postHogProjectId}
              onChange={(v) => form.patchDraft({ postHogProjectId: v })}
              placeholder="optional — log correlation only"
            />

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                api.error sample rate (0–1)
              </span>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={draft.postHogErrorSampleRate}
                onChange={(e) =>
                  form.patchDraft({
                    postHogErrorSampleRate: clamp01(Number(e.target.value)),
                  })
                }
                className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
              />
              <span className="font-mono text-[10px] text-meta">
                Fraction of 5xx errors emitted as `api.error` events. `api.request` always emits at 100%.
              </span>
            </label>

            <p className="font-mono text-[11px] text-meta">
              Frontend pageviews + identify still run from env-injected
              <code className="mx-1 rounded-sm bg-elevated px-1 py-0.5 text-[10px]">
                window.__ORNN_CONFIG__
              </code>
              for now — DB-driven frontend runtime config is a follow-up.
            </p>
          </div>
        )}
      </SectionShell>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
      />
      {hint && (
        <span className="font-mono text-[10px] text-meta">{hint}</span>
      )}
    </label>
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

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
