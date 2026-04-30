/**
 * /admin/settings — edit platform-wide configuration.
 *
 * Minimal for now: the audit-waiver threshold. Any audit overall score
 * at or above this is treated as "safe" by the audit-gated permissions
 * flow and auto-applies the grant; below it the grant creates a waiver
 * request that needs owner justification + reviewer decision.
 *
 * @module pages/admin/PlatformSettingsPage
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { usePlatformSettings, useUpdatePlatformSettings } from "@/hooks/usePlatformSettings";
import { useToastStore } from "@/stores/toastStore";

export function PlatformSettingsPage() {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: settings, isLoading, isError } = usePlatformSettings();
  const update = useUpdatePlatformSettings();

  const [threshold, setThreshold] = useState<string>("");

  useEffect(() => {
    if (settings) setThreshold(String(settings.auditWaiverThreshold));
  }, [settings]);

  const parsed = Number(threshold);
  const valid =
    threshold !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= 10;
  const dirty =
    settings !== undefined && valid && parsed !== settings.auditWaiverThreshold;

  const handleSave = async () => {
    if (!valid) return;
    try {
      await update.mutateAsync({ auditWaiverThreshold: parsed });
      addToast({
        type: "success",
        message: t("platformSettings.saved", "Platform settings saved."),
      });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <PageTransition>
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <header className="mb-6">
          <h1 className="font-heading text-3xl text-strong">
            {t("platformSettings.title", "Platform settings")}
          </h1>
          <p className="mt-1 font-body text-sm text-meta">
            {t(
              "platformSettings.subtitle",
              "Platform-wide knobs that affect every owner and reviewer. Changes take effect on the next audit run.",
            )}
          </p>
        </header>

        {isLoading ? (
          <p className="py-16 text-center font-body text-sm text-meta">
            {t("platformSettings.loading", "Loading…")}
          </p>
        ) : isError ? (
          <p className="py-16 text-center font-body text-sm text-danger">
            {t("platformSettings.loadFailed", "Could not load platform settings.")}
          </p>
        ) : (
          <Card className="space-y-6 p-6">
            <section className="space-y-2">
              <label
                htmlFor="auditWaiverThreshold"
                className="block font-mono text-[10px] uppercase tracking-[0.14em] text-meta"
              >
                {t("platformSettings.auditThresholdLabel", "Audit waiver threshold")}
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="auditWaiverThreshold"
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className="w-28 rounded-lg border border-accent/20 bg-card px-3 py-2 font-mono text-sm text-strong focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/30"
                />
                <span className="font-mono text-sm text-meta">/ 10</span>
              </div>
              <p className="font-body text-xs text-meta">
                {t(
                  "platformSettings.auditThresholdHint",
                  "Audit overall score at or above this cutoff auto-grants a new share. Below it, the grant becomes a waiver request that the owner must justify and a reviewer must approve.",
                )}
              </p>
              {!valid && threshold !== "" && (
                <p className="font-body text-xs text-danger">
                  {t(
                    "platformSettings.auditThresholdInvalid",
                    "Must be a number between 0 and 10.",
                  )}
                </p>
              )}
            </section>

            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                disabled={!dirty || !valid}
                loading={update.isPending}
              >
                {t("common.save", "Save")}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </PageTransition>
  );
}
