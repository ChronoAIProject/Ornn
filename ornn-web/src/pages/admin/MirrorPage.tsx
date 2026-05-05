/**
 * /admin/mirror — GitHub mirror operations console.
 *
 * Three blocks stacked:
 *
 *   1. **Status header** — feature enabled flag + current `<owner>/<repo>`
 *      (with a click-through to the GitHub repo) + last reconcile run.
 *   2. **Counts grid** — eligible / synced / lagging / never-synced
 *      cards with a tooltip explaining each. The "oldest unsynced"
 *      timestamp surfaces the worst lag in the system, so an operator
 *      can spot a stuck cron from the dashboard alone.
 *   3. **Reconcile button** — triggers a fire-and-forget run; the
 *      status auto-polls on a 5s interval while a run is in progress
 *      (see `useMirrorStatus`).
 *   4. **Repo settings form** — owner / repo / branch inputs. Editing
 *      requires explicit confirmation when the change would orphan an
 *      already-mirrored repo (existing skill stamps point at commit
 *      SHAs in the OLD repo; abandoning means clearing all stamps and
 *      letting the next reconcile re-publish everything).
 *
 * @module pages/admin/MirrorPage
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  useGithubRepo,
  useMirrorStatus,
  useTriggerReconcile,
  useUpdateGithubRepo,
} from "@/hooks/useGithubMirror";
import { useToastStore } from "@/stores/toastStore";
import { ApiClientError } from "@/services/apiClient";

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

  const { data: repoCfg } = useGithubRepo();
  const { data: status, isLoading: statusLoading, isError: statusError } = useMirrorStatus();
  const triggerReconcile = useTriggerReconcile();
  const updateRepo = useUpdateGithubRepo();

  // Repo settings form local state. Seeded from `repoCfg` once it
  // loads. We keep the form independent so admins can revert edits.
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  useEffect(() => {
    if (repoCfg) {
      setOwner(repoCfg.owner);
      setRepo(repoCfg.repo);
      setBranch(repoCfg.branch);
    }
  }, [repoCfg]);

  const dirty =
    !!repoCfg &&
    (owner.trim() !== repoCfg.owner ||
      repo.trim() !== repoCfg.repo ||
      branch.trim() !== repoCfg.branch);

  const wouldChangeRepo =
    !!repoCfg &&
    (owner.trim() !== repoCfg.owner || repo.trim() !== repoCfg.repo);

  const stampedCount =
    status?.counts ? status.counts.synced + status.counts.lagging : 0;

  const handleSaveClick = () => {
    if (!dirty) return;
    if (wouldChangeRepo && stampedCount > 0) {
      setConfirmModalOpen(true);
      return;
    }
    void doSave(false);
  };

  const doSave = async (confirmAbandon: boolean) => {
    try {
      await updateRepo.mutateAsync({
        owner: owner.trim(),
        repo: repo.trim(),
        branch: branch.trim(),
        confirmAbandonOldRepo: confirmAbandon,
      });
      setConfirmModalOpen(false);
      addToast({
        type: "success",
        message: t("adminMirror.saved", "Mirror coords updated. Stamps cleared; next reconcile will re-publish."),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        err instanceof ApiClientError ? err.code : null;
      // Surface the abandon-confirm path even if the modal was bypassed.
      if (code === "OLD_REPO_NOT_CONFIRMED") {
        setConfirmModalOpen(true);
      } else {
        addToast({ type: "error", message });
      }
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
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: "error", message });
    }
  };

  const lastRun = status?.lastReconcile;
  const reconcileRunning = lastRun?.status === "running";

  return (
    <PageTransition>
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="mb-6">
          <h1 className="font-display text-3xl text-strong">
            {t("adminMirror.title", "GitHub Mirror")}
          </h1>
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

        {status && repoCfg && (
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
                    : t("adminMirror.featureOff", "Feature disabled (kill switch in configmap)")}
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
                  {t("adminMirror.lastReconcile", "Last reconcile")}
                </div>
                <div className="mt-0.5 text-strong">
                  {reconcileRunning
                    ? t("adminMirror.runningSince", "Running since {{when}}", {
                        when: formatTime(lastRun?.startedAt ?? null),
                      })
                    : lastRun?.finishedAt
                      ? formatTime(lastRun.finishedAt)
                      : t("adminMirror.never", "Never")}
                </div>
                {!reconcileRunning && lastRun?.durationMs !== null && lastRun?.durationMs !== undefined && (
                  <div>
                    {t("adminMirror.duration", "Duration")} {formatDuration(lastRun.durationMs)}
                  </div>
                )}
                {lastRun?.error && (
                  <div className="mt-1 max-w-xs truncate text-danger" title={lastRun.error}>
                    {t("adminMirror.lastError", "Last error")}: {lastRun.error}
                  </div>
                )}
                {!reconcileRunning && lastRun?.result && (
                  <div className="mt-1 font-mono text-[11px]">
                    +{lastRun.result.added} ~{lastRun.result.updated} −{lastRun.result.removed} ={" "}
                    {lastRun.result.unchanged}
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
                    "The hourly cron at :17 runs the same operation. Hit this when you can't wait — fire-and-forget, the page polls until it lands.",
                  )}
                </p>
              </div>
              <Button
                onClick={handleReconcile}
                disabled={!status.enabled || reconcileRunning || triggerReconcile.isPending}
                loading={triggerReconcile.isPending || reconcileRunning}
              >
                {reconcileRunning
                  ? t("adminMirror.reconcileRunning", "Running…")
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
                    "Where mirrored skills land. The kill switch (GITHUB_MIRROR_ENABLED) stays in the configmap by design.",
                  )}
                </p>
              </div>
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
                        "Saving updates the next sync's target. The cron's next run picks up the new coords automatically.",
                      )}
                </p>
                <Button
                  onClick={handleSaveClick}
                  disabled={!dirty}
                  loading={updateRepo.isPending}
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
                  current: repoCfg ? `${repoCfg.owner}/${repoCfg.repo}` : "",
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
              <Button onClick={() => doSave(true)} loading={updateRepo.isPending}>
                {t("adminMirror.confirmConfirm", "Yes, change repo")}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </PageTransition>
  );
}
