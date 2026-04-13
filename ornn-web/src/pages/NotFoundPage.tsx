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
        <h1 className="neon-magenta mb-4 font-heading text-6xl font-bold text-neon-magenta">{t("notFound.code")}</h1>
        <p className="mb-8 font-body text-lg text-text-muted">
          {t("notFound.message")}
        </p>
        <Button onClick={() => navigate("/")}>{t("notFound.goHome")}</Button>
      </div>
    </PageTransition>
  );
}
