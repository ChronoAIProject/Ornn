/**
 * SkillsetEditPage — publish a new immutable version (PUT /skillsets/:id).
 *
 * Wraps `SkillsetForm` in edit mode, seeded from the current latest version.
 * The name is locked; the version field is required and must be bumped. On
 * success, navigates back to the detail page.
 *
 * The URL `:id` is human-readable (name OR guid); reads accept either, but the
 * publish route is GUID-only, so the form resolves through the GET first and
 * hands the resulting `guid` to the publish mutation.
 *
 * @module pages/SkillsetEditPage
 */

import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { BackLink } from "@/components/layout/BackLink";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { SkillsetForm } from "@/components/skillset/SkillsetForm";
import { useSkillset, usePublishSkillset } from "@/hooks/useSkillsets";
import { useToastStore } from "@/stores/toastStore";
import { translateError } from "@/utils/translateError";
import type { PublishSkillsetInput } from "@/types/skillset";

export function SkillsetEditPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);

  const idOrName = id ?? "";
  const { data: skillset, isLoading, error } = useSkillset(idOrName);
  // `guid` on the wire (publish is GUID-only); cache keys on the URL idOrName.
  const publishMutation = usePublishSkillset(skillset?.guid ?? idOrName, idOrName);

  if (isLoading) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <Skeleton lines={10} />
        </div>
      </PageTransition>
    );
  }

  if (error || !skillset) {
    return (
      <PageTransition>
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
          <EmptyState
            title={t("skillsetDetail.notFoundTitle", "Skillset not found")}
            description={t(
              "skillsetDetail.notFoundDesc",
              "It may have been deleted, or you may not have access to it.",
            )}
            action={
              <Button onClick={() => navigate("/skillsets")}>
                {t("skillsetDetail.backToRegistry", "Back to skillsets")}
              </Button>
            }
          />
        </div>
      </PageTransition>
    );
  }

  async function handlePublish(input: PublishSkillsetInput) {
    try {
      await publishMutation.mutateAsync(input);
      addToast({ type: "success", message: t("skillsetEdit.published", "New version published") });
      navigate(`/skillsets/${skillset!.name}`);
    } catch (err) {
      addToast({ type: "error", message: translateError(err) });
    }
  }

  return (
    <PageTransition>
      {/* RootLayout's <main> is overflow-hidden — each page owns its own scroll
          container (mirrors SkillsetDetailPage), else a tall form is clipped. */}
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-4 pb-16 sm:px-6 lg:px-8">
          <nav className="mb-4">
            <BackLink label={t("common.back", "Back")} />
          </nav>
          <h1 className="mb-2 font-display text-2xl font-semibold text-strong">
            {t("skillsetEdit.title", "Edit skillset")}
          </h1>
          <p className="mb-6 font-text text-sm text-meta">
            {t("skillsetEdit.subtitle", "Revise the members, prompt, kind, or tags and publish a new version.")}
          </p>
          <SkillsetForm
            mode="edit"
            initial={{
              name: skillset.name,
              description: skillset.description,
              instructions: skillset.instructions,
              kind: skillset.kind,
              tags: skillset.tags,
              members: skillset.members,
              version: skillset.version,
              exportAsPlugin: skillset.exportAsPlugin,
              memberVisibilityState: skillset.memberVisibilityState,
            }}
            onPublish={handlePublish}
            submitting={publishMutation.isPending}
            onCancel={() => navigate(`/skillsets/${skillset.name}`)}
          />
        </div>
      </div>
    </PageTransition>
  );
}
