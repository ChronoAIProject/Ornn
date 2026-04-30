/**
 * 404 Page — Forge Workshop.
 *
 * Big Space Grotesk numeric, ember accent, Inter explanation, mono "go home"
 * button via the Button primitive.
 *
 * @module pages/NotFoundPage
 */

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { Button } from "@/components/ui/Button";

export function NotFoundPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <PageTransition>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h1 className="mb-4 font-display text-7xl font-semibold tracking-tight text-accent">
          {t("notFound.code")}
        </h1>
        <p className="mb-8 max-w-md font-text text-base leading-relaxed text-body">
          {t("notFound.message")}
        </p>
        <Button onClick={() => navigate("/")}>{t("notFound.goHome")}</Button>
      </div>
    </PageTransition>
  );
}
