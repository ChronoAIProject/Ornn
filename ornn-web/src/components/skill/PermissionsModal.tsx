/**
 * PermissionsModal — per-skill visibility editor.
 *
 * Axis: broader at the top, narrower at the bottom, with a subtle cyan
 * up-arrow in the left gutter. Four levels:
 *
 *   Public    — anyone on Ornn, incl. unauthenticated visitors
 *   Orgs      — admin/member of each chosen organization (additive)
 *   Users     — explicit per-user grants (email typeahead, additive)
 *   Private   — only the author + platform admin
 *
 * Saving is unconditional — `PUT /api/v1/skills/:id/permissions` applies
 * the desired state directly. Audit runs out-of-band; if it later flags
 * risk, the owner and every consumer receive a notification, but the
 * share itself is never blocked.
 *
 * @module components/skill/PermissionsModal
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useMyOrgs } from "@/hooks/useMe";
import { useUpdateSkillPermissions } from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";
import {
  searchUsersByEmail,
  resolveUsers,
  fetchOrgSummary,
  type UserDirectoryEntry,
} from "@/services/usersApi";
import type { SkillDetail, SkillGrant, SkillPermissionLevel } from "@/types/domain";
import { translateError } from "@/utils/translateError";

/** A selected user grant carries its permission level alongside the label. */
type UserGrantEntry = UserDirectoryEntry & { level: SkillPermissionLevel };

/**
 * Resolve the skill's initial typed grants. Prefers the canonical `grants`
 * field; falls back to deriving READ-level grants from the legacy lists for
 * older cached payloads (#1123).
 */
function initialGrantsOf(skill: SkillDetail): SkillGrant[] {
  if (skill.grants) return skill.grants;
  return [
    ...skill.sharedWithUsers.map((id) => ({ type: "user" as const, id, level: "read" as const })),
    ...skill.sharedWithOrgs.map((id) => ({ type: "org" as const, id, level: "read" as const })),
  ];
}

/** Stable signature of a grant set for change-detection (order-independent). */
function grantSignature(grants: SkillGrant[]): string {
  return grants.map((g) => `${g.type}:${g.id}:${g.level}`).sort().join("|");
}

interface PermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  skill: SkillDetail;
}

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
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("permissions.title", "Permissions") as string}
      className="!max-w-3xl"
    >
      {/* Keyed on the skill's ACL signature (+ open) so the form's state
          resets by construction whenever the modal reopens or the
          underlying ACLs change — no synchronous reset effect, no
          cascading render (#888). The outer Modal owns the open/close
          animation, so its AnimatePresence stays stable. */}
      <PermissionsForm
        key={`${isOpen ? "open" : "closed"}:${skill.guid}:${skill.isPrivate}:${grantSignature(initialGrantsOf(skill))}`}
        skill={skill}
        onClose={onClose}
        t={t}
      />
    </Modal>
  );
}

interface PermissionsFormProps {
  skill: SkillDetail;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}

function PermissionsForm({ skill, onClose, t }: PermissionsFormProps) {
  const addToast = useToastStore((s) => s.addToast);
  const { data: myOrgs = [] } = useMyOrgs();
  const permissionsMutation = useUpdateSkillPermissions(skill.guid);

  // Lazy init from the skill's typed grants — the very first render is
  // already in the reset state, so no synchronous setState-in-effect is
  // needed. Re-open / ACL-change resets via the `key` at the call site.
  const initialGrants = initialGrantsOf(skill);
  const [isPublic, setIsPublic] = useState<boolean>(!skill.isPrivate);
  const [sharedUsers, setSharedUsers] = useState<UserGrantEntry[]>(() =>
    initialGrants
      .filter((g) => g.type === "user")
      .map((g) => ({ userId: g.id, email: "", displayName: g.id, level: g.level })),
  );
  const [sharedOrgIds, setSharedOrgIds] = useState<string[]>(() =>
    initialGrants.filter((g) => g.type === "org").map((g) => g.id),
  );
  // Per-org level, keyed by org id. Only checked orgs are read on save.
  const [orgLevels, setOrgLevels] = useState<Record<string, SkillPermissionLevel>>(() =>
    Object.fromEntries(
      initialGrants.filter((g) => g.type === "org").map((g) => [g.id, g.level]),
    ),
  );
  const [userQuery, setUserQuery] = useState("");
  const [userInputFocused, setUserInputFocused] = useState(false);
  const userInputRef = useRef<HTMLInputElement>(null);

  // Resolve saved user_ids into email/displayName once the form mounts.
  // This is a genuine external-system sync (user directory API) and only
  // setStates from the async callback, never synchronously in the effect
  // body — so it doesn't trip set-state-in-effect (#888).
  useEffect(() => {
    const ids = skill.sharedWithUsers;
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const resolved = await resolveUsers(ids).catch(() => []);
      if (cancelled || resolved.length === 0) return;
      const byId = new Map(resolved.map((r) => [r.userId, r]));
      setSharedUsers((prev) =>
        prev.map((existing) => {
          const hit = byId.get(existing.userId);
          // Merge the resolved label but PRESERVE the grant's level (#1123).
          return hit ? { ...hit, level: existing.level } : existing;
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [skill]);

  const debouncedQuery = useDebouncedValue(userQuery.trim(), 200);
  // Only query at 2+ chars. The backend now rejects empty/1-char `q` with
  // 400 (#816), so firing on bare focus or a single keystroke would surface
  // an error toast for a query the user never finished typing. Below the
  // threshold we render a "keep typing" hint instead of a results list.
  const shouldSearch = !isPublic && debouncedQuery.length >= 2;
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
        // `i` is bounded by `unknownOrgIds.length` (Promise.all preserves
        // indexing). `!` is safe under noUncheckedIndexedAccess (#450).
        const orgId = unknownOrgIds[i]!;
        // #720 — entry is null when NyxID couldn't resolve the id (org
        // deleted, or caller can't see it). Keep the row visible so
        // the owner can revoke, but flag `isUnresolved` so the chip
        // gets the warning treatment.
        return entry
          ? { ...entry, isUnresolved: false }
          : { userId: orgId, displayName: orgId, avatarUrl: null, isUnresolved: true };
      });
    },
    // The form only mounts while the modal is open (Modal renders its
    // children conditionally), so the prior `isOpen &&` gate is implicit.
    enabled: unknownOrgIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const allOrgOptions = useMemo(() => {
    const map = new Map<string, { userId: string; displayName: string; isMember: boolean; isUnresolved: boolean }>();
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
    // New grants default to read; preserve an existing level on re-check.
    setOrgLevels((prev) => (prev[orgId] ? prev : { ...prev, [orgId]: "read" }));
  };

  const setOrgLevel = (orgId: string, level: SkillPermissionLevel) => {
    setOrgLevels((prev) => ({ ...prev, [orgId]: level }));
  };

  const addUser = (entry: UserDirectoryEntry) => {
    if (sharedUsers.some((u) => u.userId === entry.userId)) return;
    // New per-user grants default to read.
    setSharedUsers((prev) => [...prev, { ...entry, level: "read" }]);
    setUserQuery("");
    setUserInputFocused(false);
    userInputRef.current?.blur();
  };

  const setUserLevel = (userId: string, level: SkillPermissionLevel) => {
    setSharedUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, level } : u)));
  };

  const removeUser = (userId: string) => {
    setSharedUsers((prev) => prev.filter((u) => u.userId !== userId));
  };

  const orgsActive = !isPublic && sharedOrgIds.length > 0;
  const usersActive = !isPublic && sharedUsers.length > 0;
  const privateActive = !isPublic && !orgsActive && !usersActive;

  // The canonical typed grants this form would persist (#1123).
  const buildGrants = (): SkillGrant[] => [
    ...sharedUsers.map((u) => ({ type: "user" as const, id: u.userId, level: u.level })),
    ...sharedOrgIds.map((id) => ({
      type: "org" as const,
      id,
      level: orgLevels[id] ?? "read",
    })),
  ];

  const handleSave = async () => {
    const afterPrivate = !isPublic;
    const grants = buildGrants();

    // Level-aware "nothing changed" short-circuit (covers a level flip,
    // not just add/remove).
    const privateChanged = skill.isPrivate !== afterPrivate;
    const grantsChanged = grantSignature(grants) !== grantSignature(initialGrants);

    if (!privateChanged && !grantsChanged) {
      addToast({
        type: "info",
        message: t("permissions.noChanges", "No changes to save."),
      });
      onClose();
      return;
    }

    try {
      await permissionsMutation.mutateAsync({
        isPrivate: afterPrivate,
        grants,
      });
      addToast({
        type: "success",
        message: t("permissions.saveSuccess", "Permissions updated"),
      });
      onClose();
    } catch (err) {
      const message = translateError(err);
      addToast({ type: "error", message });
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
          <TierCard
            active={isPublic}
            accent="public"
            onToggle={() => setIsPublic((v) => !v)}
          >
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
                    "permissions.publicDesc",
                    "Anyone on Ornn can find and use this skill, including unauthenticated visitors.",
                  )}
                </p>
              </div>
            </label>
          </TierCard>

          <SectionHeader
            label={t("permissions.levelLimited", "Limited access") as string}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TierCard
              active={orgsActive}
              dimmed={isPublic}
              accent="limited"
              className="p-4"
            >
              <p className="font-display text-base text-strong">
                {t("permissions.orgsTitle", "Shared with organizations")}
              </p>
              <p className="mt-0.5 font-text text-sm text-meta">
                {t(
                  "permissions.orgsDesc",
                  "Every admin and member of a checked org can see and use this skill.",
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
                        checked={checked}
                        onChange={() => toggleOrg(org.userId)}
                        className="h-4 w-4 rounded border-accent/40 accent-accent"
                      />
                      <span className="font-text text-sm text-strong truncate">
                        {org.displayName}
                      </span>
                      <span className="ml-auto flex items-center gap-1.5 shrink-0">
                        {checked && (
                          <LevelToggle
                            level={orgLevels[org.userId] ?? "read"}
                            onChange={(lvl) => setOrgLevel(org.userId, lvl)}
                            t={t}
                          />
                        )}
                        {org.isUnresolved ? (
                          <span className="inline-flex items-center gap-1 rounded-sm border border-warning/40 px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-wider text-warning">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M12 9v2m0 4h.01" />
                              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                            </svg>
                            {t("permissions.orgUnresolved", "unresolved")}
                          </span>
                        ) : !org.isMember ? (
                          <span className="font-mono text-[10px] text-meta">
                            {t("permissions.notMember", "not member")}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </TierCard>

            <TierCard
              active={usersActive}
              dimmed={isPublic}
              accent="limited"
              className="p-4"
            >
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
                {sharedUsers.map((u) => {
                  // #720 — user couldn't be resolved via the directory.
                  // `resolveUsers` leaves the placeholder
                  // `{ userId, email: "", displayName: userId }` in place
                  // when a lookup misses, so `!u.email && u.displayName === u.userId`
                  // is the signal that the grant points at a user who no
                  // longer exists (or who the caller can't see).
                  const isUnresolved = !u.email && u.displayName === u.userId;
                  return (
                    <span
                      key={u.userId}
                      className={`inline-flex items-center gap-2 px-2 py-1 rounded-full border font-mono text-xs h-fit ${
                        isUnresolved
                          ? "border-warning/40 bg-warning-soft/40 text-warning"
                          : "border-accent/30 bg-accent/5 text-strong"
                      }`}
                      title={
                        isUnresolved
                          ? (t(
                              "permissions.userUnresolvedTip",
                              "This user could not be resolved. They may have left or been removed; click × to revoke the stale grant.",
                            ) as string)
                          : undefined
                      }
                    >
                      {isUnresolved && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 9v2m0 4h.01" />
                          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                      )}
                      <span>{u.email || u.displayName || u.userId}</span>
                      {!isUnresolved && (
                        <LevelToggle
                          level={u.level}
                          onChange={(lvl) => setUserLevel(u.userId, lvl)}
                          t={t}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => removeUser(u.userId)}
                        className="text-danger hover:text-danger/80 cursor-pointer"
                        aria-label={t("permissions.removeUser", "Remove") as string}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
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
                  className="w-full bg-card rounded border border-accent/20 bg-elevated px-3 py-2 font-text text-sm text-strong focus:outline-none focus:border-accent/60"
                  disabled={isPublic}
                />
                {userInputFocused &&
                  !isPublic &&
                  debouncedQuery.length < 2 &&
                  userQuery.trim().length < 2 && (
                    <div className="absolute left-0 right-0 bottom-full mb-1 z-10 rounded bg-card border border-accent/20 card-impression">
                      <p className="px-3 py-2 font-text text-xs text-meta italic">
                        {t(
                          "permissions.searchHint",
                          "Type at least 2 characters to search.",
                        )}
                      </p>
                    </div>
                  )}
                {userInputFocused && suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 bottom-full mb-1 z-10 rounded bg-card border border-accent/20 card-impression max-h-52 overflow-y-auto">
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
                        <span className="text-strong truncate">
                          {s.displayName || s.email}
                        </span>
                        <span className="ml-auto font-mono text-xs text-meta truncate">
                          {s.email}
                        </span>
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
                "permissions.privateDesc",
                "Only you and platform admins can see this skill. Active when nothing above is set.",
              )}
            </p>
          </TierCard>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 mt-5 border-t border-accent/10">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button
          onClick={handleSave}
          loading={permissionsMutation.isPending}
        >
          {t("common.save", "Save")}
        </Button>
      </div>
    </>
  );
}

/**
 * Compact read / read-write level switch for one grant (#1123). Clicking
 * flips the level. `stopPropagation` keeps a click off the surrounding
 * checkbox label / tier card. read-write is accent-highlighted; read is
 * muted (the default, lowest-privilege state).
 */
function LevelToggle({
  level,
  onChange,
  t,
}: {
  level: SkillPermissionLevel;
  onChange: (level: SkillPermissionLevel) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const isWrite = level === "read_write";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange(isWrite ? "read" : "read_write");
      }}
      title={
        t(
          "permissions.levelToggleTip",
          "Read = view/pull/execute. Read-write also lets them update this skill (no admin). Click to switch.",
        ) as string
      }
      className={`shrink-0 cursor-pointer rounded-sm border px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-wider transition-colors ${
        isWrite
          ? "border-accent/50 bg-accent/10 text-accent"
          : "border-subtle text-meta hover:text-strong"
      }`}
    >
      {isWrite
        ? t("permissions.levelReadWrite", "read-write")
        : t("permissions.levelRead", "read")}
    </button>
  );
}

/** Section divider with a small uppercase label centered on top. */
function SectionHeader({ label }: { label: string }) {
  return (
    <div className="mt-5 mb-3 first:mt-0 flex items-center gap-3" aria-hidden>
      <div className="flex-1 h-px bg-accent/15" />
      <span className="font-mono text-[10px] uppercase tracking-widest text-meta shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-accent/15" />
    </div>
  );
}

interface TierCardProps {
  active: boolean;
  /** Overrides `active` visually — greyed out when Public is on for sub-tiers. */
  dimmed?: boolean;
  /**
   * Tier of access this card represents — drives the highlight color
   * when active. Matches the visibility-card chip on `SkillDetailPage`:
   *   public  → green   (success)
   *   limited → yellow  (warning) — orgs / users
   *   private → grey    (info / mineral)
   */
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

function TierCard({
  active,
  dimmed = false,
  accent,
  onToggle,
  className = "",
  children,
}: TierCardProps) {
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
