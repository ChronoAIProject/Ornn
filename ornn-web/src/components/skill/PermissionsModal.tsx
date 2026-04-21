/**
 * PermissionsModal — per-skill visibility editor.
 *
 * Four tiers from smallest to largest scope:
 *   1. Private — only the author + platform admin can read.
 *   2. Selected users — explicit per-user grants (by email, typeahead).
 *   3. Selected orgs — every admin/member of each chosen org can read.
 *   4. Public — anyone can read; user/org grants are kept but inert.
 *
 * Tiers combine freely — e.g. a "private" skill with both users + orgs
 * granted is how the owner gives a small working group access without
 * going fully public.
 *
 * Backend is authoritative for authorization — the modal only gates which
 * controls to render. An author or platform admin can open it; anyone
 * else never sees the trigger.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useMyOrgs } from "@/hooks/useMe";
import { useUpdateSkillPermissions } from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";
import { searchUsersByEmail, fetchOrgSummary, type UserDirectoryEntry } from "@/services/usersApi";
import type { SkillDetail } from "@/types/domain";

interface PermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  skill: SkillDetail;
}

/** Debounce hook — keeps the typeahead API call rate reasonable. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function PermissionsModal({ isOpen, onClose, skill }: PermissionsModalProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: myOrgs = [] } = useMyOrgs();
  const permissionsMutation = useUpdateSkillPermissions(skill.guid);

  // Form state — seeded from the skill on open, edited locally, flushed on save.
  const [isPrivate, setIsPrivate] = useState(skill.isPrivate);
  const [sharedUsers, setSharedUsers] = useState<UserDirectoryEntry[]>([]);
  const [sharedOrgIds, setSharedOrgIds] = useState<string[]>(skill.sharedWithOrgs);
  const [userQuery, setUserQuery] = useState("");

  // Reset form whenever the modal re-opens on a different skill version.
  useEffect(() => {
    if (!isOpen) return;
    setIsPrivate(skill.isPrivate);
    setSharedOrgIds(skill.sharedWithOrgs);
    setUserQuery("");
    // Placeholder entries while the lookups run; replaced as each user resolves.
    setSharedUsers(
      skill.sharedWithUsers.map((id) => ({
        userId: id,
        email: "",
        displayName: id,
      })),
    );
  }, [isOpen, skill]);

  // Resolve any saved user_ids that don't have an email/displayName yet.
  // We piggyback on the email search endpoint by fetching a placeholder when
  // the caller opens the modal. It's one directory call per unresolved user,
  // but in practice sharedWithUsers is short (<50).
  // Keeping this off the first render avoids a cascade when the list is empty.
  useEffect(() => {
    const needResolve = sharedUsers.filter((u) => !u.email);
    if (needResolve.length === 0) return;
    let cancelled = false;
    (async () => {
      const resolved = await Promise.all(
        needResolve.map(async (u) => {
          // Directory search is email-keyed; we can't back-resolve a userId
          // unless it happens to have ever logged into Ornn. If we miss,
          // we just display the raw id.
          const rows = await searchUsersByEmail(u.userId, 1).catch(() => []);
          const hit = rows.find((r) => r.userId === u.userId);
          return hit ?? u;
        }),
      );
      if (cancelled) return;
      setSharedUsers((prev) =>
        prev.map((existing) => resolved.find((r) => r.userId === existing.userId) ?? existing),
      );
    })();
    return () => {
      cancelled = true;
    };
    // Run once per modal open — the initial sharedUsers list is stable then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Typeahead
  const debouncedQuery = useDebouncedValue(userQuery.trim(), 200);
  const { data: suggestions = [] } = useQuery({
    queryKey: ["users-search", debouncedQuery],
    queryFn: () => searchUsersByEmail(debouncedQuery, 8),
    enabled: debouncedQuery.length >= 2,
    staleTime: 10_000,
  });

  // Back-fill display names for orgs the caller no longer belongs to so the
  // existing chips still render human labels.
  const unknownOrgIds = useMemo(
    () => sharedOrgIds.filter((id) => !myOrgs.some((o) => o.userId === id)),
    [sharedOrgIds, myOrgs],
  );
  const { data: fetchedUnknownOrgs = [] } = useQuery({
    queryKey: ["orgs-backfill", unknownOrgIds.sort().join(",")],
    queryFn: async () => {
      const resolved = await Promise.all(unknownOrgIds.map((id) => fetchOrgSummary(id)));
      return resolved
        .map((entry, i) => entry ?? { userId: unknownOrgIds[i], displayName: unknownOrgIds[i], avatarUrl: null })
        .filter((e) => !!e);
    },
    enabled: isOpen && unknownOrgIds.length > 0,
    staleTime: 5 * 60_000,
  });

  // Combined org list for rendering checkboxes + labels. De-duplicated by id
  // so an org the caller belongs to doesn't also appear under "other".
  const allOrgOptions = useMemo(() => {
    const map = new Map<string, { userId: string; displayName: string; isMember: boolean }>();
    for (const o of myOrgs) {
      map.set(o.userId, { userId: o.userId, displayName: o.displayName, isMember: true });
    }
    for (const o of fetchedUnknownOrgs) {
      if (!map.has(o.userId)) {
        map.set(o.userId, { userId: o.userId, displayName: o.displayName, isMember: false });
      }
    }
    return Array.from(map.values());
  }, [myOrgs, fetchedUnknownOrgs]);

  const toggleOrg = (orgId: string) => {
    setSharedOrgIds((prev) =>
      prev.includes(orgId) ? prev.filter((id) => id !== orgId) : [...prev, orgId],
    );
  };

  const addUser = (entry: UserDirectoryEntry) => {
    if (sharedUsers.some((u) => u.userId === entry.userId)) return;
    setSharedUsers((prev) => [...prev, entry]);
    setUserQuery("");
  };

  const removeUser = (userId: string) => {
    setSharedUsers((prev) => prev.filter((u) => u.userId !== userId));
  };

  const handleSave = async () => {
    try {
      await permissionsMutation.mutateAsync({
        isPrivate,
        sharedWithUsers: sharedUsers.map((u) => u.userId),
        sharedWithOrgs: sharedOrgIds,
      });
      addToast({ type: "success", message: t("permissions.saveSuccess", "Permissions updated") });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: "error", message });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("permissions.title", "Permissions") as string}>
      <div className="space-y-5">
        {/* Visibility tier */}
        <div>
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!isPrivate}
              onChange={(e) => setIsPrivate(!e.target.checked)}
              className="mt-1 h-4 w-4 accent-neon-green cursor-pointer"
            />
            <span className="font-body text-sm text-text-primary">
              <span className="block font-semibold">
                {t("permissions.publicLabel", "Public")}
              </span>
              <span className="block text-xs text-text-muted mt-0.5">
                {t(
                  "permissions.publicHint",
                  "Anyone on Ornn can find and use this skill, including unauthenticated visitors.",
                )}
              </span>
            </span>
          </label>
        </div>

        {/* When private, surface the two sharing tiers */}
        {isPrivate && (
          <>
            <div className="border-t border-neon-cyan/10 pt-4">
              <p className="font-body text-sm font-semibold text-text-primary mb-2">
                {t("permissions.sharedOrgsLabel", "Shared with organizations")}
              </p>
              <p className="font-body text-xs text-text-muted mb-3">
                {t(
                  "permissions.sharedOrgsHint",
                  "Every admin and member of a checked org can see and use this skill.",
                )}
              </p>
              {allOrgOptions.length === 0 ? (
                <p className="font-body text-xs text-text-muted italic">
                  {t("permissions.noOrgs", "You are not in any organizations yet.")}
                </p>
              ) : (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {allOrgOptions.map((org) => (
                    <label key={org.userId} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sharedOrgIds.includes(org.userId)}
                        onChange={() => toggleOrg(org.userId)}
                        className="h-4 w-4 accent-neon-cyan cursor-pointer"
                      />
                      <span className="font-body text-sm text-text-primary">
                        {org.displayName}
                        {!org.isMember && (
                          <span className="ml-2 text-xs text-text-muted italic">
                            {t("permissions.notAMember", "(not a member)")}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-neon-cyan/10 pt-4">
              <p className="font-body text-sm font-semibold text-text-primary mb-2">
                {t("permissions.sharedUsersLabel", "Shared with specific users")}
              </p>
              <p className="font-body text-xs text-text-muted mb-3">
                {t(
                  "permissions.sharedUsersHint",
                  "Search by email. Only users who have signed into Ornn appear here.",
                )}
              </p>

              {/* Current chips */}
              {sharedUsers.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {sharedUsers.map((u) => (
                    <span
                      key={u.userId}
                      className="
                        inline-flex items-center gap-2 px-2 py-1 rounded-full
                        border border-neon-cyan/30 bg-neon-cyan/5
                        font-mono text-xs text-text-primary
                      "
                    >
                      <span>{u.email || u.displayName || u.userId}</span>
                      <button
                        type="button"
                        onClick={() => removeUser(u.userId)}
                        className="text-neon-red hover:text-neon-red/80 cursor-pointer"
                        aria-label={t("permissions.removeUser", "Remove")}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Search box + dropdown */}
              <div className="relative">
                <input
                  type="text"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder={t("permissions.searchPlaceholder", "type an email to find a user...") as string}
                  className="
                    w-full glass rounded-lg border border-neon-cyan/20 bg-bg-elevated
                    px-3 py-2 font-body text-sm text-text-primary
                    focus:outline-none focus:border-neon-cyan/60
                  "
                />
                {debouncedQuery.length >= 2 && suggestions.length > 0 && (
                  <div
                    className="
                      absolute left-0 right-0 top-full mt-1 z-10
                      max-h-48 overflow-y-auto
                      glass rounded-lg border border-neon-cyan/30 shadow-lg shadow-neon-cyan/10
                    "
                  >
                    {suggestions.map((s) => {
                      const alreadyAdded = sharedUsers.some((u) => u.userId === s.userId);
                      return (
                        <button
                          key={s.userId}
                          type="button"
                          disabled={alreadyAdded}
                          onClick={() => addUser(s)}
                          className={`
                            w-full text-left px-3 py-2 font-body text-sm transition-colors
                            ${alreadyAdded
                              ? "text-text-muted cursor-not-allowed"
                              : "text-text-primary cursor-pointer hover:bg-neon-cyan/10"}
                          `}
                        >
                          <div className="truncate">{s.email}</div>
                          {s.displayName && (
                            <div className="text-xs text-text-muted truncate">{s.displayName}</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {debouncedQuery.length >= 2 && suggestions.length === 0 && (
                  <p className="font-body text-xs text-text-muted mt-2">
                    {t("permissions.noUserMatches", "No user matches that email.")}
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-neon-cyan/10">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={handleSave} loading={permissionsMutation.isPending}>
            {t("common.save", "Save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
