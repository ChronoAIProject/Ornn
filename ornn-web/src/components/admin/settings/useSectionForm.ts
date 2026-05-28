/**
 * useSectionForm — shared hook for settings section components.
 *
 * Centralizes the (load → edit → dirty-track → save → success-toast)
 * flow each section needs. Sections override the Zod schema + the
 * fetch/put fns; the rest comes for free.
 *
 * @module components/admin/settings/useSectionForm
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ZodType } from "zod";
import { useToastStore } from "@/stores/toastStore";

interface UseSectionFormOptions<T> {
  queryKey: readonly unknown[];
  fetcher: () => Promise<T>;
  saver: (input: T) => Promise<T>;
  schema?: ZodType<T>;
  /** Toast on save. Defaults to the section title. */
  successMessage?: string;
}

export interface SectionFormState<T> {
  serverValue: T | undefined;
  draft: T | undefined;
  setDraft: (next: T) => void;
  patchDraft: (patch: Partial<T>) => void;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  error: string | null;
  reset: () => void;
  save: () => Promise<void>;
}

function deepEq<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useSectionForm<T>({
  queryKey,
  fetcher,
  saver,
  schema,
  successMessage = "Settings saved",
}: UseSectionFormOptions<T>): SectionFormState<T> {
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [draft, setDraft] = useState<T | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey,
    queryFn: fetcher,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (query.data && draft === undefined) {
      setDraft(query.data);
    }
  }, [query.data, draft]);

  const isDirty = useMemo(() => {
    if (!query.data || draft === undefined) return false;
    return !deepEq(query.data, draft);
  }, [query.data, draft]);

  const patchDraft = (patch: Partial<T>) => {
    setDraft((prev) => (prev === undefined ? prev : { ...prev, ...patch }));
  };

  const reset = () => {
    if (query.data) setDraft(query.data);
    setError(null);
  };

  const save = async () => {
    if (draft === undefined) return;
    setError(null);
    if (schema) {
      const parsed = schema.safeParse(draft);
      if (!parsed.success) {
        // #698 — prefix each issue with its path so admins can see
        // which field failed instead of staring at a wall of repeated
        // "Too small: expected string to have >=1 characters" entries.
        // Length-1 string issues also rephrase as "is required" since
        // that's what the form actually means for the affected sections
        // (Mirror, NyxID Integration, etc. all use .min(1) as a
        // required-field gate).
        setError(
          parsed.error.issues
            .map((i) => {
              const path = i.path.length > 0 ? i.path.join(".") : "";
              const isRequiredGate =
                i.code === "too_small" &&
                (i as { type?: string }).type === "string" &&
                (i as { minimum?: number }).minimum === 1;
              const message = isRequiredGate ? "is required" : i.message;
              return path ? `${path}: ${message}` : message;
            })
            .join("; "),
        );
        return;
      }
    }
    setIsSaving(true);
    try {
      const next = await saver(draft);
      qc.setQueryData(queryKey, next);
      setDraft(next);
      addToast({ type: "success", message: successMessage });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      addToast({ type: "error", message: msg });
    } finally {
      setIsSaving(false);
    }
  };

  return {
    serverValue: query.data,
    draft,
    setDraft: (next: T) => setDraft(next),
    patchDraft,
    isLoading: query.isLoading,
    isSaving,
    isDirty,
    error,
    reset,
    save,
  };
}
