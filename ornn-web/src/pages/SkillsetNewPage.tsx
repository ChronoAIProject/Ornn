/**
 * SkillsetNewPage — create a new skillset (POST /skillsets).
 *
 * Wraps `SkillsetForm` in create mode. On success, navigates to the new
 * skillset's detail page. New skillsets are private by default — visibility is
 * managed afterward via the permissions modal on the detail page.
 *
 * @module pages/SkillsetNewPage
 */

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { BackLink } from "@/components/layout/BackLink";
import { SkillsetForm } from "@/components/skillset/SkillsetForm";
import { useCreateSkillset } from "@/hooks/useSkillsets";
import { useToastStore } from "@/stores/toastStore";
import { translateError } from "@/utils/translateError";
import type { CreateSkillsetInput } from "@/types/skillset";

export function SkillsetNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const createMutation = useCreateSkillset();

  async function handleCreate(input: CreateSkillsetInput) {
    try {
      const created = await createMutation.mutateAsync(input);
      addToast({ type: "success", message: t("skillsetNew.created", "Skillset created") });
      navigate(`/skillsets/${created.name}`);
    } catch (err) {
      addToast({ type: "error", message: translateError(err) });
    }
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-3xl px-4 py-4 pb-16 sm:px-6 lg:px-8">
        <nav className="mb-4">
          <BackLink label={t("common.back", "Back")} />
        </nav>
        <h1 className="mb-2 font-display text-2xl font-semibold text-strong">
          {t("skillsetNew.title", "New skillset")}
        </h1>
        <p className="mb-6 font-text text-sm text-meta">
          {t(
            "skillsetNew.subtitle",
            "Bundle two or more skills with a master prompt that tells agents how to use them together.",
          )}
        </p>
        <SkillsetForm
          mode="create"
          onCreate={handleCreate}
          submitting={createMutation.isPending}
          onCancel={() => navigate("/skillsets")}
        />
      </div>
    </PageTransition>
  );
}
