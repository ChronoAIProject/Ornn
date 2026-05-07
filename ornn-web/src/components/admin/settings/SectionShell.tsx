/**
 * SectionShell — reusable layout for one settings section.
 *
 * Establishes the shared chrome — mono uppercase title, optional
 * description, card-surface body, and a sticky bottom action row with
 * Save (primary) + Reset (ghost). Each section component renders its
 * own field stack as `children` and wires up its `<form>` element on
 * the wrapping component (this scaffolding is purely visual).
 *
 * @module components/admin/settings/SectionShell
 */

import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

export interface SectionShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** Form-level error message (e.g. server validation aggregate). */
  error?: string | null;
  isLoading?: boolean;
  isSaving?: boolean;
  isDirty?: boolean;
  onSave: () => void;
  onReset?: () => void;
  /** When set, render an "updated" hint under the action row. */
  updatedAt?: string;
  updatedBy?: string;
}

function formatUpdated(iso?: string): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

export function SectionShell({
  title,
  description,
  children,
  error,
  isLoading = false,
  isSaving = false,
  isDirty = false,
  onSave,
  onReset,
  updatedAt,
  updatedBy,
}: SectionShellProps) {
  const updated = formatUpdated(updatedAt);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="space-y-5"
    >
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          [§ {title.toUpperCase()}]
        </p>
        <h2 className="mt-1 font-display text-lg font-semibold uppercase tracking-tight text-strong">
          {title}
        </h2>
        {description && (
          <p className="mt-1 font-text text-sm text-meta">{description}</p>
        )}
      </header>

      <Card>
        {isLoading ? <Skeleton lines={6} /> : children}
      </Card>

      {error && (
        <p
          role="alert"
          className="rounded border border-danger/40 bg-danger-soft px-3 py-2 font-mono text-[11px] text-danger"
        >
          {error}
        </p>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 rounded border border-subtle bg-elevated/40 px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
          {isDirty
            ? "Unsaved changes"
            : updated
            ? `Last updated ${updated}${updatedBy ? ` · ${updatedBy}` : ""}`
            : "Up to date"}
        </div>
        <div className="flex items-center gap-2">
          {onReset && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onReset}
              disabled={!isDirty || isSaving}
            >
              Reset
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            loading={isSaving}
            disabled={!isDirty || isSaving}
          >
            Save
          </Button>
        </div>
      </footer>
    </form>
  );
}
