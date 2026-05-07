/**
 * ProviderEditDrawer — create / edit one LlmProvider doc.
 *
 * Right-edge slide-in (480px) following the QuotaUserDetailDrawer
 * pattern. Two modes:
 *   - create: empty form; on save → POST /admin/settings/llm-providers
 *   - edit:   pre-filled from `provider`; on save → PUT /admin/settings/llm-providers/:id
 *
 * Auth is a discriminated union (apiKey | tokenUrl | basic). The
 * `LlmProvider.auth.kind` selector swaps the visible sub-fields. Secret
 * fields render the API's mid-mask placeholder when present and treat
 * an unchanged sentinel value as "(unchanged — secret preserved)".
 *
 * Validation runs on Save via Zod against the same shape the backend
 * accepts. `defaultModelId` only enables once enabled non-removed
 * models exist on the provider — for new providers, it stays empty
 * until the first Sync populates the catalog.
 *
 * @module components/admin/settings/ProviderEditDrawer
 */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/stores/toastStore";
import {
  createLlmProvider,
  isSecretPreserveValue,
  updateLlmProvider,
  type LlmProvider,
  type LlmProviderApiFormat,
  type LlmProviderAuth,
  type LlmProviderInput,
} from "@/services/settingsApi";

// --------------------------------------------------------------------- form types

type AuthKind = LlmProviderAuth["kind"];

interface DrawerForm {
  name: string;
  gatewayUrl: string;
  modelListUrl: string;
  apiFormat: LlmProviderApiFormat;
  authKind: AuthKind;
  apiKey: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  defaultModelId: string;
  maxOutputTokens: number;
  defaultTemperature: number;
}

const HTTP_URL = z
  .string()
  .url()
  .regex(/^https?:\/\//, "Must be http(s)");

const SCHEMA = z
  .object({
    name: z.string().min(1, "Name is required").max(64),
    gatewayUrl: HTTP_URL,
    modelListUrl: HTTP_URL,
    apiFormat: z.enum(["chat-completion", "responses"]),
    authKind: z.enum(["apiKey", "tokenUrl", "basic"]),
    apiKey: z.string(),
    tokenUrl: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
    username: z.string(),
    password: z.string(),
    defaultModelId: z.string(),
    maxOutputTokens: z
      .number()
      .int()
      .min(1, "Must be ≥ 1")
      .max(1_000_000, "Must be ≤ 1,000,000"),
    defaultTemperature: z.number().min(0).max(2),
  })
  .superRefine((v, ctx) => {
    if (v.authKind === "apiKey" && v.apiKey.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiKey"],
        message: "API key is required",
      });
    }
    if (v.authKind === "tokenUrl") {
      if (!/^https?:\/\//.test(v.tokenUrl)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tokenUrl"],
          message: "Token URL must be http(s)",
        });
      }
      if (v.clientId.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clientId"],
          message: "Client ID is required",
        });
      }
      if (v.clientSecret.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clientSecret"],
          message: "Client secret is required",
        });
      }
    }
    if (v.authKind === "basic") {
      if (v.username.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["username"],
          message: "Username is required",
        });
      }
      if (v.password.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["password"],
          message: "Password is required",
        });
      }
    }
  });

// --------------------------------------------------------------------- helpers

function emptyForm(): DrawerForm {
  return {
    name: "",
    gatewayUrl: "",
    modelListUrl: "",
    apiFormat: "chat-completion",
    authKind: "apiKey",
    apiKey: "",
    tokenUrl: "",
    clientId: "",
    clientSecret: "",
    username: "",
    password: "",
    defaultModelId: "",
    maxOutputTokens: 4096,
    defaultTemperature: 0.7,
  };
}

function fromProvider(p: LlmProvider): DrawerForm {
  const base = emptyForm();
  base.name = p.name;
  base.gatewayUrl = p.gatewayUrl;
  base.modelListUrl = p.modelListUrl;
  base.apiFormat = p.apiFormat;
  base.authKind = p.auth.kind;
  if (p.auth.kind === "apiKey") base.apiKey = p.auth.apiKey;
  if (p.auth.kind === "tokenUrl") {
    base.tokenUrl = p.auth.tokenUrl;
    base.clientId = p.auth.clientId;
    base.clientSecret = p.auth.clientSecret;
  }
  if (p.auth.kind === "basic") {
    base.username = p.auth.username;
    base.password = p.auth.password;
  }
  base.defaultModelId = p.defaultModelId ?? "";
  base.maxOutputTokens = p.maxOutputTokens;
  base.defaultTemperature = p.defaultTemperature;
  return base;
}

function toInput(form: DrawerForm): LlmProviderInput {
  let auth: LlmProviderAuth;
  if (form.authKind === "apiKey") {
    auth = { kind: "apiKey", apiKey: form.apiKey };
  } else if (form.authKind === "tokenUrl") {
    auth = {
      kind: "tokenUrl",
      tokenUrl: form.tokenUrl,
      clientId: form.clientId,
      clientSecret: form.clientSecret,
    };
  } else {
    auth = {
      kind: "basic",
      username: form.username,
      password: form.password,
    };
  }
  return {
    name: form.name.trim(),
    gatewayUrl: form.gatewayUrl.trim(),
    modelListUrl: form.modelListUrl.trim(),
    apiFormat: form.apiFormat,
    auth,
    defaultModelId: form.defaultModelId || null,
    maxOutputTokens: form.maxOutputTokens,
    defaultTemperature: form.defaultTemperature,
  };
}

// --------------------------------------------------------------------- component

export interface ProviderEditDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Existing provider — drawer is in edit mode when set, create mode when null. */
  provider: LlmProvider | null;
}

export function ProviderEditDrawer({
  isOpen,
  onClose,
  provider,
}: ProviderEditDrawerProps) {
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const isEdit = provider !== null;

  const [form, setForm] = useState<DrawerForm>(() => emptyForm());
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form whenever the drawer opens against a different provider /
  // create flow. Keep the form alive when the drawer is closed so an
  // accidental backdrop click doesn't wipe in-progress input.
  useEffect(() => {
    if (!isOpen) return;
    setForm(provider ? fromProvider(provider) : emptyForm());
    setErrors({});
  }, [isOpen, provider]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const availableModels = useMemo(
    () => provider?.models.filter((m) => m.enabled && !m.removed) ?? [],
    [provider],
  );

  const saveMut = useMutation<LlmProvider, Error, LlmProviderInput>({
    mutationFn: (input) =>
      isEdit && provider
        ? updateLlmProvider(provider._id, input)
        : createLlmProvider(input),
    onSuccess: (saved) => {
      qc.invalidateQueries({
        queryKey: ["admin", "settings", "llm-providers"],
      });
      addToast({
        type: "success",
        message: isEdit ? `Updated ${saved.name}` : `Created ${saved.name}`,
      });
      onClose();
    },
    onError: (err) =>
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Save failed",
      }),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = SCHEMA.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path.join(".");
        if (!next[k]) next[k] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    saveMut.mutate(toInput(form));
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
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
            aria-label={isEdit ? "Edit LLM provider" : "New LLM provider"}
            className="card-impression absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col gap-5 border-l border-subtle bg-page p-6 sm:p-8"
          >
            <header className="flex items-baseline justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                  [§ {isEdit ? "EDIT" : "NEW"} — LLM PROVIDER]
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-strong">
                  {isEdit ? provider?.name : "New provider"}
                </h2>
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

            <form
              onSubmit={onSubmit}
              className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
            >
              <Field
                label="Name"
                value={form.name}
                onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                error={errors.name}
              />
              <Field
                label="Gateway URL"
                value={form.gatewayUrl}
                onChange={(v) => setForm((f) => ({ ...f, gatewayUrl: v }))}
                error={errors.gatewayUrl}
              />
              <Field
                label="Model list URL"
                value={form.modelListUrl}
                onChange={(v) => setForm((f) => ({ ...f, modelListUrl: v }))}
                error={errors.modelListUrl}
              />

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                  API format
                </span>
                <select
                  value={form.apiFormat}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      apiFormat: e.target.value as LlmProviderApiFormat,
                    }))
                  }
                  className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
                >
                  <option value="chat-completion">chat-completion</option>
                  <option value="responses">responses</option>
                </select>
              </label>

              <fieldset className="space-y-3 rounded border border-subtle bg-elevated/40 p-3">
                <legend className="px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                  Auth
                </legend>
                <div className="flex flex-wrap gap-3">
                  {(["apiKey", "tokenUrl", "basic"] as AuthKind[]).map((kind) => (
                    <label
                      key={kind}
                      className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-strong"
                    >
                      <input
                        type="radio"
                        name="authKind"
                        value={kind}
                        checked={form.authKind === kind}
                        onChange={() =>
                          setForm((f) => ({ ...f, authKind: kind }))
                        }
                        className="h-3 w-3 cursor-pointer accent-[var(--color-accent-primary)]"
                      />
                      {kind}
                    </label>
                  ))}
                </div>

                {form.authKind === "apiKey" && (
                  <SecretField
                    label="API key"
                    value={form.apiKey}
                    onChange={(v) => setForm((f) => ({ ...f, apiKey: v }))}
                    error={errors.apiKey}
                  />
                )}
                {form.authKind === "tokenUrl" && (
                  <>
                    <Field
                      label="Token URL"
                      value={form.tokenUrl}
                      onChange={(v) => setForm((f) => ({ ...f, tokenUrl: v }))}
                      error={errors.tokenUrl}
                    />
                    <Field
                      label="Client ID"
                      value={form.clientId}
                      onChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
                      error={errors.clientId}
                    />
                    <SecretField
                      label="Client secret"
                      value={form.clientSecret}
                      onChange={(v) =>
                        setForm((f) => ({ ...f, clientSecret: v }))
                      }
                      error={errors.clientSecret}
                    />
                  </>
                )}
                {form.authKind === "basic" && (
                  <>
                    <Field
                      label="Username"
                      value={form.username}
                      onChange={(v) => setForm((f) => ({ ...f, username: v }))}
                      error={errors.username}
                    />
                    <SecretField
                      label="Password"
                      value={form.password}
                      onChange={(v) => setForm((f) => ({ ...f, password: v }))}
                      error={errors.password}
                    />
                  </>
                )}
              </fieldset>

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                  Default model
                </span>
                <select
                  value={form.defaultModelId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, defaultModelId: e.target.value }))
                  }
                  disabled={availableModels.length === 0}
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
                  {availableModels.length === 0
                    ? "Run Sync after creating the provider to populate the model catalog."
                    : "Only enabled, non-removed models are listed."}
                </span>
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    Max output tokens (1..1,000,000)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={1_000_000}
                    step={1}
                    value={form.maxOutputTokens}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        maxOutputTokens: Number(e.target.value) || 0,
                      }))
                    }
                    className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
                  />
                  {errors.maxOutputTokens && (
                    <span className="font-mono text-[10px] text-danger">
                      {errors.maxOutputTokens}
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    Default temperature (0..2)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    value={form.defaultTemperature}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        defaultTemperature: Number(e.target.value) || 0,
                      }))
                    }
                    className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
                  />
                  {errors.defaultTemperature && (
                    <span className="font-mono text-[10px] text-danger">
                      {errors.defaultTemperature}
                    </span>
                  )}
                </label>
              </div>

              <footer className="mt-auto flex items-center justify-end gap-2 border-t border-subtle pt-4">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" loading={saveMut.isPending}>
                  {isEdit ? "Save changes" : "Create provider"}
                </Button>
              </footer>
            </form>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}

function Field({ label, value, onChange, error }: FieldProps) {
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
      {error && (
        <span className="font-mono text-[10px] text-danger">{error}</span>
      )}
    </label>
  );
}

function SecretField({ label, value, onChange, error }: FieldProps) {
  const isSentinel = value !== "" && isSecretPreserveValue(value);
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
      {error && (
        <span className="font-mono text-[10px] text-danger">{error}</span>
      )}
    </label>
  );
}
