/**
 * /skills/new/from-github — create a skill by pulling a public GitHub repo.
 *
 * Thin wrapper around `POST /api/v1/skills/pull`: the backend does the
 * cloning, zipping, and publication. This page just collects the repo
 * coords and surfaces errors.
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

const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/;

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

export function CreateSkillFromGitHubPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const pull = usePullSkillFromGitHub();

  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("");
  const [path, setPath] = useState("");
  const [skipValidation, setSkipValidation] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const repoValid = REPO_PATTERN.test(repo.trim());
  const canSubmit = repoValid && !pull.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!repoValid) return;
    try {
      const skill = await pull.mutateAsync({
        repo: repo.trim(),
        ref: ref.trim() || undefined,
        path: path.trim() || undefined,
        skipValidation,
      });
      addToast({
        type: "success",
        message: t("githubImport.success", "Skill pulled from GitHub."),
      });
      navigate(`/skills/${skill.guid}`);
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : t("githubImport.genericError", "Failed to pull from GitHub."),
      });
    }
  };

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-2">
        <div className="mx-auto w-full max-w-2xl">
          <Link
            to="/skills/new"
            className="inline-flex items-center gap-2 font-body text-sm text-text-muted transition-colors hover:text-text-primary mb-4"
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
                <div className="rounded-2xl border border-neon-cyan/30 bg-neon-cyan/10 p-3">
                  <GitHubMarkIcon className="h-8 w-8 text-neon-cyan" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="font-heading text-2xl text-neon-cyan">
                    {t("githubImport.title", "Import from GitHub")}
                  </h1>
                  <p className="mt-1 font-body text-sm text-text-muted">
                    {t(
                      "githubImport.subtitle",
                      "Publish a skill from a public GitHub repo. Later updates can be pulled in one click.",
                    )}
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label
                    htmlFor="repo"
                    className="mb-1 block font-heading text-xs uppercase tracking-wider text-text-muted"
                  >
                    {t("githubImport.repoLabel", "Repository")}{" "}
                    <span className="text-neon-red">*</span>
                  </label>
                  <input
                    id="repo"
                    type="text"
                    placeholder="owner/name"
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    className={`w-full rounded-lg border bg-bg-surface px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 ${
                      submitted && !repoValid
                        ? "border-neon-red/40 focus:ring-neon-red/40"
                        : "border-neon-cyan/20 focus:border-neon-cyan/60 focus:ring-neon-cyan/30"
                    }`}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="mt-1 font-body text-xs text-text-muted">
                    {t(
                      "githubImport.repoHint",
                      "The repo must be public. Private repos are not yet supported.",
                    )}
                  </p>
                  {submitted && !repoValid && (
                    <p className="mt-1 font-body text-xs text-neon-red">
                      {t(
                        "githubImport.repoInvalid",
                        "Expected format: owner/name (e.g. anthropics/claude-code).",
                      )}
                    </p>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="ref"
                      className="mb-1 block font-heading text-xs uppercase tracking-wider text-text-muted"
                    >
                      {t("githubImport.refLabel", "Branch / tag / commit")}
                    </label>
                    <input
                      id="ref"
                      type="text"
                      placeholder="main"
                      value={ref}
                      onChange={(e) => setRef(e.target.value)}
                      className="w-full rounded-lg border border-neon-cyan/20 bg-bg-surface px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-neon-cyan/60 focus:ring-2 focus:ring-neon-cyan/30"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="mt-1 font-body text-xs text-text-muted">
                      {t("githubImport.refHint", "Leave blank to use the default branch.")}
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="path"
                      className="mb-1 block font-heading text-xs uppercase tracking-wider text-text-muted"
                    >
                      {t("githubImport.pathLabel", "Path in repo")}
                    </label>
                    <input
                      id="path"
                      type="text"
                      placeholder="skills/my-skill"
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      className="w-full rounded-lg border border-neon-cyan/20 bg-bg-surface px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-neon-cyan/60 focus:ring-2 focus:ring-neon-cyan/30"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="mt-1 font-body text-xs text-text-muted">
                      {t(
                        "githubImport.pathHint",
                        "Sub-directory that contains SKILL.md. Leave blank for repo root.",
                      )}
                    </p>
                  </div>
                </div>

                <label className="flex cursor-pointer items-center gap-2 font-body text-sm text-text-muted">
                  <input
                    type="checkbox"
                    checked={skipValidation}
                    onChange={(e) => setSkipValidation(e.target.checked)}
                    className="h-4 w-4 accent-neon-cyan"
                  />
                  {t("githubImport.skipValidation", "Skip format validation (advanced)")}
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
                    {t("githubImport.submit", "Import")}
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
