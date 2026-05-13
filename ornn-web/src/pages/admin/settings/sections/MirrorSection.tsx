/**
 * MirrorSection — admin GitHub mirror controls (settings-doc-backed).
 *
 * The legacy /admin/mirror page ships a deep mirror UI (#262) that
 * remains the operational source of truth for run/inspect controls. The
 * settings doc now stores the *configuration* — repo coords, GitHub App
 * credentials — so flipping config no longer needs a redeploy.
 *
 * For Round 1 we render the configuration surface here and link to the
 * legacy mirror dashboard for runs/repo status. The legacy `/admin/mirror`
 * route 30x-redirects to `/admin/settings/mirror` so existing deep-links
 * keep working; the dashboard surface is reachable from the Skills page.
 *
 * @module pages/admin/settings/sections/MirrorSection
 */

import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CronExpressionParser } from "cron-parser";
import { SectionShell } from "@/components/admin/settings/SectionShell";
import { UnsavedChangesGuard } from "@/components/admin/settings/UnsavedChangesGuard";
import { useSectionForm } from "@/components/admin/settings/useSectionForm";
import {
  fetchSection,
  isSecretPreserveValue,
  putSection,
  type MirrorSection as MS,
} from "@/services/settingsApi";

/**
 * Validates a cron string client-side via `cron-parser`. Empty string
 * (= "Disabled") is allowed. The same predicate is also enforced
 * server-side at settings-write time.
 */
function isValidCron(s: string): boolean {
  if (s.length === 0) return true;
  try {
    CronExpressionParser.parse(s);
    return true;
  } catch {
    return false;
  }
}

const Schema = z.object({
  enabled: z.boolean(),
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1),
  appId: z.string().min(1),
  installationId: z.string().min(1),
  appPrivateKey: z.string().min(1),
  reconcileSchedule: z.string().refine(isValidCron, "invalid cron"),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
}) satisfies z.ZodType<MS>;

/** Preset cron expressions surfaced in the dropdown. */
const SCHEDULE_PRESETS = [
  { value: "", labelKey: "adminSettings.sections.mirror.schedule.preset.disabled" },
  { value: "0 2 * * *", labelKey: "adminSettings.sections.mirror.schedule.preset.daily2am" },
  { value: "0 */6 * * *", labelKey: "adminSettings.sections.mirror.schedule.preset.every6h" },
  { value: "0 */12 * * *", labelKey: "adminSettings.sections.mirror.schedule.preset.every12h" },
  { value: "0 * * * *", labelKey: "adminSettings.sections.mirror.schedule.preset.hourly" },
] as const;

const PRESET_VALUES = new Set(SCHEDULE_PRESETS.map((p) => p.value));

export function MirrorSection() {
  const { t } = useTranslation();
  const form = useSectionForm<MS>({
    queryKey: ["admin", "settings", "mirror"] as const,
    fetcher: () => fetchSection<MS>("mirror"),
    saver: (input) => putSection<MS>("mirror", input),
    schema: Schema,
    successMessage: t("adminSettings.sections.mirror.savedToast"),
  });

  const draft = form.draft;
  const secretIsSentinel = draft
    ? isSecretPreserveValue(draft.appPrivateKey)
    : false;

  return (
    <>
      <UnsavedChangesGuard when={form.isDirty} />
      <SectionShell
        title={t("adminSettings.sections.mirror.title")}
        description={t("adminSettings.sections.mirror.description")}
        isLoading={form.isLoading}
        isSaving={form.isSaving}
        isDirty={form.isDirty}
        error={form.error}
        onSave={form.save}
        onReset={form.reset}
        updatedAt={form.serverValue?.updatedAt}
        updatedBy={form.serverValue?.updatedBy}
      >
        {draft && (
          <div className="space-y-4">
            <Toggle
              label={t("adminSettings.sections.mirror.label.enabled")}
              value={draft.enabled}
              onChange={(v) => form.patchDraft({ enabled: v })}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field
                label={t("adminSettings.sections.mirror.label.owner")}
                value={draft.owner}
                onChange={(v) => form.patchDraft({ owner: v })}
              />
              <Field
                label={t("adminSettings.sections.mirror.label.repo")}
                value={draft.repo}
                onChange={(v) => form.patchDraft({ repo: v })}
              />
              <Field
                label={t("adminSettings.sections.mirror.label.branch")}
                value={draft.branch}
                onChange={(v) => form.patchDraft({ branch: v })}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label={t("adminSettings.sections.mirror.label.appId")}
                value={draft.appId}
                onChange={(v) => form.patchDraft({ appId: v })}
              />
              <Field
                label={t("adminSettings.sections.mirror.label.installationId")}
                value={draft.installationId}
                onChange={(v) => form.patchDraft({ installationId: v })}
              />
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                {t("adminSettings.sections.mirror.label.privateKey")}
              </span>
              <textarea
                value={draft.appPrivateKey}
                onChange={(e) =>
                  form.patchDraft({ appPrivateKey: e.target.value })
                }
                rows={8}
                spellCheck={false}
                className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-[11px] text-strong focus:border-accent focus:outline-none"
              />
              <span className="font-mono text-[10px] text-meta">
                {secretIsSentinel
                  ? t("adminSettings.secretSentinelHint")
                  : t("adminSettings.secretReplaceHint")}
              </span>
            </label>

            <ScheduleField
              value={draft.reconcileSchedule}
              onChange={(v) => form.patchDraft({ reconcileSchedule: v })}
            />

            <Link
              to="/admin/skills"
              className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-accent hover:text-accent-muted"
            >
              {t("adminSettings.sections.mirror.openDashboard")}
            </Link>
          </div>
        )}
      </SectionShell>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
      />
    </label>
  );
}

/**
 * Schedule control — preset dropdown + optional custom cron input.
 *
 * State machine:
 *   • Value matches a preset → dropdown shows preset, custom input hidden.
 *   • Value is "" → dropdown shows "Disabled", input hidden.
 *   • Otherwise → dropdown shows "Custom…", custom input visible + validates.
 *
 * Switching to "Custom…" seeds the input with the current value (or a
 * sensible default if empty) so the user starts from somewhere.
 */
function ScheduleField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const isPreset = PRESET_VALUES.has(value as (typeof SCHEDULE_PRESETS)[number]["value"]);
  const dropdownValue = isPreset ? value : "__custom__";
  const showCustomInput = !isPreset;
  const cronValid = isValidCron(value);
  const isDisabled = value === "";

  const nextRunLabel = (() => {
    if (isDisabled || !cronValid) return null;
    try {
      const iter = CronExpressionParser.parse(value, { tz: "Asia/Singapore" });
      const next = iter.next().toDate();
      const formatted = next.toLocaleString(i18n.language || "en", {
        timeZone: "Asia/Singapore",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      return t("adminSettings.sections.mirror.schedule.nextRun", { at: `${formatted} SGT` });
    } catch {
      return t("adminSettings.sections.mirror.schedule.nextRunUnavailable");
    }
  })();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        {t("adminSettings.sections.mirror.label.schedule")}
      </span>
      <select
        value={dropdownValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__custom__") {
            // Seed custom input with current value if it's already
            // non-preset, else a sensible starting point.
            onChange(value && !PRESET_VALUES.has(value as never) ? value : "*/30 * * * *");
          } else {
            onChange(v);
          }
        }}
        className="rounded-sm border border-subtle bg-card px-3 py-2 font-mono text-sm text-strong focus:border-accent focus:outline-none"
      >
        {SCHEDULE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {t(p.labelKey)}
          </option>
        ))}
        <option value="__custom__">
          {t("adminSettings.sections.mirror.schedule.preset.custom")}
        </option>
      </select>
      {showCustomInput && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          placeholder="*/30 * * * *"
          aria-invalid={!cronValid}
          className={`rounded-sm border bg-card px-3 py-2 font-mono text-sm text-strong focus:outline-none ${
            cronValid
              ? "border-subtle focus:border-accent"
              : "border-[var(--color-danger,#c33)] focus:border-[var(--color-danger,#c33)]"
          }`}
        />
      )}
      <span className="font-mono text-[10px] text-meta">
        {t("adminSettings.sections.mirror.schedule.tzNote")}
      </span>
      {showCustomInput && (
        <span className="font-mono text-[10px] text-meta">
          {cronValid
            ? t("adminSettings.sections.mirror.schedule.customHint")
            : t("adminSettings.sections.mirror.schedule.invalidHint")}
        </span>
      )}
      {isDisabled && (
        <span className="font-mono text-[10px] text-meta">
          {t("adminSettings.sections.mirror.schedule.disabledHint")}
        </span>
      )}
      {nextRunLabel && (
        <span className="font-mono text-[10px] text-meta">{nextRunLabel}</span>
      )}
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-3">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-[var(--color-accent-primary)]"
      />
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-strong">
        {label}
      </span>
    </label>
  );
}
