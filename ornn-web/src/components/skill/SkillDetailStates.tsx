/**
 * Loading + not-found shell states for SkillDetailPage (#453).
 *
 * Pulled out so the page file only carries the happy-path render. Each
 * state component owns its own PageTransition wrapper so the route
 * still feels animated even when the data isn't there yet.
 *
 * @module components/skill/SkillDetailStates
 */

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

export function SkillDetailLoading() {
  return (
    <PageTransition>
      <div className="flex h-full items-center justify-center">
        <Skeleton lines={10} />
      </div>
    </PageTransition>
  );
}

export function SkillDetailNotFound() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <PageTransition>
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="mb-2 font-display text-2xl text-danger">
            {t("skillDetail.notFound")}
          </h2>
          <p className="text-meta">{t("skillDetail.notFoundDesc")}</p>
          <Button onClick={() => navigate("/registry")} className="mt-6">
            {t("skillDetail.backToExplore")}
          </Button>
        </div>
      </div>
    </PageTransition>
  );
}
