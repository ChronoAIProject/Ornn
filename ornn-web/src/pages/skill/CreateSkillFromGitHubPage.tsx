/**
 * /skills/new/from-github — create a skill by syncing a folder in a
 * public GitHub repo.
 *
 * Single-step form: enter the folder URL (e.g.
 * `https://github.com/owner/repo/tree/<ref>/<path>`), optionally tick
 * "skip validation" if your upstream doesn't strictly follow Ornn's
 * package layout, then click "Sync from GitHub" to actually pull. The
 * folder URL is parsed server-side into repo / ref / path. Without the
 * Sync click, nothing is fetched — the form is the contract.
 *
 * Mirrors the GitHub-link panel inside `AdvancedOptionsModal` so the
 * "first sync" and "subsequent sync" UX are visually consistent.
 *
 * @module pages/CreateSkillFromGitHubPage
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ArrowLeftIcon } from "@/components/icons";
import { usePullSkillFromGitHub } from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";

function GitHubMarkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5a11.5 11.5 0 00-3.64 22.42c.58.11.79-.25.79-.56v-2.16c-3.21.7-3.89-1.37-3.89-1.37-.52-1.32-1.28-1.67-1.28-1.67-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.97.1-.76.4-1.27.73-1.56-2.56-.29-5.26-1.28-5.26-5.72 0-1.26.45-2.3 1.19-3.11-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18.92-.26 1.92-.39 2.9-.39.99 0 1.98.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.85 1.19 3.11 0 4.45-2.7 5.42-5.28 5.71.41.35.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.5 11.5 0 0012 .5z" />
    </svg>
  );
}

const VALID_URL_PREFIX = /^https?:\/\/(www\.)?github\.com\//i;

export function CreateSkillFromGitHubPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const pull = usePullSkillFromGitHub();

  const [githubUrl, setGithubUrl] = useState("");
  const [skipValidation, setSkipValidation] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const trimmed = githubUrl.trim();
  const urlValid = VALID_URL_PREFIX.test(trimmed);
  const canSubmit = urlValid && !pull.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!urlValid) return;
    try {
      const skill = await pull.mutateAsync({ githubUrl: trimmed, skipValidation });
      addToast({
        type: "success",
        message: t("githubImport.success", "Skill pulled from GitHub.") as string,
      });
      navigate(`/skills/${skill.guid}`);
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : (t("githubImport.genericError", "Failed to pull from GitHub.") as string),
      });
    }
  };

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-2">
        <div className="mx-auto w-full max-w-2xl">
          <Link
            to="/skills/new"
            className="inline-flex items-center gap-2 font-body text-sm text-meta transition-colors hover:text-strong mb-4"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t("githubImport.backToModes", "Back to creation modes")}
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <Card className="p-6">
              <div className="flex items-start gap-4 mb-6">
                <div className="rounded-2xl border border-accent/30 bg-accent/10 p-3">
                  <GitHubMarkIcon className="h-8 w-8 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="font-heading text-2xl text-accent">
                    {t("githubImport.title", "Import from GitHub")}
                  </h1>
                  <p className="mt-1 font-body text-sm text-meta">
                    {t(
                      "githubImport.subtitle",
                      "Publish a skill from a folder in a public GitHub repo. Subsequent updates can be re-synced from the same link in one click.",
                    )}
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label
                    htmlFor="github-url"
                    className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-meta"
                  >
                    {t("githubImport.urlLabel", "GitHub folder URL")}{" "}
                    <span className="text-danger">*</span>
                  </label>
                  <input
                    id="github-url"
                    type="url"
                    inputMode="url"
                    placeholder="https://github.com/owner/repo/tree/main/path/to/skill"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    className={`w-full rounded-lg border bg-card px-3 py-2 font-mono text-sm text-strong placeholder:text-meta focus:outline-none focus:ring-2 ${
                      submitted && !urlValid
                        ? "border-danger/40 focus:ring-danger/40"
                        : "border-accent/20 focus:border-accent/60 focus:ring-accent/30"
                    }`}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="mt-1 font-body text-xs text-meta">
                    {t(
                      "githubImport.urlHint",
                      "Use the folder URL (the /tree/<ref>/<path> form). The skill's SKILL.md must sit at the root of that folder. Default-branch and repo-root URLs work too.",
                    )}
                  </p>
                  {submitted && !urlValid && (
                    <p className="mt-1 font-body text-xs text-danger">
                      {t(
                        "githubImport.urlInvalid",
                        "Enter a github.com URL (e.g. https://github.com/owner/repo/tree/main/path).",
                      )}
                    </p>
                  )}
                </div>

                <label className="flex cursor-pointer items-start gap-2 font-body text-sm text-meta">
                  <input
                    type="checkbox"
                    checked={skipValidation}
                    onChange={(e) => setSkipValidation(e.target.checked)}
                    className="h-4 w-4 mt-1 accent-accent"
                  />
                  <span>
                    <span className="block font-heading text-xs text-strong">
                      {t("githubImport.skipValidationLabel", "Skip Ornn package validation")}
                    </span>
                    <span className="block text-[11px]">
                      {t(
                        "githubImport.skipValidationHelp",
                        "GitHub-hosted skills don't always follow Ornn's package rules; tick this if you trust the upstream and want the import to succeed even when the validator would reject the layout.",
                      )}
                    </span>
                  </span>
                </label>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => navigate("/skills/new")}
                  >
                    {t("common.cancel", "Cancel")}
                  </Button>
                  <Button type="submit" disabled={!canSubmit} loading={pull.isPending}>
                    {t("githubImport.syncButton", "Sync from GitHub")}
                  </Button>
                </div>
              </form>
            </Card>
          </motion.div>
        </div>
      </div>
    </PageTransition>
  );
}
