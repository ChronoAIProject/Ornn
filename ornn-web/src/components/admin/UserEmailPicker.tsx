/**
 * UserEmailPicker — debounced email-search + chip multi-select.
 *
 * Type into the search field; matching users surface from
 * `GET /api/v1/admin/users?role=normal&q=...` (300 ms debounce).
 * Click a row to add as a chip; click "×" on a chip to remove. Returns
 * `string[]` of `userId` values via `onChange`.
 *
 * Scoped to `role=normal` for targeted-broadcast recipient picking —
 * an admin sending a broadcast targets end-users, not other admins.
 * If a different scope is ever needed, lift `role` into a prop.
 *
 * @module components/admin/UserEmailPicker
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { fetchAdminUsers, type AdminUserRow } from "@/services/adminUsersApi";
import { useDebounce } from "@/hooks/useDebounce";

const SEARCH_DEBOUNCE_MS = 300;
const RESULT_CAP = 10;

export interface UserEmailPickerProps {
  /** Currently-selected user_ids. */
  value: string[];
  /** Fires with the next selection on add or remove. */
  onChange: (next: string[]) => void;
  /** Disable input + chip removal (e.g. while saving). */
  disabled?: boolean;
  /** Override the visible-label cap for resolved emails. */
  className?: string;
}

interface ResolvedRow {
  userId: string;
  email: string;
  displayName: string;
}

/**
 * Resolve already-selected user_ids back to display emails by piggy-
 * backing on the cached admin-users pages React Query has in memory.
 * Falls back to the bare userId so a freshly-pasted id still renders
 * a deterministic chip.
 */
function useResolvedSelection(value: string[]): Map<string, ResolvedRow> {
  // Pull the most recent search payload so chips can render emails the
  // user has actually seen in the dropdown. This is best-effort: if a
  // chip's id isn't in cache we fall back to the id itself.
  const recent = useQuery({
    queryKey: ["admin", "users", "picker-resolve", value],
    enabled: value.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      // Pull the first big page of normal users — admin user lists are
      // small enough that this is cheaper than batching id-by-id and
      // simpler than threading a dedicated lookup endpoint through
      // backend just for chip rendering. If the list grows past the
      // page cap we'd swap this for a real lookup endpoint.
      const page = await fetchAdminUsers({
        role: "normal",
        page: 1,
        pageSize: 200,
      });
      return page.items;
    },
  });

  return useMemo(() => {
    const map = new Map<string, ResolvedRow>();
    for (const row of recent.data ?? []) {
      map.set(row.userId, {
        userId: row.userId,
        email: row.email,
        displayName: row.displayName,
      });
    }
    return map;
  }, [recent.data]);
}

export function UserEmailPicker({
  value,
  onChange,
  disabled = false,
  className = "",
}: UserEmailPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query.trim(), SEARCH_DEBOUNCE_MS);
  const selectedSet = useMemo(() => new Set(value), [value]);
  const resolved = useResolvedSelection(value);

  const searchQuery = useQuery({
    queryKey: ["admin", "users", "picker-search", debouncedQuery],
    enabled: debouncedQuery.length > 0,
    staleTime: 10_000,
    queryFn: async () => {
      const page = await fetchAdminUsers({
        role: "normal",
        q: debouncedQuery,
        page: 1,
        pageSize: RESULT_CAP,
      });
      return page.items;
    },
  });

  const visibleResults: AdminUserRow[] = useMemo(() => {
    const rows = searchQuery.data ?? [];
    return rows.filter((r) => !selectedSet.has(r.userId));
  }, [searchQuery.data, selectedSet]);

  useEffect(() => {
    if (!open) return;
    const handler = (ev: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(ev.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const addUser = (row: AdminUserRow) => {
    if (selectedSet.has(row.userId)) return;
    onChange([...value, row.userId]);
    setQuery("");
    // Keep the dropdown open so the admin can pile-add a handful of
    // recipients before closing — fewer keyboard round-trips.
    setOpen(true);
  };

  const removeUser = (userId: string) => {
    onChange(value.filter((id) => id !== userId));
  };

  const showDropdown =
    open && debouncedQuery.length > 0 && !disabled;

  return (
    <div ref={containerRef} className={`flex flex-col gap-2 ${className}`}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((userId) => {
            const row = resolved.get(userId);
            const label = row?.email ?? userId;
            const hint = row?.displayName;
            return (
              <span
                key={userId}
                className="inline-flex items-center gap-1.5 rounded-sm border border-subtle bg-elevated/60 px-2 py-1 font-mono text-[11px] text-strong"
                title={hint}
              >
                <span className="truncate max-w-[220px]">{label}</span>
                <button
                  type="button"
                  onClick={() => removeUser(userId)}
                  disabled={disabled}
                  aria-label={t("adminPages.broadcasts.recipients.remove", {
                    email: label,
                  })}
                  className="-mr-1 inline-flex h-4 w-4 items-center justify-center rounded-sm text-meta transition-colors hover:bg-danger/20 hover:text-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-40"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className="h-3 w-3"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          placeholder={t("adminPages.broadcasts.recipients.searchPlaceholder")}
          aria-label={t("adminPages.broadcasts.recipients.searchAria")}
          className="w-full rounded-sm border border-subtle bg-elevated/40 px-3 py-2 font-text text-sm text-strong placeholder:text-meta/70 transition-colors duration-150 focus:border-accent focus:bg-card focus:outline-none disabled:opacity-50"
        />

        {showDropdown && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-sm border border-subtle bg-card shadow-lg">
            {searchQuery.isLoading ? (
              <div className="px-3 py-2 font-text text-xs text-meta">
                {t("adminPages.broadcasts.recipients.loading")}
              </div>
            ) : visibleResults.length === 0 ? (
              <div className="px-3 py-2 font-text text-xs text-meta">
                {t("adminPages.broadcasts.recipients.noMatches")}
              </div>
            ) : (
              visibleResults.map((row) => (
                <button
                  key={row.userId}
                  type="button"
                  onClick={() => addUser(row)}
                  className="flex w-full flex-col gap-0.5 border-b border-subtle/40 px-3 py-2 text-left transition-colors hover:bg-elevated/60 focus-visible:bg-elevated/60 focus-visible:outline-none last:border-b-0"
                >
                  <span className="font-mono text-[11px] text-strong">
                    {row.email}
                  </span>
                  {row.displayName && (
                    <span className="font-text text-[11px] text-meta">
                      {row.displayName}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
