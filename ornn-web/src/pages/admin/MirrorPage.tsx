/**
 * /admin/mirror — GitHub mirror operations console.
 *
 * Five blocks stacked:
 *
 *   1. **Status header** — feature enabled flag (DB-backed, flippable
 *      below) + current `<owner>/<repo>` (with a click-through to the
 *      GitHub repo) + last reconcile run.
 *   2. **Counts grid** — eligible / synced / lagging / never-synced
 *      cards with a tooltip explaining each. The "oldest unsynced"
 *      timestamp surfaces the worst lag in the system, so an operator
 *      can spot a stuck cron from the dashboard alone.
 *   3. **Reconcile button** — triggers a fire-and-forget run; the
 *      status auto-polls on a 5s interval while a run is in progress.
 *   4. **Repo settings form** — enable toggle + owner / repo / branch.
 *      Editing requires explicit confirmation when the change would
 *      orphan an already-mirrored repo (existing skill stamps point
 *      at commit SHAs in the OLD repo; abandoning means clearing all
 *      stamps and letting the next reconcile re-publish everything).
 *   5. **GitHub App credentials** — App ID + Installation ID + App
 *      Private Key (PEM). The private key is encrypted at rest and
 *      mid-masked on read; round-tripping the masked value preserves
 *      the stored key.
 *
 * @module pages/admin/MirrorPage
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  useMirrorStatus,
  useTriggerReconcile,
  useUpdateMirrorConfig,
} from "@/hooks/useGithubMirror";
import { useToastStore } from "@/stores/toastStore";
import { ApiClientError } from "@/services/apiClient";
import { MirrorSetupHelp } from "@/components/admin/MirrorSetupHelp";
import { translateError } from "@/utils/translateError";

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

/**
 * Mid-mask sentinel: server returns the persisted private key with `•`
 * characters in the middle. Real PEMs never contain that character, so
 * any round-trip carrying a bullet means "preserve existing".
 */
function isMaskedKey(v: string): boolean {
  return v.includes("•");
}

interface CountCardProps {
  label: string;
  value: number;
  hint?: string;
  tone?: "ok" | "warn" | "neutral";
}

function CountCard({ label, value, hint, tone = "neutral" }: CountCardProps) {
  const toneClass =
    tone === "ok"
      ? "text-success"
      : tone === "warn"
        ? "text-warning"
        : "text-strong";
  return (
    <Card className="p-4">
      <div
        className={`font-mono text-[10px] uppercase tracking-[0.16em] text-meta`}
      >
        {label}
      </div>
      <div className={`mt-1 font-display text-3xl ${toneClass}`}>{value}</div>
      {hint && (
        <div className="mt-1 font-text text-xs text-meta">{hint}</div>
      )}
    </Card>
  );
}

export function MirrorPage() {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);

  const { data: status, isLoading: statusLoading, isError: statusError } = useMirrorStatus();
  const triggerReconcile = useTriggerReconcile();
  const updateConfig = useUpdateMirrorConfig();

  // ── Repo settings form local state ──
  // Seeded from `status` once it loads. Form is independent so admins
  // can revert edits before saving.
  const [enabled, setEnabled] = useState(false);
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  // ── App credentials form local state ──
  const [appId, setAppId] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [appPrivateKey, setAppPrivateKey] = useState("");

  // Seed / re-seed both forms from `status` using the "adjust state
  // during render" guard rather than an effect (avoids the extra commit
  // + cascading render, #888). Tracks the server object identity so a
  // refetch re-seeds — matching the prior `[status]` effect behaviour.
  const [prevStatus, setPrevStatus] = useState(status);
  if (status && status !== prevStatus) {
    setPrevStatus(status);
    setEnabled(status.enabled);
    setOwner(status.repo.owner);
    setRepo(status.repo.repo);
    setBranch(status.repo.branch);
    setAppId(status.appId);
    setInstallationId(status.installationId);
    setAppPrivateKey(status.appPrivateKey);
  }

  const repoFormDirty =
    !!status &&
    (enabled !== status.enabled ||
      owner.trim() !== status.repo.owner ||
      repo.trim() !== status.repo.repo ||
      branch.trim() !== status.repo.branch);

  const credsFormDirty =
    !!status &&
    (appId.trim() !== status.appId ||
      installationId.trim() !== status.installationId ||
      appPrivateKey !== status.appPrivateKey);

  const wouldChangeRepo =
    !!status &&
    (owner.trim() !== status.repo.owner || repo.trim() !== status.repo.repo);

  const stampedCount =
    status?.counts ? status.counts.synced + status.counts.lagging : 0;

  const handleSaveRepoClick = () => {
    if (!repoFormDirty) return;
    if (wouldChangeRepo && stampedCount > 0) {
      setConfirmModalOpen(true);
      return;
    }
    void doSaveRepo(false);
  };

  const doSaveRepo = async (confirmAbandon: boolean) => {
    try {
      await updateConfig.mutateAsync({
        enabled,
        owner: owner.trim(),
        repo: repo.trim(),
        branch: branch.trim(),
        confirmAbandonOldRepo: confirmAbandon,
      });
      setConfirmModalOpen(false);
      addToast({
        type: "success",
        message: wouldChangeRepo
          ? t(
              "adminMirror.savedAbandon",
              "Mirror coords updated. Stamps cleared; next reconcile will re-publish.",
            )
          : t("adminMirror.savedRepo", "Mirror settings saved."),
      });
    } catch (err) {
      const message = translateError(err);
      const code = err instanceof ApiClientError ? err.code : null;
      // Surface the abandon-confirm path even if the modal was bypassed.
      if (code === "old_repo_not_confirmed") {
        setConfirmModalOpen(true);
      } else {
        addToast({ type: "error", message });
      }
    }
  };

  const doSaveCreds = async () => {
    if (!credsFormDirty) return;
    try {
      await updateConfig.mutateAsync({
        appId: appId.trim(),
        installationId: installationId.trim(),
        // If the field still carries a bullet, the server preserves the
        // existing key (round-trip of the mid-masked display value).
        appPrivateKey,
      });
      addToast({
        type: "success",
        message: t("adminMirror.savedCreds", "GitHub App credentials saved."),
      });
    } catch (err) {
      const message = translateError(err);
      addToast({ type: "error", message });
    }
  };

  const handleReconcile = async () => {
    try {
      await triggerReconcile.mutateAsync();
      addToast({
        type: "success",
        message: t(
          "adminMirror.reconcileKicked",
          "Reconcile kicked off — status will update as it lands.",
        ),
      });
    } catch (err) {
      const message = translateError(err);
      addToast({ type: "error", message });
    }
  };

  // Last *scheduled* reconcile — sourced from the persisted `scheduledRun`
  // block (Agenda's `agendaJobs` doc), so it survives pod restarts and
  // aggregates across replicas. Manual `Reconcile now` clicks are tracked
  // server-side via in-process state for the 409 guard; their progress is
  // not surfaced in this widget.
  const lastRun = status?.scheduledRun;
  const scheduledFireRunning = lastRun?.status === "running";
  const credsConfigured = !!status && !!status.appId && !!status.installationId && !!status.appPrivateKey;

  return (
    <PageTransition>
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="mb-6">
          <div className="flex items-start gap-2">
            <h1 className="font-display text-3xl text-strong">
              {t("adminMirror.title", "GitHub Mirror")}
            </h1>
            <MirrorSetupHelp className="mt-2" />
          </div>
          <p className="mt-1 font-text text-sm text-meta">
            {t(
              "adminMirror.subtitle",
              "Auto-mirror of public + system skills to GitHub for npx-skills installation. Private skills are never mirrored — that's the moat.",
            )}
          </p>
        </header>

        {statusLoading && (
          <p className="py-12 text-center font-text text-sm text-meta">
            {t("adminMirror.loading", "Loading mirror status…")}
          </p>
        )}
        {statusError && (
          <p className="py-12 text-center font-text text-sm text-danger">
            {t("adminMirror.loadFailed", "Could not load mirror status.")}
          </p>
        )}

        {status && (
          <div className="space-y-6">
            {/* ── Status header ── */}
            <Card className="flex flex-wrap items-start justify-between gap-4 p-5">
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-meta">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      status.enabled ? "bg-success" : "bg-meta"
                    }`}
                  />
                  {status.enabled
                    ? t("adminMirror.featureOn", "Feature enabled")
                    : t("adminMirror.featureOff", "Feature disabled — flip the toggle below to enable")}
                </div>
                <a
                  href={`https://github.com/${status.repo.owner}/${status.repo.repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-display text-xl text-strong underline-offset-4 transition hover:underline"
                >
                  {status.repo.owner}/{status.repo.repo}
                </a>
                <div className="font-text text-xs text-meta">
                  {t("adminMirror.branch", "Branch")}{" "}
                  <code className="font-mono">{status.repo.branch}</code>
                </div>
              </div>
              <div className="text-right font-text text-xs text-meta">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-meta">
                  {t("adminMirror.lastReconcile", "Last scheduled reconcile")}
                </div>
                <div className="mt-0.5 text-strong">
                  {scheduledFireRunning
                    ? t("adminMirror.runningSince", "Running since {{when}}", {
                        when: formatTime(lastRun?.lastRunAt ?? null),
                      })
                    : lastRun?.lastFinishedAt
                      ? formatTime(lastRun.lastFinishedAt)
                      : t("adminMirror.never", "Never")}
                </div>
                {!scheduledFireRunning && lastRun?.lastDurationMs != null && (
                  <div>
                    {t("adminMirror.duration", "Duration")} {formatDuration(lastRun.lastDurationMs)}
                  </div>
                )}
                {lastRun?.lastError && (
                  <div className="mt-1 max-w-xs truncate text-danger" title={lastRun.lastError}>
                    {t("adminMirror.lastError", "Last error")}: {lastRun.lastError}
                  </div>
                )}
              </div>
            </Card>

            {/* ── Counts grid ── */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <CountCard
                label={t("adminMirror.countEligible", "Eligible")}
                value={status.counts.eligible}
                hint={t("adminMirror.countEligibleHint", "Public + system skills")}
              />
              <CountCard
                label={t("adminMirror.countSynced", "Synced")}
                value={status.counts.synced}
                tone="ok"
                hint={t("adminMirror.countSyncedHint", "Latest version on the mirror")}
              />
              <CountCard
                label={t("adminMirror.countLagging", "Lagging")}
                value={status.counts.lagging}
                tone={status.counts.lagging > 0 ? "warn" : "neutral"}
                hint={t("adminMirror.countLaggingHint", "Mirrored, but stale version")}
              />
              <CountCard
                label={t("adminMirror.countNeverSynced", "Never synced")}
                value={status.counts.neverSynced}
                tone={status.counts.neverSynced > 0 ? "warn" : "neutral"}
                hint={
                  status.counts.oldestUnsyncedAt
                    ? t("adminMirror.countNeverSyncedOldest", "Oldest pending: {{when}}", {
                        when: formatTime(status.counts.oldestUnsyncedAt),
                      })
                    : t("adminMirror.countNeverSyncedNone", "Nothing pending")
                }
              />
            </div>

            {/* ── Reconcile button ── */}
            <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <h2 className="font-display text-base text-strong">
                  {t("adminMirror.reconcileTitle", "Manual reconcile")}
                </h2>
                <p className="mt-1 font-text text-xs text-meta">
                  {t(
                    "adminMirror.reconcileSubtitle",
                    "The in-process scheduler runs the same operation on the cadence set in mirror settings. Hit this when you can't wait — fire-and-forget, the page polls until it lands.",
                  )}
                </p>
                {!credsConfigured && status.enabled && (
                  <p className="mt-1 font-text text-xs text-warning">
                    {t(
                      "adminMirror.credsMissing",
                      "GitHub App credentials are missing — fill the form below before reconciling.",
                    )}
                  </p>
                )}
              </div>
              <Button
                onClick={handleReconcile}
                disabled={
                  !status.enabled || !credsConfigured || scheduledFireRunning || triggerReconcile.isPending
                }
                loading={triggerReconcile.isPending || scheduledFireRunning}
              >
                {scheduledFireRunning
                  ? t("adminMirror.scheduledFireRunning", "Running…")
                  : t("adminMirror.reconcileButton", "Reconcile now")}
              </Button>
            </Card>

            {/* ── Repo settings form ── */}
            <Card className="space-y-4 p-5">
              <div>
                <h2 className="font-display text-base text-strong">
                  {t("adminMirror.repoFormTitle", "Mirror repository")}
                </h2>
                <p className="mt-1 font-text text-xs text-meta">
                  {t(
                    "adminMirror.repoFormSubtitle",
                    "Where mirrored skills land + master kill switch. All settings are stored in the database; no redeploy required.",
                  )}
                </p>
              </div>
              <label className="flex items-center gap-3 rounded border border-accent/20 bg-card px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-accent"
                />
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-strong">
                    {t("adminMirror.fieldEnabled", "Mirror enabled")}
                  </div>
                  <div className="font-text text-xs text-meta">
                    {t(
                      "adminMirror.fieldEnabledHint",
                      "Master kill switch. When off, every mirror operation no-ops regardless of credentials.",
                    )}
                  </div>
                </div>
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <label className="block">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    {t("adminMirror.fieldOwner", "Owner")}
                  </div>
                  <input
                    type="text"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="ChronoAIProject"
                    className="w-full rounded border border-accent/20 bg-card px-3 py-2 font-mono text-sm text-strong focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/30"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    {t("adminMirror.fieldRepo", "Repo")}
                  </div>
                  <input
                    type="text"
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder="ornn-skills"
                    className="w-full rounded border border-accent/20 bg-card px-3 py-2 font-mono text-sm text-strong focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/30"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    {t("adminMirror.fieldBranch", "Branch")}
                  </div>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                    className="w-full rounded border border-accent/20 bg-card px-3 py-2 font-mono text-sm text-strong focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/30"
                  />
                </label>
              </div>
              <div className="flex items-center justify-between">
                <p className="font-text text-xs text-meta">
                  {wouldChangeRepo && stampedCount > 0
                    ? t(
                        "adminMirror.wouldAbandonHint",
                        "⚠ This change abandons the current repo. {{n}} skill(s) will be reset to 'Never synced'.",
                        { n: stampedCount },
                      )
                    : t(
                        "adminMirror.repoFormHint",
                        "Saving updates the next sync's target. The scheduler's next run picks up the new coords automatically.",
                      )}
                </p>
                <Button
                  onClick={handleSaveRepoClick}
                  disabled={!repoFormDirty}
                  loading={updateConfig.isPending}
                >
                  {t("common.save", "Save")}
                </Button>
              </div>
            </Card>

            {/* ── GitHub App credentials ── */}
            <Card className="space-y-4 p-5">
              <div>
                <h2 className="font-display text-base text-strong">
                  {t("adminMirror.credsTitle", "GitHub App credentials")}
                </h2>
                <p className="mt-1 font-text text-xs text-meta">
                  {t(
                    "adminMirror.credsSubtitle",
                    "App ID, Installation ID, and the RSA private key (PEM) the mirror service uses to mint installation tokens. The private key is encrypted at rest and mid-masked on read — leave it masked to keep the existing key, paste a fresh PEM to replace.",
                  )}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    {t("adminMirror.fieldAppId", "App ID")}
                  </div>
                  <input
                    type="text"
                    value={appId}
                    onChange={(e) => setAppId(e.target.value)}
                    placeholder="123456"
                    inputMode="numeric"
                    className="w-full rounded border border-accent/20 bg-card px-3 py-2 font-mono text-sm text-strong focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/30"
                  />
                  <div className="mt-1 font-text text-[11px] text-meta">
                    {t("adminMirror.fieldAppIdHint", "Numeric, from the App settings page on GitHub.")}
                  </div>
                </label>
                <label className="block">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    {t("adminMirror.fieldInstallationId", "Installation ID")}
                  </div>
                  <input
                    type="text"
                    value={installationId}
                    onChange={(e) => setInstallationId(e.target.value)}
                    placeholder="78901234"
                    inputMode="numeric"
                    className="w-full rounded border border-accent/20 bg-card px-3 py-2 font-mono text-sm text-strong focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/30"
                  />
                  <div className="mt-1 font-text text-[11px] text-meta">
                    {t(
                      "adminMirror.fieldInstallationIdHint",
                      "From `gh api /user/installations` or the App settings page.",
                    )}
                  </div>
                </label>
              </div>
              <label className="block">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                  {t("adminMirror.fieldPrivateKey", "App private key (PEM)")}
                </div>
                <textarea
                  value={appPrivateKey}
                  onChange={(e) => setAppPrivateKey(e.target.value)}
                  rows={6}
                  spellCheck={false}
                  placeholder={"-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----"}
                  className="w-full rounded border border-accent/20 bg-card px-3 py-2 font-mono text-xs text-strong focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/30"
                />
                <div className="mt-1 font-text text-[11px] text-meta">
                  {isMaskedKey(appPrivateKey)
                    ? t(
                        "adminMirror.fieldPrivateKeyMaskedHint",
                        "Showing a mid-masked snapshot of the persisted key. Leave masked to keep it; paste a fresh PEM to replace.",
                      )
                    : t(
                        "adminMirror.fieldPrivateKeyHint",
                        "Encrypted at rest with AES-256-GCM. The DB only ever sees ciphertext.",
                      )}
                </div>
              </label>
              <div className="flex items-center justify-between">
                <p className="font-text text-xs text-meta">
                  {t(
                    "adminMirror.credsFormHint",
                    "Credentials take effect on the next sync — no pod restart needed.",
                  )}
                </p>
                <Button
                  onClick={() => void doSaveCreds()}
                  disabled={!credsFormDirty}
                  loading={updateConfig.isPending}
                >
                  {t("common.save", "Save")}
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* ── Abandon-old-repo confirm modal ── */}
        <Modal
          isOpen={confirmModalOpen}
          onClose={() => setConfirmModalOpen(false)}
          title={t("adminMirror.confirmTitle", "Confirm: abandon current mirror repo")}
        >
          <div className="space-y-4">
            <p className="font-text text-sm text-body">
              {t(
                "adminMirror.confirmBodyA",
                "You're about to point the mirror at a different GitHub repo. The current repo ({{current}}) will be left as-is — Ornn does not delete it.",
                {
                  current: status ? `${status.repo.owner}/${status.repo.repo}` : "",
                },
              )}
            </p>
            <p className="font-text text-sm text-body">
              {t(
                "adminMirror.confirmBodyB",
                "{{n}} skill(s) currently carry mirror stamps pointing at commit SHAs in the old repo. Saving clears every stamp; the next reconcile will re-publish all eligible skills to {{newRepo}}.",
                {
                  n: stampedCount,
                  newRepo: `${owner.trim()}/${repo.trim()}`,
                },
              )}
            </p>
            <div className="flex items-center justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirmModalOpen(false)}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button onClick={() => doSaveRepo(true)} loading={updateConfig.isPending}>
                {t("adminMirror.confirmConfirm", "Yes, change repo")}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </PageTransition>
  );
}
