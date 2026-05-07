/**
 * ExtrasSection — list editor for `extraNyxidServices`.
 *
 * Each row carries a `name` (slug regex), `baseUrl`, and optional
 * comma-separated `scopes`. Names must be unique across the list.
 *
 * @module pages/admin/settings/sections/ExtrasSection
 */

import { z } from "zod";
import { SectionShell } from "@/components/admin/settings/SectionShell";
import { UnsavedChangesGuard } from "@/components/admin/settings/UnsavedChangesGuard";
import { useSectionForm } from "@/components/admin/settings/useSectionForm";
import { Button } from "@/components/ui/Button";
import {
  fetchSection,
  putSection,
  type ExtrasSection as EX,
} from "@/services/settingsApi";

// Mirror of backend `extras.ts:SERVICE_NAME_RE` — common service-id
// pattern: any case, digits, dot/dash/underscore. Covers canonical
// names like `NyxID`, `twitter-api`, `openai_v2`, `v1.beta`. Spaces
// are deliberately excluded so the value is safe to flow into URL
// path segments without encoding gymnastics. (#284)
const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

const Schema = z
  .object({
    extraNyxidServices: z.array(
      z.object({
        name: z.string().regex(NAME_RE, "Must match ^[A-Za-z0-9._-]{1,64}$"),
        // Empty string is the unset state (matches backend `optionalHttpUrl`
        // in extras.ts) — operators can register a service by name only and
        // fill in the gateway later. When set, must be a parseable http(s)
        // URL (#279).
        baseUrl: z.string().refine(
          (v) => {
            if (v === "") return true;
            if (!/^https?:\/\//.test(v)) return false;
            try {
              new URL(v);
              return true;
            } catch {
              return false;
            }
          },
          { message: "Must be a http(s) URL or empty" },
        ),
        scopes: z.array(z.string()).optional(),
      }),
    ),
    updatedAt: z.string().optional(),
    updatedBy: z.string().optional(),
  })
  .refine(
    (v) => {
      const seen = new Set<string>();
      for (const s of v.extraNyxidServices) {
        if (seen.has(s.name)) return false;
        seen.add(s.name);
      }
      return true;
    },
    {
      path: ["extraNyxidServices"],
      message: "Service names must be unique",
    },
  ) satisfies z.ZodType<EX>;

export function ExtrasSection() {
  const form = useSectionForm<EX>({
    queryKey: ["admin", "settings", "extras"] as const,
    fetcher: () => fetchSection<EX>("extras"),
    saver: (input) => putSection<EX>("extras", input),
    schema: Schema,
    successMessage: "Extras saved",
  });

  const draft = form.draft;

  const update = (
    idx: number,
    patch: Partial<EX["extraNyxidServices"][number]>,
  ) => {
    if (!draft) return;
    const next = [...draft.extraNyxidServices];
    next[idx] = { ...next[idx], ...patch };
    form.patchDraft({ extraNyxidServices: next });
  };

  const remove = (idx: number) => {
    if (!draft) return;
    const next = [...draft.extraNyxidServices];
    next.splice(idx, 1);
    form.patchDraft({ extraNyxidServices: next });
  };

  const add = () => {
    if (!draft) return;
    form.patchDraft({
      extraNyxidServices: [
        ...draft.extraNyxidServices,
        { name: "", baseUrl: "", scopes: [] },
      ],
    });
  };

  return (
    <>
      <UnsavedChangesGuard when={form.isDirty} />
      <SectionShell
        title="Extras"
        description="Additional NyxID-managed services proxied through Ornn."
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
          <div className="space-y-3">
            {draft.extraNyxidServices.length === 0 && (
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta">
                No extra services configured
              </p>
            )}
            {draft.extraNyxidServices.map((s, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 gap-2 rounded border border-subtle bg-elevated/40 p-3 sm:grid-cols-12"
              >
                <label className="sm:col-span-3 flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    Name
                  </span>
                  <input
                    type="text"
                    value={s.name}
                    onChange={(e) => update(idx, { name: e.target.value })}
                    className="rounded-sm border border-subtle bg-card px-2 py-1.5 font-mono text-xs text-strong focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="sm:col-span-5 flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    Base URL (optional)
                  </span>
                  <input
                    type="text"
                    value={s.baseUrl}
                    onChange={(e) => update(idx, { baseUrl: e.target.value })}
                    className="rounded-sm border border-subtle bg-card px-2 py-1.5 font-mono text-xs text-strong focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="sm:col-span-3 flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    Scopes (comma-separated, optional)
                  </span>
                  <input
                    type="text"
                    value={(s.scopes ?? []).join(",")}
                    onChange={(e) =>
                      update(idx, {
                        scopes: e.target.value
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean),
                      })
                    }
                    className="rounded-sm border border-subtle bg-card px-2 py-1.5 font-mono text-xs text-strong focus:border-accent focus:outline-none"
                  />
                </label>
                <div className="sm:col-span-1 flex items-end">
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    aria-label={`Remove ${s.name || "row"}`}
                    className="font-mono text-[10px] uppercase tracking-[0.14em] text-danger hover:text-accent"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={add}
            >
              Add service
            </Button>
          </div>
        )}
      </SectionShell>
    </>
  );
}
