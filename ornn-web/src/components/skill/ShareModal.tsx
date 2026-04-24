/**
 * ShareModal — opens from SkillDetailPage to start an audit-gated share
 * request. Distinct from `PermissionsModal`, which edits the static
 * `sharedWithUsers` / `sharedWithOrgs` allow-list without audit.
 *
 * Target types:
 *   - user:   single NyxID user_id, selected via email typeahead.
 *   - org:    dropdown of caller's NyxID orgs (admin / member).
 *   - public: no picker; warns that the audit engine will run.
 *
 * Submit fires `POST /api/v1/skills/:idOrName/share`. After success the
 * modal closes; the caller's inline in-flight request list picks the
 * new row up on the next poll.
 *
 * @module components/skill/ShareModal
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useMyOrgs } from "@/hooks/useMe";
import { useInitiateShare } from "@/hooks/useShares";
import { useToastStore } from "@/stores/toastStore";
import {
  searchUsersByEmail,
  type UserDirectoryEntry,
} from "@/services/usersApi";
import type { ShareTargetType } from "@/types/shares";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  skillIdOrName: string;
  skillName: string;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

type TargetChoice =
  | { type: "user"; user: UserDirectoryEntry | null }
  | { type: "org"; orgId: string }
  | { type: "public" };

export function ShareModal({
  isOpen,
  onClose,
  skillIdOrName,
  skillName,
}: ShareModalProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: myOrgs = [] } = useMyOrgs();
  const mutation = useInitiateShare();

  const [tab, setTab] = useState<ShareTargetType>("user");
  const [pickedUser, setPickedUser] = useState<UserDirectoryEntry | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [orgId, setOrgId] = useState<string>("");

  // Reset on (re)open so the form doesn't carry state from a prior skill.
  useEffect(() => {
    if (!isOpen) return;
    setTab("user");
    setPickedUser(null);
    setUserQuery("");
    setOrgId(myOrgs[0]?.userId ?? "");
  }, [isOpen, myOrgs]);

  const debouncedQuery = useDebouncedValue(userQuery.trim(), 200);
  const userResults = useQuery<UserDirectoryEntry[]>({
    queryKey: ["users", "search", debouncedQuery] as const,
    queryFn: () => searchUsersByEmail(debouncedQuery, 8),
    enabled: tab === "user" && debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  const choice = useMemo<TargetChoice>(() => {
    if (tab === "public") return { type: "public" };
    if (tab === "org") return { type: "org", orgId };
    return { type: "user", user: pickedUser };
  }, [tab, orgId, pickedUser]);

  const canSubmit =
    (choice.type === "public") ||
    (choice.type === "org" && choice.orgId !== "") ||
    (choice.type === "user" && choice.user !== null);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      const input =
        choice.type === "public"
          ? { targetType: "public" as const }
          : choice.type === "org"
            ? { targetType: "org" as const, targetId: choice.orgId }
            : { targetType: "user" as const, targetId: choice.user!.userId };

      await mutation.mutateAsync({ skillIdOrName, input });
      addToast({
        type: "success",
        message: t("share.initiated", "Share request initiated."),
      });
      onClose();
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : t("share.initiateFailed", "Failed to initiate share."),
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("share.title", "Share skill")}>
      <p className="font-body text-sm text-text-muted mb-5">
        {t(
          "share.subtitle",
          "Share '{{skillName}}' with a user, an org, or the public. Audit findings (if any) will be surfaced and reviewed before access is granted.",
          { skillName },
        )}
      </p>

      {/* Target-type segmented control */}
      <div className="mb-4 grid grid-cols-3 overflow-hidden rounded-lg border border-neon-cyan/20 bg-bg-surface/40">
        {([
          ["user", t("share.targetUser", "A user")],
          ["org", t("share.targetOrg", "An org")],
          ["public", t("share.targetPublic", "Public")],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-2 font-body text-sm transition-colors cursor-pointer ${
              tab === key
                ? "bg-neon-cyan/15 text-neon-cyan"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Target picker */}
      <div className="mb-6 space-y-2">
        {tab === "user" && (
          <>
            <label
              htmlFor="share-user"
              className="block font-heading text-[11px] uppercase tracking-wider text-text-muted"
            >
              {t("share.pickUser", "Pick a user")}
            </label>
            {pickedUser ? (
              <div className="flex items-center justify-between rounded-lg border border-neon-cyan/20 bg-bg-surface/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-body text-sm text-text-primary truncate">
                    {pickedUser.displayName || pickedUser.email}
                  </p>
                  <p className="font-mono text-xs text-text-muted truncate">
                    {pickedUser.email || pickedUser.userId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPickedUser(null);
                    setUserQuery("");
                  }}
                  className="font-body text-xs text-text-muted transition-colors hover:text-neon-red cursor-pointer"
                >
                  {t("share.removeUser", "Remove")}
                </button>
              </div>
            ) : (
              <>
                <input
                  id="share-user"
                  type="text"
                  placeholder={t("share.userPlaceholder", "Start typing an email…") as string}
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  className="w-full rounded-lg border border-neon-cyan/20 bg-bg-surface px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-neon-cyan/60 focus:ring-2 focus:ring-neon-cyan/30"
                  autoComplete="off"
                  spellCheck={false}
                />
                {debouncedQuery.length >= 2 && (
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-neon-cyan/15 bg-bg-surface/40">
                    {userResults.isLoading ? (
                      <p className="px-3 py-2 font-body text-xs text-text-muted">
                        {t("share.userSearching", "Searching…")}
                      </p>
                    ) : userResults.data && userResults.data.length > 0 ? (
                      userResults.data.map((u) => (
                        <button
                          key={u.userId}
                          type="button"
                          onClick={() => setPickedUser(u)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-neon-cyan/5 cursor-pointer"
                        >
                          <span className="font-body text-sm text-text-primary truncate">
                            {u.displayName || u.email}
                          </span>
                          <span className="font-mono text-xs text-text-muted truncate">
                            {u.email}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-2 font-body text-xs text-text-muted">
                        {t("share.userNoMatch", "No users matched.")}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {tab === "org" && (
          <>
            <label
              htmlFor="share-org"
              className="block font-heading text-[11px] uppercase tracking-wider text-text-muted"
            >
              {t("share.pickOrg", "Pick an org")}
            </label>
            {myOrgs.length === 0 ? (
              <p className="rounded-lg border border-neon-yellow/30 bg-neon-yellow/5 px-3 py-2 font-body text-sm text-text-muted">
                {t(
                  "share.noOrgs",
                  "You're not a member of any orgs. Join an org on NyxID first.",
                )}
              </p>
            ) : (
              <select
                id="share-org"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                className="w-full rounded-lg border border-neon-cyan/20 bg-bg-surface px-3 py-2 font-body text-sm text-text-primary focus:outline-none focus:border-neon-cyan/60 focus:ring-2 focus:ring-neon-cyan/30"
              >
                {myOrgs.map((o) => (
                  <option key={o.userId} value={o.userId}>
                    {o.displayName} ({o.role})
                  </option>
                ))}
              </select>
            )}
          </>
        )}

        {tab === "public" && (
          <div className="rounded-lg border border-neon-yellow/30 bg-neon-yellow/5 px-3 py-3 font-body text-sm text-text-primary">
            {t(
              "share.publicWarning",
              "Publishing to the public triggers an audit. If the verdict is anything other than green, you'll need to submit justifications and an Ornn admin reviews before access is granted.",
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!canSubmit || mutation.isPending}
          loading={mutation.isPending}
        >
          {t("share.submit", "Initiate share")}
        </Button>
      </div>
    </Modal>
  );
}
