/**
 * SkillsetPermissionsModal — per-skillset visibility editor.
 *
 * A DUPLICATE of the skills `PermissionsModal`, bound to `SkillsetDetail` +
 * `useUpdateSkillsetPermissions` (the skills modal is left untouched — it
 * couples to `SkillDetail` + `useUpdateSkillPermissions`). Same UX: broader at
 * the top (Public), narrower at the bottom (Private), with org + user grants
 * in between. Saving is unconditional — `PUT /api/v1/skillsets/:id/permissions`
 * applies the desired state directly.
 *
 * @module components/skillset/SkillsetPermissionsModal
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useMyOrgs } from "@/hooks/useMe";
import { useUpdateSkillsetPermissions } from "@/hooks/useSkillsets";
import { useToastStore } from "@/stores/toastStore";
import {
  searchUsersByEmail,
  resolveUsers,
  fetchOrgSummary,
  type UserDirectoryEntry,
} from "@/services/usersApi";
import type { SkillsetDetail } from "@/types/skillset";
import { translateError } from "@/utils/translateError";

interface SkillsetPermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  skillset: SkillsetDetail;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

export function SkillsetPermissionsModal({
  isOpen,
  onClose,
  skillset,
}: SkillsetPermissionsModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("permissions.title", "Permissions") as string}
      className="!max-w-3xl"
    >
      {/* Keyed on the ACL signature (+ open) so form state resets by
          construction whenever the modal reopens or the ACLs change (#888). */}
      <PermissionsForm
        key={`${isOpen ? "open" : "closed"}:${skillset.guid}:${skillset.isPrivate}:${skillset.sharedWithOrgs.join(",")}:${skillset.sharedWithUsers.join(",")}`}
        skillset={skillset}
        onClose={onClose}
        t={t}
      />
    </Modal>
  );
}

interface PermissionsFormProps {
  skillset: SkillsetDetail;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}

function PermissionsForm({ skillset, onClose, t }: PermissionsFormProps) {
  const addToast = useToastStore((s) => s.addToast);
  const { data: myOrgs = [] } = useMyOrgs();
  const permissionsMutation = useUpdateSkillsetPermissions(skillset.guid, skillset.name);

  const [isPublic, setIsPublic] = useState<boolean>(!skillset.isPrivate);
  const [sharedUsers, setSharedUsers] = useState<UserDirectoryEntry[]>(() =>
    skillset.sharedWithUsers.map((id) => ({ userId: id, email: "", displayName: id })),
  );
  const [sharedOrgIds, setSharedOrgIds] = useState<string[]>(skillset.sharedWithOrgs);
  const [userQuery, setUserQuery] = useState("");
  const [userInputFocused, setUserInputFocused] = useState(false);
  const userInputRef = useRef<HTMLInputElement>(null);

  // Resolve saved user_ids into email/displayName once the form mounts.
  useEffect(() => {
    const ids = skillset.sharedWithUsers;
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const resolved = await resolveUsers(ids).catch(() => []);
      if (cancelled || resolved.length === 0) return;
      const byId = new Map(resolved.map((r) => [r.userId, r]));
      setSharedUsers((prev) => prev.map((existing) => byId.get(existing.userId) ?? existing));
    })();
    return () => {
      cancelled = true;
    };
  }, [skillset]);

  const debouncedQuery = useDebouncedValue(userQuery.trim(), 200);
  const shouldSearch = !isPublic && (userInputFocused || debouncedQuery.length > 0);
  const { data: suggestions = [] } = useQuery({
    queryKey: ["users-search", debouncedQuery],
    queryFn: () => searchUsersByEmail(debouncedQuery, 8),
    enabled: shouldSearch,
    staleTime: 10_000,
  });

  const unknownOrgIds = useMemo(
    () => sharedOrgIds.filter((id) => !myOrgs.some((o) => o.userId === id)),
    [sharedOrgIds, myOrgs],
  );
  const { data: fetchedUnknownOrgs = [] } = useQuery({
    queryKey: ["orgs-backfill", unknownOrgIds.sort().join(",")],
    queryFn: async () => {
      const resolved = await Promise.all(unknownOrgIds.map((id) => fetchOrgSummary(id)));
      return resolved.map((entry, i) => {
        const orgId = unknownOrgIds[i]!;
        return entry
          ? { ...entry, isUnresolved: false }
          : { userId: orgId, displayName: orgId, avatarUrl: null, isUnresolved: true };
      });
    },
    enabled: unknownOrgIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const allOrgOptions = useMemo(() => {
    const map = new Map<
      string,
      { userId: string; displayName: string; isMember: boolean; isUnresolved: boolean }
    >();
    for (const o of myOrgs) {
      map.set(o.userId, { userId: o.userId, displayName: o.displayName, isMember: true, isUnresolved: false });
    }
    for (const o of fetchedUnknownOrgs) {
      if (!map.has(o.userId)) {
        map.set(o.userId, {
          userId: o.userId,
          displayName: o.displayName,
          isMember: false,
          isUnresolved: o.isUnresolved,
        });
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
    setUserInputFocused(false);
    userInputRef.current?.blur();
  };

  const removeUser = (userId: string) => {
    setSharedUsers((prev) => prev.filter((u) => u.userId !== userId));
  };

  const orgsActive = !isPublic && sharedOrgIds.length > 0;
  const usersActive = !isPublic && sharedUsers.length > 0;
  const privateActive = !isPublic && !orgsActive && !usersActive;

  const handleSave = async () => {
    const beforePrivate = skillset.isPrivate;
    const beforeUsers = new Set(skillset.sharedWithUsers);
    const beforeOrgs = new Set(skillset.sharedWithOrgs);
    const afterPrivate = !isPublic;

    const privateChanged = beforePrivate !== afterPrivate;
    const usersChanged =
      sharedUsers.length !== beforeUsers.size ||
      sharedUsers.some((u) => !beforeUsers.has(u.userId));
    const orgsChanged =
      sharedOrgIds.length !== beforeOrgs.size ||
      sharedOrgIds.some((id) => !beforeOrgs.has(id));

    if (!privateChanged && !usersChanged && !orgsChanged) {
      addToast({ type: "info", message: t("permissions.noChanges", "No changes to save.") });
      onClose();
      return;
    }

    try {
      await permissionsMutation.mutateAsync({
        isPrivate: !isPublic,
        sharedWithUsers: sharedUsers.map((u) => u.userId),
        sharedWithOrgs: sharedOrgIds,
      });
      addToast({ type: "success", message: t("permissions.saveSuccess", "Permissions updated") });
      onClose();
    } catch (err) {
      addToast({ type: "error", message: translateError(err) });
    }
  };

  return (
    <>
      <div className="flex gap-4">
        <div className="flex flex-col items-center py-1 shrink-0" aria-hidden>
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4 text-accent"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="4 10 8 6 12 10" />
          </svg>
          <div className="flex-1 w-px my-1 bg-gradient-to-b from-accent/70 via-accent/25 to-accent/5" />
        </div>

        <div className="flex-1">
          <SectionHeader label={t("permissions.levelPublic", "Public access") as string} />
          <TierCard active={isPublic} accent="public" onToggle={() => setIsPublic((v) => !v)}>
            <label className="flex items-start gap-3 cursor-pointer w-full">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 rounded border-accent/40 accent-accent"
              />
              <div className="flex-1">
                <p className="font-display text-base text-strong">
                  {t("permissions.publicTitle", "Public")}
                </p>
                <p className="mt-0.5 font-text text-sm text-meta">
                  {t(
                    "skillsetPermissions.publicDesc",
                    "Anyone on Ornn can find and use this skillset, including unauthenticated visitors.",
                  )}
                </p>
              </div>
            </label>
          </TierCard>

          <SectionHeader label={t("permissions.levelLimited", "Limited access") as string} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TierCard active={orgsActive} dimmed={isPublic} accent="limited" className="p-4">
              <p className="font-display text-base text-strong">
                {t("permissions.orgsTitle", "Shared with organizations")}
              </p>
              <p className="mt-0.5 font-text text-sm text-meta">
                {t(
                  "skillsetPermissions.orgsDesc",
                  "Every admin and member of a checked org can see and use this skillset.",
                )}
              </p>
              <div
                className={`mt-3 max-h-48 overflow-y-auto space-y-1.5 pr-1 ${
                  isPublic ? "opacity-60 pointer-events-none" : ""
                }`}
              >
                {allOrgOptions.length === 0 && (
                  <p className="font-text text-xs text-meta italic">
                    {t("permissions.noOrgs", "No organizations to choose from.")}
                  </p>
                )}
                {allOrgOptions.map((org) => {
                  const checked = sharedOrgIds.includes(org.userId);
                  return (
                    <label
                      key={org.userId}
                      className={`flex items-center gap-2 cursor-pointer py-1 px-2 rounded hover:bg-accent/5 ${
                        org.isUnresolved ? "bg-warning-soft/40" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOrg(org.userId)}
                        className="h-4 w-4 rounded border-accent/40 accent-accent"
                      />
                      <span className="font-text text-sm text-strong truncate">{org.displayName}</span>
                      {org.isUnresolved ? (
                        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-warning">
                          {t("permissions.orgUnresolved", "unresolved")}
                        </span>
                      ) : !org.isMember ? (
                        <span className="font-mono text-[10px] text-meta ml-auto">
                          {t("permissions.notMember", "not member")}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </TierCard>

            <TierCard active={usersActive} dimmed={isPublic} accent="limited" className="p-4">
              <p className="font-display text-base text-strong">
                {t("permissions.usersTitle", "Shared with specific users")}
              </p>
              <p className="mt-0.5 font-text text-sm text-meta">
                {t(
                  "permissions.usersDesc",
                  "Search by email. Only users who have signed into Ornn appear here.",
                )}
              </p>
              <div
                className={`mt-3 flex flex-wrap gap-1.5 min-h-[2rem] ${
                  isPublic ? "opacity-60 pointer-events-none" : ""
                }`}
              >
                {sharedUsers.map((u) => (
                  <span
                    key={u.userId}
                    className="inline-flex items-center gap-2 px-2 py-1 rounded-full border border-accent/30 bg-accent/5 text-strong font-mono text-xs h-fit"
                  >
                    <span>{u.email || u.displayName || u.userId}</span>
                    <button
                      type="button"
                      onClick={() => removeUser(u.userId)}
                      className="text-danger hover:text-danger/80 cursor-pointer"
                      aria-label={t("permissions.removeUser", "Remove") as string}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {sharedUsers.length === 0 && (
                  <p className="font-text text-xs text-meta italic w-full">
                    {t("permissions.noUsersYet", "No users added yet.")}
                  </p>
                )}
              </div>
              <div className="relative mt-3">
                <input
                  ref={userInputRef}
                  type="text"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  onFocus={() => setUserInputFocused(true)}
                  onBlur={() => setTimeout(() => setUserInputFocused(false), 150)}
                  placeholder={
                    t("permissions.searchPlaceholder", "type an email to find a user...") as string
                  }
                  className="w-full rounded border border-accent/20 bg-elevated px-3 py-2 font-text text-sm text-strong focus:outline-none focus:border-accent/60"
                  disabled={isPublic}
                />
                {userInputFocused && suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 bottom-full mb-1 z-10 rounded border border-accent/20 bg-card card-impression max-h-52 overflow-y-auto">
                    {suggestions.map((s) => (
                      <button
                        key={s.userId}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addUser(s);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left font-text text-sm hover:bg-accent/10 cursor-pointer"
                      >
                        <span className="text-strong truncate">{s.displayName || s.email}</span>
                        <span className="ml-auto font-mono text-xs text-meta truncate">{s.email}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </TierCard>
          </div>

          <SectionHeader label={t("permissions.levelPrivate", "Private access") as string} />
          <TierCard active={privateActive} dimmed={isPublic} accent="private">
            <p className="font-display text-base text-strong">
              {t("permissions.privateTitle", "Private")}
            </p>
            <p className="mt-0.5 font-text text-sm text-meta">
              {t(
                "skillsetPermissions.privateDesc",
                "Only you and platform admins can see this skillset. Active when nothing above is set.",
              )}
            </p>
          </TierCard>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 mt-5 border-t border-accent/10">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button onClick={handleSave} loading={permissionsMutation.isPending}>
          {t("common.save", "Save")}
        </Button>
      </div>
    </>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="mt-5 mb-3 first:mt-0 flex items-center gap-3" aria-hidden>
      <div className="flex-1 h-px bg-accent/15" />
      <span className="font-mono text-[10px] uppercase tracking-widest text-meta shrink-0">{label}</span>
      <div className="flex-1 h-px bg-accent/15" />
    </div>
  );
}

interface TierCardProps {
  active: boolean;
  dimmed?: boolean;
  accent: "public" | "limited" | "private";
  onToggle?: () => void;
  className?: string;
  children: ReactNode;
}

const TIER_ACTIVE_CLASS: Record<TierCardProps["accent"], string> = {
  public: "border-success/60 bg-success-soft",
  limited: "border-warning/60 bg-warning-soft",
  private: "border-info/60 bg-info-soft",
};

function TierCard({ active, dimmed = false, accent, onToggle, className = "", children }: TierCardProps) {
  const ringClass = active ? TIER_ACTIVE_CLASS[accent] : "border-subtle bg-elevated/40";
  const dimmedClass = dimmed ? "opacity-60" : "";
  return (
    <div
      onClick={onToggle}
      className={`rounded border p-4 transition-colors ${ringClass} ${dimmedClass} ${className} ${
        onToggle ? "cursor-pointer" : ""
      }`}
    >
      {children}
    </div>
  );
}
