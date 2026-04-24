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
 * Save flow is audit-gated. The modal posts the desired state to
 * `PUT /api/v1/skills/:id/permissions` in one call; the backend:
 *   - applies any removals immediately (revoking access never needs audit)
 *   - runs a cached audit (30-day TTL) once for this skill version
 *   - for each NEW grant, returns a `ShareRequest` — either `green`
 *     (auto-applied because `overallScore >= platform threshold`) or
 *     `needs-justification` (a waiver request the owner must justify,
 *     reviewed by the target user / org admin / ornn admin).
 *
 * The modal shows three phases during the save:
 *   1. `form` — the picker (default)
 *   2. `running` — spinner + "Running audit…" label while the backend call is in flight
 *   3. `results` — per-target outcomes when at least one target needs follow-up;
 *                  all-green saves skip this and just toast + close
 *
 * @module components/skill/PermissionsModal
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
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
import type { SkillDetail } from "@/types/domain";
import type { ShareRequest } from "@/types/shares";

type SavePhase = "form" | "running" | "results";

interface SaveResultEntry {
  label: string;
  kind: "share-green" | "share-needs-justification" | "share-failed-audit";
  shareRequestId: string;
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
  const addToast = useToastStore((s) => s.addToast);
  const { data: myOrgs = [] } = useMyOrgs();
  const permissionsMutation = useUpdateSkillPermissions(skill.guid);

  const [isPublic, setIsPublic] = useState<boolean>(!skill.isPrivate);
  const [sharedUsers, setSharedUsers] = useState<UserDirectoryEntry[]>([]);
  const [sharedOrgIds, setSharedOrgIds] = useState<string[]>(skill.sharedWithOrgs);
  const [userQuery, setUserQuery] = useState("");
  const [userInputFocused, setUserInputFocused] = useState(false);
  const [phase, setPhase] = useState<SavePhase>("form");
  const [saveResults, setSaveResults] = useState<SaveResultEntry[]>([]);
  const [hadRemoves, setHadRemoves] = useState(false);
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
    setPhase("form");
    setSaveResults([]);
    setHadRemoves(false);
  }, [isOpen, skill]);

  // Resolve saved user_ids into email/displayName so the chip list
  // renders something human. Runs once per modal open.
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
      return resolved
        .map(
          (entry, i) =>
            entry ?? { userId: unknownOrgIds[i], displayName: unknownOrgIds[i], avatarUrl: null },
        )
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

  const labelForWaiverTarget = (w: ShareRequest): string => {
    if (w.target.type === "public") return t("permissions.targetPublic", "Public");
    if (w.target.type === "org") {
      const hit = allOrgOptions.find((o) => o.userId === w.target.id);
      return hit?.displayName ?? `Org ${w.target.id ?? ""}`.trim();
    }
    const hit = sharedUsers.find((u) => u.userId === w.target.id);
    return hit?.displayName || hit?.email || `User ${w.target.id ?? ""}`.trim();
  };

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
    // Quick client-side "nothing changed" short-circuit.
    const beforePrivate = skill.isPrivate;
    const beforeUsers = new Set(skill.sharedWithUsers);
    const beforeOrgs = new Set(skill.sharedWithOrgs);
    const afterPrivate = !isPublic;
    const afterUsers = new Set(sharedUsers.map((u) => u.userId));
    const afterOrgs = new Set(sharedOrgIds);

    const privateChanged = beforePrivate !== afterPrivate;
    const usersChanged =
      sharedUsers.length !== beforeUsers.size ||
      sharedUsers.some((u) => !beforeUsers.has(u.userId));
    const orgsChanged =
      sharedOrgIds.length !== beforeOrgs.size ||
      sharedOrgIds.some((id) => !beforeOrgs.has(id));

    if (!privateChanged && !usersChanged && !orgsChanged) {
      addToast({
        type: "info",
        message: t("permissions.noChanges", "No changes to save."),
      });
      onClose();
      return;
    }

    const someRemoved =
      skill.sharedWithUsers.some((id) => !afterUsers.has(id)) ||
      skill.sharedWithOrgs.some((id) => !afterOrgs.has(id)) ||
      (!beforePrivate && afterPrivate);

    setPhase("running");
    setSaveResults([]);
    setHadRemoves(someRemoved);

    try {
      const result = await permissionsMutation.mutateAsync({
        isPrivate: !isPublic,
        sharedWithUsers: sharedUsers.map((u) => u.userId),
        sharedWithOrgs: sharedOrgIds,
      });

      const waivers = result.waivers ?? [];
      const needsFollowup = waivers.some((w) => w.status !== "green");

      if (!needsFollowup) {
        // Clean path — toast what happened and close.
        const ok = waivers.filter((w) => w.status === "green").length;
        const parts: string[] = [];
        if (someRemoved) parts.push(t("permissions.partRemoves", "permissions updated"));
        if (ok > 0) {
          parts.push(
            t("permissions.partSharesAccepted", "{{n}} share(s) auto-approved (audit above threshold)", { n: ok }),
          );
        }
        addToast({
          type: "success",
          message: parts.length > 0 ? parts.join(" · ") : t("permissions.saveSuccess", "Permissions updated"),
        });
        onClose();
        return;
      }

      // At least one target needs justification — render the results view.
      setSaveResults(
        waivers.map((w) => ({
          label: labelForWaiverTarget(w),
          shareRequestId: w._id,
          kind:
            w.status === "green"
              ? "share-green"
              : w.status === "needs-justification"
                ? "share-needs-justification"
                : "share-failed-audit",
        })),
      );
      setPhase("results");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: "error", message });
      setPhase("form");
    }
  };

  // ---------- running view -------------------------------------------------

  if (phase === "running") {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t("permissions.runningTitle", "Running audit…") as string}
        className="!max-w-xl"
      >
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div
            className="h-10 w-10 animate-spin rounded-full border-2 border-neon-cyan/20 border-t-neon-cyan"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="font-heading text-sm uppercase tracking-wider text-text-primary">
              {t("permissions.runningHeading", "Auditing new share targets")}
            </p>
            <p className="font-body text-sm text-text-muted">
              {t(
                "permissions.runningSub",
                "Applying removals and scoring the skill against the audit engine.",
              )}
            </p>
          </div>
          <p className="max-w-md font-body text-xs text-text-muted">
            {t(
              "permissions.runningHint",
              "The audit engine reviews the skill across security, code quality, documentation, reliability, and permission scope. Cached for 30 days per skill version.",
            )}
          </p>
        </div>
      </Modal>
    );
  }

  // ---------- results view -------------------------------------------------

  if (phase === "results") {
    const flaggedCount = saveResults.filter(
      (r) => r.kind === "share-needs-justification" || r.kind === "share-failed-audit",
    ).length;
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t("permissions.resultsTitle", "Audit results") as string}
        className="!max-w-xl"
      >
        <div className="space-y-4">
          <p className="font-body text-sm text-text-muted">
            {t(
              "permissions.resultsHeading",
              "{{n}} target(s) scored below the audit threshold and need a waiver before access is granted.",
              { n: flaggedCount },
            )}
          </p>
          {hadRemoves && (
            <div className="rounded-lg border border-neon-cyan/20 bg-neon-cyan/5 px-3 py-2 font-body text-sm text-text-muted">
              {t("permissions.partRemovesApplied", "Existing grants you removed were applied immediately.")}
            </div>
          )}
          <ul className="space-y-2">
            {saveResults.map((r) => {
              const iconBase =
                "h-6 w-6 shrink-0 rounded-full border flex items-center justify-center font-mono text-xs";
              const rowBase = "flex items-start gap-3 rounded-lg border px-3 py-2";
              if (r.kind === "share-green") {
                return (
                  <li key={r.shareRequestId} className={`${rowBase} border-neon-cyan/30 bg-neon-cyan/5`}>
                    <span aria-hidden className={`${iconBase} border-neon-cyan/40 text-neon-cyan`}>
                      ✓
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-sm text-text-primary">{r.label}</p>
                      <p className="font-body text-xs text-text-muted">
                        {t("permissions.resultGreen", "Audit passed — access granted.")}
                      </p>
                    </div>
                  </li>
                );
              }
              if (r.kind === "share-needs-justification") {
                return (
                  <li
                    key={r.shareRequestId}
                    className={`${rowBase} border-neon-yellow/30 bg-neon-yellow/5`}
                  >
                    <span aria-hidden className={`${iconBase} border-neon-yellow/40 text-neon-yellow`}>
                      ⚠
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-sm text-text-primary">{r.label}</p>
                      <p className="font-body text-xs text-text-muted">
                        {t(
                          "permissions.resultNeedsJustification",
                          "Audit flagged findings. Submit a justification for a reviewer to consider.",
                        )}
                      </p>
                    </div>
                    <Link
                      to={`/shares/${encodeURIComponent(r.shareRequestId)}`}
                      onClick={onClose}
                      className="shrink-0 rounded-md border border-neon-yellow/30 px-3 py-1 font-body text-xs text-neon-yellow transition-colors hover:bg-neon-yellow/10"
                    >
                      {t("permissions.addJustification", "Add justification →")}
                    </Link>
                  </li>
                );
              }
              return (
                <li key={r.shareRequestId} className={`${rowBase} border-neon-red/30 bg-neon-red/5`}>
                  <span aria-hidden className={`${iconBase} border-neon-red/40 text-neon-red`}>
                    ✗
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-sm text-text-primary">{r.label}</p>
                    <p className="font-body text-xs text-text-muted">
                      {t(
                        "permissions.resultFailedAudit",
                        "Audit failed outright — contact a platform admin.",
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end pt-2">
            <Button onClick={onClose}>{t("common.close", "Close")}</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ---------- form view ----------------------------------------------------

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("permissions.title", "Permissions") as string}
      className="!max-w-3xl"
    >
      <div className="flex gap-4">
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

        <div className="flex-1">
          <SectionHeader label={t("permissions.levelPublic", "Public access") as string} />
          <TierCard
            active={isPublic}
            accent="cyan"
            onToggle={() => setIsPublic((v) => !v)}
          >
            <label className="flex items-start gap-3 cursor-pointer w-full">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 rounded border-neon-cyan/40 accent-neon-cyan"
              />
              <div className="flex-1">
                <p className="font-heading text-base text-text-primary">
                  {t("permissions.publicTitle", "Public")}
                </p>
                <p className="mt-0.5 font-body text-sm text-text-muted">
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
              accent="cyan"
              className="p-4"
            >
              <p className="font-heading text-base text-text-primary">
                {t("permissions.orgsTitle", "Shared with organizations")}
              </p>
              <p className="mt-0.5 font-body text-sm text-text-muted">
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
                  <p className="font-body text-xs text-text-muted italic">
                    {t("permissions.noOrgs", "No organizations to choose from.")}
                  </p>
                )}
                {allOrgOptions.map((org) => {
                  const checked = sharedOrgIds.includes(org.userId);
                  return (
                    <label
                      key={org.userId}
                      className="flex items-center gap-2 cursor-pointer py-1 px-2 rounded hover:bg-neon-cyan/5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOrg(org.userId)}
                        className="h-4 w-4 rounded border-neon-cyan/40 accent-neon-cyan"
                      />
                      <span className="font-body text-sm text-text-primary truncate">
                        {org.displayName}
                      </span>
                      {!org.isMember && (
                        <span className="font-mono text-[10px] text-text-muted ml-auto">
                          {t("permissions.notMember", "not member")}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </TierCard>

            <TierCard
              active={usersActive}
              dimmed={isPublic}
              accent="cyan"
              className="p-4"
            >
              <p className="font-heading text-base text-text-primary">
                {t("permissions.usersTitle", "Shared with specific users")}
              </p>
              <p className="mt-0.5 font-body text-sm text-text-muted">
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
                  className="w-full glass rounded-lg border border-neon-cyan/20 bg-bg-elevated px-3 py-2 font-body text-sm text-text-primary focus:outline-none focus:border-neon-cyan/60"
                  disabled={isPublic}
                />
                {userInputFocused && suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 bottom-full mb-1 z-10 rounded-lg glass border border-neon-cyan/20 shadow-lg max-h-52 overflow-y-auto">
                    {suggestions.map((s) => (
                      <button
                        key={s.userId}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addUser(s);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left font-body text-sm hover:bg-neon-cyan/10 cursor-pointer"
                      >
                        <span className="text-text-primary truncate">
                          {s.displayName || s.email}
                        </span>
                        <span className="ml-auto font-mono text-xs text-text-muted truncate">
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
          <TierCard active={privateActive} dimmed={isPublic} accent="cyan">
            <p className="font-heading text-base text-text-primary">
              {t("permissions.privateTitle", "Private")}
            </p>
            <p className="mt-0.5 font-body text-sm text-text-muted">
              {t(
                "permissions.privateDesc",
                "Only you and platform admins can see this skill. Active when nothing above is set.",
              )}
            </p>
          </TierCard>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 mt-5 border-t border-neon-cyan/10">
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
    </Modal>
  );
}

/** Section divider with a small uppercase label centered on top. */
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
  active: boolean;
  /** Overrides `active` visually — greyed out when Public is on for sub-tiers. */
  dimmed?: boolean;
  accent: "cyan" | "yellow";
  onToggle?: () => void;
  className?: string;
  children: ReactNode;
}

function TierCard({
  active,
  dimmed = false,
  accent,
  onToggle,
  className = "",
  children,
}: TierCardProps) {
  const ringClass = active
    ? accent === "cyan"
      ? "border-neon-cyan/50 bg-neon-cyan/5"
      : "border-neon-yellow/50 bg-neon-yellow/5"
    : "border-neon-cyan/15 bg-bg-elevated/40";
  const dimmedClass = dimmed ? "opacity-60" : "";
  return (
    <div
      onClick={onToggle}
      className={`rounded-lg border p-4 transition-colors ${ringClass} ${dimmedClass} ${className} ${
        onToggle ? "cursor-pointer" : ""
      }`}
    >
      {children}
    </div>
  );
}
