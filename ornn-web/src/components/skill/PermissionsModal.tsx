/**
 * PermissionsModal — per-skill visibility editor (single-active tier).
 *
 * Four mutually-exclusive tiers, broader at the top:
 *   Public    — anyone on Ornn, incl. unauthenticated visitors
 *   Orgs      — admin/member of each chosen organization
 *   Users     — explicit per-user grants (email typeahead)
 *   Private   — only the author + platform admin
 *
 * UI enforces one active tier at a time. The active tier is derived from
 * saved state on open using a broadest-wins rule; clicking another tier
 * switches active. Non-active tiers are visually greyed and inert. On
 * Save, only the active tier's data is persisted — other tiers are zeroed
 * so the backend sees exactly the tier the owner chose.
 *
 * Data model is unchanged: isPrivate + sharedWithOrgs + sharedWithUsers.
 * Backend authorization still treats the fields as independently
 * combinable; the UI just narrows the configurable shape to one tier.
 *
 * Authorization is enforced server-side — the modal only gates which
 * controls to render. An author or platform admin can open it; anyone
 * else never sees the trigger.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronUp } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useMyOrgs } from "@/hooks/useMe";
import { useUpdateSkillPermissions } from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";
import { searchUsersByEmail, fetchOrgSummary, type UserDirectoryEntry } from "@/services/usersApi";
import type { SkillDetail } from "@/types/domain";

type Tier = "public" | "orgs" | "users" | "private";

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

/** Broadest-wins derivation of the active tier from saved skill state. */
function deriveActiveTier(skill: SkillDetail): Tier {
  if (!skill.isPrivate) return "public";
  if (skill.sharedWithOrgs.length > 0) return "orgs";
  if (skill.sharedWithUsers.length > 0) return "users";
  return "private";
}

export function PermissionsModal({ isOpen, onClose, skill }: PermissionsModalProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: myOrgs = [] } = useMyOrgs();
  const permissionsMutation = useUpdateSkillPermissions(skill.guid);

  const [activeTier, setActiveTier] = useState<Tier>(() => deriveActiveTier(skill));
  const [sharedUsers, setSharedUsers] = useState<UserDirectoryEntry[]>([]);
  const [sharedOrgIds, setSharedOrgIds] = useState<string[]>(skill.sharedWithOrgs);
  const [userQuery, setUserQuery] = useState("");

  // Reset form whenever the modal re-opens on a different skill version.
  useEffect(() => {
    if (!isOpen) return;
    setActiveTier(deriveActiveTier(skill));
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

  // Resolve any saved user_ids that don't have an email/displayName yet.
  useEffect(() => {
    const needResolve = sharedUsers.filter((u) => !u.email);
    if (needResolve.length === 0) return;
    let cancelled = false;
    (async () => {
      const resolved = await Promise.all(
        needResolve.map(async (u) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const debouncedQuery = useDebouncedValue(userQuery.trim(), 200);
  const { data: suggestions = [] } = useQuery({
    queryKey: ["users-search", debouncedQuery],
    queryFn: () => searchUsersByEmail(debouncedQuery, 8),
    enabled: debouncedQuery.length >= 2 && activeTier === "users",
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
  };

  const removeUser = (userId: string) => {
    setSharedUsers((prev) => prev.filter((u) => u.userId !== userId));
  };

  const handleSave = async () => {
    // Only the active tier's data survives to the backend. Other tiers
    // are zeroed so the saved ACL reflects exactly one intent.
    const payload = {
      isPrivate: activeTier !== "public",
      sharedWithOrgs: activeTier === "orgs" ? sharedOrgIds : [],
      sharedWithUsers: activeTier === "users" ? sharedUsers.map((u) => u.userId) : [],
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
    <Modal isOpen={isOpen} onClose={onClose} title={t("permissions.title", "Permissions") as string}>
      <div className="flex gap-4">
        {/* Left gutter — broader-at-top arrow axis. Decorative only. */}
        <div className="flex flex-col items-center py-1 shrink-0" aria-hidden>
          <ChevronUp className="h-4 w-4 text-neon-cyan" strokeWidth={2.5} />
          <div className="flex-1 w-px my-1 bg-gradient-to-b from-neon-cyan/70 via-neon-cyan/25 to-neon-cyan/5" />
        </div>

        {/* Tiers stacked top (broadest) to bottom (narrowest) */}
        <div className="flex-1 space-y-3">
          <TierCard
            active={activeTier === "public"}
            onActivate={() => setActiveTier("public")}
            title={t("permissions.publicLabel", "Public")}
            subtitle={t("permissions.publicHint", "Anyone on Ornn can find and use this skill, including unauthenticated visitors.")}
          />

          <TierCard
            active={activeTier === "orgs"}
            onActivate={() => setActiveTier("orgs")}
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
            active={activeTier === "users"}
            onActivate={() => setActiveTier("users")}
            title={t("permissions.sharedUsersLabel", "Shared with specific users")}
            subtitle={t("permissions.sharedUsersHint", "Search by email. Only users who have signed into Ornn appear here.")}
          >
            {sharedUsers.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {sharedUsers.map((u) => (
                  <span
                    key={u.userId}
                    className="inline-flex items-center gap-2 px-2 py-1 rounded-full border border-neon-cyan/30 bg-neon-cyan/5 font-mono text-xs text-text-primary"
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
              </div>
            )}
            <div className="relative">
              <input
                type="text"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder={t("permissions.searchPlaceholder", "type an email to find a user...") as string}
                className="w-full glass rounded-lg border border-neon-cyan/20 bg-bg-elevated px-3 py-2 font-body text-sm text-text-primary focus:outline-none focus:border-neon-cyan/60"
              />
              {debouncedQuery.length >= 2 && suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-10 max-h-48 overflow-y-auto glass rounded-lg border border-neon-cyan/30 shadow-lg shadow-neon-cyan/10">
                  {suggestions.map((s) => {
                    const alreadyAdded = sharedUsers.some((u) => u.userId === s.userId);
                    return (
                      <button
                        key={s.userId}
                        type="button"
                        disabled={alreadyAdded}
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
              {debouncedQuery.length >= 2 && suggestions.length === 0 && (
                <p className="font-body text-xs text-text-muted mt-2">
                  {t("permissions.noUserMatches", "No user matches that email.")}
                </p>
              )}
            </div>
          </TierCard>

          <TierCard
            active={activeTier === "private"}
            onActivate={() => setActiveTier("private")}
            title={t("permissions.privateLabel", "Private")}
            subtitle={t("permissions.privateHint", "Only you and platform admins can see this skill.")}
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

interface TierCardProps {
  active: boolean;
  onActivate: () => void;
  title: string;
  subtitle: string;
  children?: ReactNode;
}

/**
 * Visual container for a single permission tier. Clicking a non-active
 * card activates it. The active card is full opacity with the accent
 * border; inactive cards grey out and their inner controls become inert.
 */
function TierCard({ active, onActivate, title, subtitle, children }: TierCardProps) {
  return (
    <div
      role="button"
      tabIndex={active ? -1 : 0}
      aria-pressed={active}
      onClick={active ? undefined : onActivate}
      onKeyDown={(e) => {
        if (!active && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onActivate();
        }
      }}
      className={`
        border rounded-lg p-4 transition-all
        ${active
          ? "border-neon-cyan/50 bg-neon-cyan/5 shadow-md shadow-neon-cyan/10 cursor-default"
          : "border-neon-cyan/10 opacity-40 hover:opacity-70 cursor-pointer"}
      `}
    >
      <p className="font-body text-sm font-semibold text-text-primary">{title}</p>
      <p className="font-body text-xs text-text-muted mt-0.5">{subtitle}</p>
      {children && (
        <div className={`mt-3 ${active ? "" : "pointer-events-none"}`}>{children}</div>
      )}
    </div>
  );
}
