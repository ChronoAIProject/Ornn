/**
 * PermissionsEditor — two-tab Read / Write access editor (#1125).
 *
 * Separates the two audiences that the typed `grants` ACL supports
 * independently:
 *   - Read tab  — a Public toggle (everyone reads) OR a restricted set of
 *     orgs/users who can read.
 *   - Write tab — orgs/users who can edit (read + write). No public option;
 *     editors implicitly get read.
 *
 * Composing both tabs lets an owner express any combination the backend
 * already supports — notably "public read + org/user write", which the old
 * single-ladder modal couldn't reach (turning on Public disabled the grant
 * pickers). Shared by the skill + skillset permission modals via the thin
 * wrappers in `components/skill` / `components/skillset`.
 *
 * @module components/permissions/PermissionsEditor
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { useMyOrgs } from "@/hooks/useMe";
import { useToastStore } from "@/stores/toastStore";
import { resolveUsers, fetchOrgSummary } from "@/services/usersApi";
import type { SkillGrant } from "@/types/domain";
import { translateError } from "@/utils/translateError";
import { PrincipalSelector, type OrgOption, type Principal } from "./PrincipalSelector";

interface PermissionsEditorProps {
  initialIsPrivate: boolean;
  initialGrants: SkillGrant[];
  /** Labels (e.g. "skill" / "skillset") for the copy. */
  entityKind: "skill" | "skillset";
  saving: boolean;
  /** Persist. Should reject on error so the editor can surface a toast. */
  onSave: (isPrivate: boolean, grants: SkillGrant[]) => Promise<void>;
  onCancel: () => void;
}

const key = (p: { type: string; id: string }) => `${p.type}:${p.id}`;

/**
 * Compose the canonical grants from the two audiences. When public, read
 * grants are redundant (everyone reads) so only write grants are emitted.
 * A principal in both audiences resolves to write (write wins).
 */
function buildGrants(read: Principal[], write: Principal[], isPublic: boolean): SkillGrant[] {
  const map = new Map<string, SkillGrant>();
  if (!isPublic) {
    for (const p of read) map.set(key(p), { type: p.type, id: p.id, level: "read" });
  }
  for (const p of write) map.set(key(p), { type: p.type, id: p.id, level: "write" });
  return [...map.values()];
}

const signature = (grants: SkillGrant[]): string =>
  grants.map((g) => `${g.type}:${g.id}:${g.level}`).sort().join("|");

function toPrincipals(grants: SkillGrant[], level: SkillGrant["level"]): Principal[] {
  return grants.filter((g) => g.level === level).map((g) => ({ type: g.type, id: g.id, label: g.id }));
}

export function PermissionsEditor({
  initialIsPrivate,
  initialGrants,
  entityKind,
  saving,
  onSave,
  onCancel,
}: PermissionsEditorProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: myOrgs = [] } = useMyOrgs();

  const [tab, setTab] = useState<"read" | "write">("read");
  const [isPublic, setIsPublic] = useState<boolean>(!initialIsPrivate);
  const [readGrantees, setReadGrantees] = useState<Principal[]>(() => toPrincipals(initialGrants, "read"));
  const [writeGrantees, setWriteGrantees] = useState<Principal[]>(() =>
    toPrincipals(initialGrants, "write"),
  );

  // Resolve user-grant labels once on mount (the typeahead supplies labels
  // for freshly-added users; persisted grants arrive as bare ids).
  useEffect(() => {
    const userIds = initialGrants.filter((g) => g.type === "user").map((g) => g.id);
    if (userIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const resolved = await resolveUsers(userIds).catch(() => []);
      if (cancelled || resolved.length === 0) return;
      const byId = new Map(resolved.map((r) => [r.userId, r]));
      const relabel = (ps: Principal[]) =>
        ps.map((p) =>
          p.type === "user" && byId.has(p.id)
            ? { ...p, label: byId.get(p.id)!.email || byId.get(p.id)!.displayName || p.id }
            : p,
        );
      setReadGrantees(relabel);
      setWriteGrantees(relabel);
    })();
    return () => {
      cancelled = true;
    };
    // initialGrants is stable per mount (the modal keys the editor on the ACL
    // signature, so a reopen / ACL change remounts with fresh initial state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Org options = caller's memberships + any granted org not in them (backfilled).
  const grantedOrgIds = useMemo(
    () => [...new Set([...readGrantees, ...writeGrantees].filter((p) => p.type === "org").map((p) => p.id))],
    [readGrantees, writeGrantees],
  );
  const unknownOrgIds = useMemo(
    () => grantedOrgIds.filter((id) => !myOrgs.some((o) => o.userId === id)),
    [grantedOrgIds, myOrgs],
  );
  const { data: fetchedUnknownOrgs = [] } = useQuery({
    queryKey: ["orgs-backfill", unknownOrgIds.slice().sort().join(",")],
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

  const orgOptions: OrgOption[] = useMemo(() => {
    const map = new Map<string, OrgOption>();
    for (const o of myOrgs) {
      map.set(o.userId, { id: o.userId, label: o.displayName, isMember: true, isUnresolved: false });
    }
    for (const o of fetchedUnknownOrgs) {
      if (!map.has(o.userId)) {
        map.set(o.userId, { id: o.userId, label: o.displayName, isMember: false, isUnresolved: o.isUnresolved });
      }
    }
    return [...map.values()];
  }, [myOrgs, fetchedUnknownOrgs]);

  const handleSave = async () => {
    const isPrivate = !isPublic;
    const grants = buildGrants(readGrantees, writeGrantees, isPublic);
    const initialBuilt = buildGrants(
      toPrincipals(initialGrants, "read"),
      toPrincipals(initialGrants, "write"),
      !initialIsPrivate,
    );
    if (isPrivate === initialIsPrivate && signature(grants) === signature(initialBuilt)) {
      addToast({ type: "info", message: t("permissions.noChanges", "No changes to save.") });
      onCancel();
      return;
    }
    try {
      await onSave(isPrivate, grants);
      addToast({ type: "success", message: t("permissions.saveSuccess", "Permissions updated") });
      onCancel();
    } catch (err) {
      addToast({ type: "error", message: translateError(err) });
    }
  };

  const writeCount = writeGrantees.length;

  return (
    <>
      {/* Tab bar */}
      <div className="mb-4 flex gap-1 rounded-md border border-subtle bg-elevated/40 p-1">
        <TabButton active={tab === "read"} onClick={() => setTab("read")}>
          {t("permissions.tabRead", "Read access")}
        </TabButton>
        <TabButton active={tab === "write"} onClick={() => setTab("write")}>
          {t("permissions.tabWrite", "Write access")}
          {writeCount > 0 && (
            <span className="ml-1.5 rounded-full bg-accent/15 px-1.5 font-mono text-[10px] text-accent">
              {writeCount}
            </span>
          )}
        </TabButton>
      </div>

      {tab === "read" ? (
        <div>
          <label className="flex cursor-pointer items-start gap-3 rounded border border-subtle bg-elevated/40 p-4">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 rounded border-accent/40 accent-accent"
            />
            <div className="flex-1">
              <p className="font-display text-base text-strong">{t("permissions.publicTitle", "Public")}</p>
              <p className="mt-0.5 font-text text-sm text-meta">
                {entityKind === "skill"
                  ? t("permissions.publicDesc", "Anyone on Ornn can find and read this skill, including unauthenticated visitors.")
                  : t("skillsetPermissions.publicDesc", "Anyone on Ornn can find and read this skillset, including unauthenticated visitors.")}
              </p>
            </div>
          </label>

          <div className="mt-4">
            <p className="mb-2 font-text text-sm text-meta">
              {isPublic
                ? t("permissions.readPublicNote", "This is public — everyone can read it. Use the Write tab to grant edit access to specific orgs or users.")
                : t("permissions.readRestrictedNote", "Private: only you, platform admins, and the orgs/users below can read it. (Editors from the Write tab can read too.)")}
            </p>
            <PrincipalSelector
              value={readGrantees}
              onChange={setReadGrantees}
              orgOptions={orgOptions}
              disabled={isPublic}
              idPrefix="read"
            />
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-2 font-text text-sm text-meta">
            {t("permissions.writeNote", "These orgs and users can update the content & metadata. They can read it too. They cannot manage permissions, transfer, or delete — those stay with the owner.")}
          </p>
          <PrincipalSelector
            value={writeGrantees}
            onChange={setWriteGrantees}
            orgOptions={orgOptions}
            idPrefix="write"
          />
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2 border-t border-accent/10 pt-4">
        <Button variant="secondary" onClick={onCancel}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button onClick={handleSave} loading={saving}>
          {t("common.save", "Save")}
        </Button>
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
        active ? "bg-card text-strong card-impression" : "text-meta hover:text-strong"
      }`}
    >
      {children}
    </button>
  );
}
