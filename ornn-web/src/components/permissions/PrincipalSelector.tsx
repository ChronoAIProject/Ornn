/**
 * PrincipalSelector — pick a set of orgs + users for one access audience
 * (#1125). Reusable across the Read and Write tabs of the permissions editor
 * and across the skill + skillset modals (it consolidates the org-checkbox +
 * user-email-typeahead logic that used to be duplicated in each modal).
 *
 * Presentational: org options are supplied by the parent (which owns the
 * `useMyOrgs` + unknown-org backfill); this component owns only the
 * per-input typeahead state. It emits a flat `Principal[]` for its audience.
 *
 * @module components/permissions/PrincipalSelector
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { searchUsersByEmail } from "@/services/usersApi";

/** One granted principal within an audience. */
export interface Principal {
  type: "user" | "org";
  id: string;
  /** Best-known display label (email / org name); falls back to the id. */
  label: string;
  /** True when the org/user could not be resolved (stale grant). */
  isUnresolved?: boolean;
}

/** An org the caller can choose from (their memberships + any granted unknowns). */
export interface OrgOption {
  id: string;
  label: string;
  isMember: boolean;
  isUnresolved: boolean;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

interface PrincipalSelectorProps {
  value: Principal[];
  onChange: (next: Principal[]) => void;
  orgOptions: OrgOption[];
  disabled?: boolean;
  /** Distinguishes the Read vs Write inputs (keys / a11y). */
  idPrefix: string;
}

export function PrincipalSelector({
  value,
  onChange,
  orgOptions,
  disabled = false,
  idPrefix,
}: PrincipalSelectorProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOrgIds = new Set(value.filter((p) => p.type === "org").map((p) => p.id));
  const selectedUsers = value.filter((p) => p.type === "user");

  const debounced = useDebouncedValue(query.trim(), 200);
  // 2-char minimum mirrors the directory search guard (#816).
  const shouldSearch = !disabled && debounced.length >= 2;
  const { data: suggestions = [] } = useQuery({
    queryKey: ["users-search", debounced],
    queryFn: () => searchUsersByEmail(debounced, 8),
    enabled: shouldSearch,
    staleTime: 10_000,
  });

  const toggleOrg = (opt: OrgOption) => {
    if (selectedOrgIds.has(opt.id)) {
      onChange(value.filter((p) => !(p.type === "org" && p.id === opt.id)));
    } else {
      onChange([...value, { type: "org", id: opt.id, label: opt.label, isUnresolved: opt.isUnresolved }]);
    }
  };

  const addUser = (entry: { userId: string; email: string; displayName: string }) => {
    if (value.some((p) => p.type === "user" && p.id === entry.userId)) return;
    onChange([...value, { type: "user", id: entry.userId, label: entry.email || entry.displayName || entry.userId }]);
    setQuery("");
    setFocused(false);
    inputRef.current?.blur();
  };

  const removeUser = (id: string) =>
    onChange(value.filter((p) => !(p.type === "user" && p.id === id)));

  const dimmed = disabled ? "opacity-60 pointer-events-none" : "";

  return (
    <div className={disabled ? "opacity-70" : ""}>
      {/* Organizations */}
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-meta">
        {t("permissions.orgsLabel", "Organizations")}
      </p>
      <div className={`max-h-40 space-y-1.5 overflow-y-auto pr-1 ${dimmed}`}>
        {orgOptions.length === 0 && (
          <p className="font-text text-xs italic text-meta">
            {t("permissions.noOrgs", "No organizations to choose from.")}
          </p>
        )}
        {orgOptions.map((org) => (
          <label
            key={`${idPrefix}-org-${org.id}`}
            className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent/5 ${
              org.isUnresolved ? "bg-warning-soft/40" : ""
            }`}
            title={
              org.isUnresolved
                ? (t(
                    "permissions.orgUnresolvedTip",
                    "This organization is no longer reachable in NyxID. Uncheck to revoke the stale grant.",
                  ) as string)
                : undefined
            }
          >
            <input
              type="checkbox"
              checked={selectedOrgIds.has(org.id)}
              onChange={() => toggleOrg(org)}
              className="h-4 w-4 rounded border-accent/40 accent-accent"
            />
            <span className="truncate font-text text-sm text-strong">{org.label}</span>
            {org.isUnresolved ? (
              <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-warning">
                {t("permissions.orgUnresolved", "unresolved")}
              </span>
            ) : !org.isMember ? (
              <span className="ml-auto font-mono text-[10px] text-meta">
                {t("permissions.notMember", "not member")}
              </span>
            ) : null}
          </label>
        ))}
      </div>

      {/* Users */}
      <p className="mb-1.5 mt-4 font-mono text-[10px] uppercase tracking-widest text-meta">
        {t("permissions.usersLabel", "Users")}
      </p>
      <div className={`flex min-h-[2rem] flex-wrap gap-1.5 ${dimmed}`}>
        {selectedUsers.map((u) => (
          <span
            key={`${idPrefix}-user-${u.id}`}
            className="inline-flex h-fit items-center gap-2 rounded-full border border-accent/30 bg-accent/5 px-2 py-1 font-mono text-xs text-strong"
          >
            <span>{u.label}</span>
            <button
              type="button"
              onClick={() => removeUser(u.id)}
              className="cursor-pointer text-danger hover:text-danger/80"
              aria-label={t("permissions.removeUser", "Remove") as string}
            >
              ×
            </button>
          </span>
        ))}
        {selectedUsers.length === 0 && (
          <p className="w-full font-text text-xs italic text-meta">
            {t("permissions.noUsersYet", "No users added yet.")}
          </p>
        )}
      </div>
      <div className="relative mt-3">
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={t("permissions.searchPlaceholder", "type an email to find a user...") as string}
          className="w-full rounded border border-accent/20 bg-elevated px-3 py-2 font-text text-sm text-strong focus:border-accent/60 focus:outline-none"
        />
        {focused && !disabled && debounced.length < 2 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-accent/20 bg-card card-impression">
            <p className="px-3 py-2 font-text text-xs italic text-meta">
              {t("permissions.searchHint", "Type at least 2 characters to search.")}
            </p>
          </div>
        )}
        {focused && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-52 overflow-y-auto rounded border border-accent/20 bg-card card-impression">
            {suggestions.map((s) => (
              <button
                key={`${idPrefix}-sugg-${s.userId}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addUser(s);
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left font-text text-sm hover:bg-accent/10"
              >
                <span className="truncate text-strong">{s.displayName || s.email}</span>
                <span className="ml-auto truncate font-mono text-xs text-meta">{s.email}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
