/**
 * MirrorSection — admin GitHub mirror controls (settings-doc-backed).
 *
 * The legacy /admin/mirror page ships a deep mirror UI (#262) that
 * remains the operational source of truth for run/inspect controls. The
 * settings doc now stores the *configuration* — repo coords, GitHub App
 * credentials — so flipping config no longer needs a redeploy.
 *
 * For Round 1 we render the configuration surface here and link to the
 * legacy mirror dashboard for runs/repo status. The legacy `/admin/mirror`
 * route 30x-redirects to `/admin/settings/mirror` so existing deep-links
 * keep working; the dashboard surface is reachable from the Skills page.
 *
 * @module pages/admin/settings/sections/MirrorSection
 */

import { z } from "zod";
import { Link } from "react-router-dom";
import { SectionShell } from "@/components/admin/settings/SectionShell";
import { UnsavedChangesGuard } from "@/components/admin/settings/UnsavedChangesGuard";
import { useSectionForm } from "@/components/admin/settings/useSectionForm";
import {
  fetchSection,
  isSecretPreserveValue,
  putSection,
  type MirrorSection as MS,
} from "@/services/settingsApi";

const Schema = z.object({
  enabled: z.boolean(),
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1),
  appId: z.string().min(1),
  installationId: z.string().min(1),
  appPrivateKey: z.string().min(1),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
}) satisfies z.ZodType<MS>;

export function MirrorSection() {
  const form = useSectionForm<MS>({
    queryKey: ["admin", "settings", "mirror"] as const,
    fetcher: () => fetchSection<MS>("mirror"),
    saver: (input) => putSection<MS>("mirror", input),
    schema: Schema,
    successMessage: "Mirror config saved",
  });

  const draft = form.draft;
  const secretIsSentinel = draft
    ? isSecretPreserveValue(draft.appPrivateKey)
    : false;

  return (
    <>
      <UnsavedChangesGuard when={form.isDirty} />
      <SectionShell
        title="GitHub mirror"
        description="Repo coords + App credentials. Run controls are on the legacy mirror dashboard."
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
              label="Mirror enabled"
              value={draft.enabled}
              onChange={(v) => form.patchDraft({ enabled: v })}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field
                label="Owner"
                value={draft.owner}
                onChange={(v) => form.patchDraft({ owner: v })}
              />
              <Field
                label="Repo"
                value={draft.repo}
                onChange={(v) => form.patchDraft({ repo: v })}
              />
              <Field
                label="Branch"
                value={draft.branch}
                onChange={(v) => form.patchDraft({ branch: v })}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="App ID"
                value={draft.appId}
                onChange={(v) => form.patchDraft({ appId: v })}
              />
              <Field
                label="Installation ID"
                value={draft.installationId}
                onChange={(v) => form.patchDraft({ installationId: v })}
              />
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                App private key (PEM)
              </span>
              <textarea
                value={draft.appPrivateKey}
                onChange={(e) =>
                  form.patchDraft({ appPrivateKey: e.target.value })
                }
                rows={8}
                spellCheck={false}
                className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-[11px] text-strong focus:border-accent focus:outline-none"
              />
              <span className="font-mono text-[10px] text-meta">
                {secretIsSentinel
                  ? "(unchanged — secret preserved)"
                  : "Replace to overwrite. Saving an unchanged mid-mask keeps the existing DB value."}
              </span>
            </label>

            <Link
              to="/admin/skills"
              className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-accent hover:text-accent-muted"
            >
              Open mirror dashboard →
            </Link>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
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
