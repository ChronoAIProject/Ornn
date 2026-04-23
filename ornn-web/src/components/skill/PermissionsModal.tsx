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
 * Org-level and user-level grants are **orthogonal** — the owner can
 * enable either, both, or neither. The owner flips to Public to open
 * the floodgates; with Public off, whatever grants are set are the
 * skill's ACL. An empty ACL (no orgs + no users) is the pure-Private
 * state — surfaced as the bottom card "active" so there's no invisible
 * default to puzzle over.
 *
 * Data model unchanged: isPrivate + sharedWithOrgs + sharedWithUsers.
 * Public clears both grant lists on save so the persisted state
 * reflects exactly one intent.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useMyOrgs } from "@/hooks/useMe";
import { useUpdateSkillPermissions } from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";
import { searchUsersByEmail, resolveUsers, fetchOrgSummary, type UserDirectoryEntry } from "@/services/usersApi";
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

  // Primary state: Public is the top-level override, grants are the
  // two orthogonal additive channels. All three persist in local state
  // across edits so a flipped-then-unflipped Public doesn't lose the
  // user's in-progress selections.
  const [isPublic, setIsPublic] = useState<boolean>(!skill.isPrivate);
  const [sharedUsers, setSharedUsers] = useState<UserDirectoryEntry[]>([]);
  const [sharedOrgIds, setSharedOrgIds] = useState<string[]>(skill.sharedWithOrgs);
  const [userQuery, setUserQuery] = useState("");
  const [userInputFocused, setUserInputFocused] = useState(false);
  const userInputRef = useRef<HTMLInputElement>(null);

  // Reset form whenever the modal re-opens on a different skill version.
  useEffect(() => {
    if (!isOpen) return;
    setIsPublic(!skill.isPrivate);
    setSharedOrgIds(skill.sharedWithOrgs);
    setUserQuery("");
    setSharedUsers(
      skill.sharedWithUsers.map((id) => ({
        userId: id,
        email: "",
        displayName: id,
      })),
    );
  }, [isOpen, skill]);

  // Resolve saved user_ids into email/displayName so the chip list
  // renders something human. Runs once per modal open. Uses a dedicated
  // batch-by-id endpoint because the email-prefix search can't match on
  // a UUID — that was the bug where chips showed raw GUIDs on reopen.
  useEffect(() => {
    const needResolve = sharedUsers.filter((u) => !u.email).map((u) => u.userId);
    if (needResolve.length === 0) return;
    let cancelled = false;
    (async () => {
      const resolved = await resolveUsers(needResolve).catch(() => []);
      if (cancelled || resolved.length === 0) return;
      const byId = new Map(resolved.map((r) => [r.userId, r]));
      setSharedUsers((prev) =>
        prev.map((existing) => byId.get(existing.userId) ?? existing),
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const debouncedQuery = useDebouncedValue(userQuery.trim(), 200);
  // Fire whenever the user is interacting with the picker — on focus
  // (empty query → show all), and as they type (prefix filter). The
  // backend returns the top-N-by-recency for an empty query so the
  // dropdown is useful the instant the field is focused.
  const shouldSearch = !isPublic && (userInputFocused || debouncedQuery.length > 0);
  const { data: suggestions = [] } = useQuery({
    queryKey: ["users-search", debouncedQuery],
    queryFn: () => searchUsersByEmail(debouncedQuery, 8),
    enabled: shouldSearch,
    staleTime: 10_000,
  });

  // Back-fill display names for orgs the caller no longer belongs to.
  // Same-org ids show up in both `myOrgs` (membership) and on the
  // skill's `sharedWithOrgs`; we only need to resolve the ones not in
  // the membership set.
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
    // Close the dropdown after a pick so the newly-added chip isn't
    // occluded by the suggestion list. The user can refocus to add more.
    setUserInputFocused(false);
    userInputRef.current?.blur();
  };

  const removeUser = (userId: string) => {
    setSharedUsers((prev) => prev.filter((u) => u.userId !== userId));
  };

  // Derived "active" flags drive each card's highlight. Orgs + Users
  // can be simultaneously active — they're orthogonal grant channels.
  // Private is active only when nothing else is.
  const orgsActive = !isPublic && sharedOrgIds.length > 0;
  const usersActive = !isPublic && sharedUsers.length > 0;
  const privateActive = !isPublic && !orgsActive && !usersActive;

  const handleSave = async () => {
    const payload = isPublic
      ? { isPrivate: false, sharedWithOrgs: [], sharedWithUsers: [] }
      : {
        isPrivate: true,
        sharedWithOrgs: sharedOrgIds,
        sharedWithUsers: sharedUsers.map((u) => u.userId),
      };
    try {
      await permissionsMutation.mutateAsync(payload);
      addToast({ type: "success", message: t("permissions.saveSuccess", "Permissions updated") });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: "error", message });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("permissions.title", "Permissions") as string}
      // Two parallel grant columns need breathing room on desktop;
      // default modal width (max-w-lg) wraps the org + user cards.
      className="!max-w-3xl"
    >
      <div className="flex gap-4">
        {/* Left gutter — broader-at-top arrow axis. Decorative only. */}
        <div className="flex flex-col items-center py-1 shrink-0" aria-hidden>
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4 text-neon-cyan"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="4 10 8 6 12 10" />
          </svg>
          <div className="flex-1 w-px my-1 bg-gradient-to-b from-neon-cyan/70 via-neon-cyan/25 to-neon-cyan/5" />
        </div>

        {/* Three access tiers separated by labelled dividers. The
            middle tier wraps two co-equal channels (orgs + users) so
            the visual grouping matches the semantic model. */}
        <div className="flex-1">
          <SectionHeader label={t("permissions.level.public", "Public access")} />
          <TierCard
            active={isPublic}
            interactive
            onToggle={() => setIsPublic((v) => !v)}
            control={
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="mt-1 h-4 w-4 accent-neon-green cursor-pointer"
              />
            }
            title={t("permissions.publicLabel", "Public")}
            subtitle={t("permissions.publicHint", "Anyone on Ornn can find and use this skill, including unauthenticated visitors.")}
          />

          <SectionHeader label={t("permissions.level.limited", "Limited access")} />
          {/* Org and User grants sit at the same semantic level —
              they're two orthogonal additive channels, not a priority
              ladder. Put them side-by-side so the parity is obvious
              and neither feels like the primary option. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <TierCard
              active={orgsActive}
              // Greyed + inert when Public overrides, since any grant
              // here is ignored at that point.
              dimmed={isPublic}
              title={t("permissions.sharedOrgsLabel", "Shared with organizations")}
              subtitle={t("permissions.sharedOrgsHint", "Every admin and member of a checked org can see and use this skill.")}
            >
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
            </TierCard>

            <TierCard
              active={usersActive}
              dimmed={isPublic}
              title={t("permissions.sharedUsersLabel", "Shared with specific users")}
              subtitle={t("permissions.sharedUsersHint", "Search by email. Only users who have signed into Ornn appear here.")}
            >
            {/* Reserved-height chip area: always rendered at a fixed
                size so adding or removing chips never moves the search
                input below it. Overflow scrolls internally. */}
            <div className="flex flex-wrap gap-2 mb-3 h-40 overflow-y-auto content-start">
              {sharedUsers.map((u) => (
                <span
                  key={u.userId}
                  className="inline-flex items-center gap-2 px-2 py-1 rounded-full border border-neon-cyan/30 bg-neon-cyan/5 font-mono text-xs text-text-primary h-fit"
                >
                  <span>{u.email || u.displayName || u.userId}</span>
                  <button
                    type="button"
                    onClick={() => removeUser(u.userId)}
                    className="text-neon-red hover:text-neon-red/80 cursor-pointer"
                    aria-label={t("permissions.removeUser", "Remove") as string}
                  >
                    ×
                  </button>
                </span>
              ))}
              {sharedUsers.length === 0 && (
                <p className="font-body text-xs text-text-muted italic w-full">
                  {t("permissions.noUsersYet", "No users added yet.")}
                </p>
              )}
            </div>
            {/* Search input sits at the bottom of the card so the
                dropdown has room to open upward-free and the running
                list of added users reads top-down from the card
                header — additions don't shift the input position. */}
            <div className="relative">
              <input
                ref={userInputRef}
                type="text"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                onFocus={() => setUserInputFocused(true)}
                // Delay blur so a click on a suggestion still registers
                // before the dropdown unmounts.
                onBlur={() => setTimeout(() => setUserInputFocused(false), 150)}
                placeholder={t("permissions.searchPlaceholder", "type an email to find a user...") as string}
                className="w-full glass rounded-lg border border-neon-cyan/20 bg-bg-elevated px-3 py-2 font-body text-sm text-text-primary focus:outline-none focus:border-neon-cyan/60"
              />
              {userInputFocused && suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-10 max-h-48 overflow-y-auto glass rounded-lg border border-neon-cyan/30 shadow-lg shadow-neon-cyan/10">
                  {suggestions.map((s) => {
                    const alreadyAdded = sharedUsers.some((u) => u.userId === s.userId);
                    return (
                      <button
                        key={s.userId}
                        type="button"
                        disabled={alreadyAdded}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addUser(s)}
                        className={`w-full text-left px-3 py-2 font-body text-sm transition-colors ${alreadyAdded ? "text-text-muted cursor-not-allowed" : "text-text-primary cursor-pointer hover:bg-neon-cyan/10"}`}
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
              {userInputFocused && debouncedQuery.length > 0 && suggestions.length === 0 && (
                <p className="font-body text-xs text-text-muted mt-2">
                  {t("permissions.noUserMatches", "No user matches that email. They may need to sign in to Ornn once before you can share with them.")}
                </p>
              )}
            </div>
            </TierCard>
          </div>

          <SectionHeader label={t("permissions.level.private", "Private access")} />
          <TierCard
            active={privateActive}
            dimmed={isPublic}
            title={t("permissions.privateLabel", "Private")}
            subtitle={t("permissions.privateHint", "Only you and platform admins can see this skill. Active when nothing above is set.")}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 mt-5 border-t border-neon-cyan/10">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button onClick={handleSave} loading={permissionsMutation.isPending}>
          {t("common.save", "Save")}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Horizontal divider with a small uppercase level label centered on
 * top — the visual anchor between the three access tiers. Consistent
 * spacing above + below so successive sections share a rhythm.
 */
function SectionHeader({ label }: { label: string }) {
  return (
    <div className="mt-5 mb-3 first:mt-0 flex items-center gap-3" aria-hidden>
      <div className="flex-1 h-px bg-neon-cyan/15" />
      <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-neon-cyan/15" />
    </div>
  );
}

interface TierCardProps {
  /** Visually emphasised when true — the tier is contributing to the current ACL. */
  active: boolean;
  /**
   * Overrides `active` by greying out the card regardless of state.
   * Used by the Public override — once Public is on, sub-tiers are
   * ignored so they render as inert-looking.
   */
  dimmed?: boolean;
  /**
   * Makes the whole card a clickable toggle — used for the Public row
   * so clicking anywhere flips the checkbox. Middle sub-tiers are NOT
   * interactive at the card level; their inner controls handle their
   * own state independently.
   */
  interactive?: boolean;
  onToggle?: () => void;
  /** Optional inline control rendered next to the title (checkbox for Public). */
  control?: ReactNode;
  title: string;
  subtitle: string;
  children?: ReactNode;
}

function TierCard({
  active,
  dimmed = false,
  interactive = false,
  onToggle,
  control,
  title,
  subtitle,
  children,
}: TierCardProps) {
  const highlightTone = dimmed
    ? "border-neon-cyan/10 opacity-40"
    : active
      ? "border-neon-cyan/50 bg-neon-cyan/5 shadow-md shadow-neon-cyan/10"
      : "border-neon-cyan/15";
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive && !dimmed ? 0 : -1}
      aria-pressed={interactive ? active : undefined}
      onClick={interactive && !dimmed ? onToggle : undefined}
      onKeyDown={(e) => {
        if (interactive && !dimmed && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onToggle?.();
        }
      }}
      className={`
        border rounded-lg p-4 transition-all
        ${interactive && !dimmed ? "cursor-pointer" : "cursor-default"}
        ${highlightTone}
      `}
    >
      <div className="flex items-start gap-3">
        {control}
        <div className="flex-1">
          <p className="font-body text-sm font-semibold text-text-primary">{title}</p>
          <p className="font-body text-xs text-text-muted mt-0.5">{subtitle}</p>
          {children && (
            <div className={`mt-3 ${dimmed ? "pointer-events-none" : ""}`}>{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}
