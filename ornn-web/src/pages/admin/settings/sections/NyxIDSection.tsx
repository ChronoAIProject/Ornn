/**
 * NyxIDSection — settings for the NyxID auth/proxy backend.
 *
 * Owns only the server-side coords that ornn-api actually consults:
 * the SA OAuth token URL + client credentials, and the NyxID API base
 * URL the backend proxies through. Browser-only link coords (NyxID
 * frontend URL + my-services / my-profile / my-organization paths)
 * live in `ornn-web`'s configmap (see `config.ts`) — they're delivered
 * via `window.__ORNN_CONFIG__` since they have no server-side consumer.
 *
 * @module pages/admin/settings/sections/NyxIDSection
 */

import { z } from "zod";
import { SectionShell } from "@/components/admin/settings/SectionShell";
import { UnsavedChangesGuard } from "@/components/admin/settings/UnsavedChangesGuard";
import { useSectionForm } from "@/components/admin/settings/useSectionForm";
import {
  fetchSection,
  isSecretPreserveValue,
  putSection,
  type NyxIdSection as NX,
} from "@/services/settingsApi";

const HTTP_URL = z.string().url().regex(/^https?:\/\//, "Must start with http:// or https://");

const Schema = z.object({
  tokenUrl: HTTP_URL,
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  baseApiUrl: HTTP_URL,
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
}) satisfies z.ZodType<NX>;

export function NyxIDSection() {
  const form = useSectionForm<NX>({
    queryKey: ["admin", "settings", "integrations/nyxid"] as const,
    fetcher: () => fetchSection<NX>("integrations/nyxid"),
    saver: (input) => putSection<NX>("integrations/nyxid", input),
    schema: Schema,
    successMessage: "NyxID integration saved",
  });

  const draft = form.draft;

  return (
    <>
      <UnsavedChangesGuard when={form.isDirty} />
      <SectionShell
        title="NyxID integration"
        description="OAuth service-account credentials + the API base URL the backend proxies through. Browser-side link coords live in ornn-web's configmap (NYXID_WEB_BASE_URL + path env vars) — change them there and redeploy."
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
            <Field
              label="Token URL"
              value={draft.tokenUrl}
              onChange={(v) => form.patchDraft({ tokenUrl: v })}
            />
            <Field
              label="Client ID"
              value={draft.clientId}
              onChange={(v) => form.patchDraft({ clientId: v })}
            />
            <SecretField
              label="Client Secret"
              value={draft.clientSecret}
              onChange={(v) => form.patchDraft({ clientSecret: v })}
              isSentinel={isSecretPreserveValue(draft.clientSecret)}
            />
            <Field
              label="Base API URL"
              value={draft.baseApiUrl}
              onChange={(v) => form.patchDraft({ baseApiUrl: v })}
            />
          </div>
        )}
      </SectionShell>
    </>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

function Field({ label, value, onChange }: FieldProps) {
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

function SecretField({
  label,
  value,
  onChange,
  isSentinel,
}: FieldProps & { isSentinel: boolean }) {
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
      <span className="font-mono text-[10px] text-meta">
        {isSentinel
          ? "(unchanged — secret preserved)"
          : "Replace to overwrite. Saving an unchanged mid-mask keeps the existing DB value."}
      </span>
    </label>
  );
}
