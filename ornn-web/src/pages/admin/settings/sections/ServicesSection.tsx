/**
 * ServicesSection — chrono-storage + chrono-sandbox endpoints.
 *
 * `chronoStorageBucket` enforces S3-friendly slug regex
 * `^[a-z0-9.-]{1,63}$`. URLs accept http/https.
 *
 * @module pages/admin/settings/sections/ServicesSection
 */

import { z } from "zod";
import { SectionShell } from "@/components/admin/settings/SectionShell";
import { UnsavedChangesGuard } from "@/components/admin/settings/UnsavedChangesGuard";
import { useSectionForm } from "@/components/admin/settings/useSectionForm";
import {
  fetchSection,
  putSection,
  type ServicesSection as SS,
} from "@/services/settingsApi";

const Schema = z.object({
  chronoStorageUrl: z.string().url().regex(/^https?:\/\//, "Must be http(s) URL"),
  chronoStorageBucket: z
    .string()
    .regex(/^[a-z0-9.-]{1,63}$/, "Must match ^[a-z0-9.-]{1,63}$"),
  chronoSandboxUrl: z.string().url().regex(/^https?:\/\//, "Must be http(s) URL"),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
}) satisfies z.ZodType<SS>;

export function ServicesSection() {
  const form = useSectionForm<SS>({
    queryKey: ["admin", "settings", "integrations/services"] as const,
    fetcher: () => fetchSection<SS>("integrations/services"),
    saver: (input) => putSection<SS>("integrations/services", input),
    schema: Schema,
    successMessage: "Services saved",
  });

  const draft = form.draft;

  return (
    <>
      <UnsavedChangesGuard when={form.isDirty} />
      <SectionShell
        title="Other services"
        description="chrono-storage + chrono-sandbox endpoints."
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
            <Field
              label="chrono-storage URL"
              value={draft.chronoStorageUrl}
              onChange={(v) => form.patchDraft({ chronoStorageUrl: v })}
            />
            <Field
              label="chrono-storage bucket"
              value={draft.chronoStorageBucket}
              onChange={(v) => form.patchDraft({ chronoStorageBucket: v })}
              hint="Lowercase, alphanumeric, dot, dash. Max 63 chars."
            />
            <Field
              label="chrono-sandbox URL"
              value={draft.chronoSandboxUrl}
              onChange={(v) => form.patchDraft({ chronoSandboxUrl: v })}
            />
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
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
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
        onChange={(e) => onChange(e.target.value)}
        className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
      />
      {hint && (
        <span className="font-mono text-[10px] text-meta">{hint}</span>
      )}
    </label>
  );
}
