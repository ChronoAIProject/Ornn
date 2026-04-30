/**
 * Guided Wizard Step 1: Basic Information.
 * Collects name, description, category (nested under metadata), conditional
 * tools/runtimes/dependencies/env vars, tags, license, compatibility,
 * and optional advanced Claude fields.
 * @module components/skill/guided/StepBasicInfo
 */

import { useState } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { CategoryTooltip } from "@/components/ui/CategoryTooltip";
import { TagInput } from "@/components/form/TagInput";
import { ToolsInput } from "@/components/form/ToolsInput";
import { RuntimeSelect } from "@/components/form/RuntimeSelect";
import { MultiValueInput } from "@/components/form/MultiValueInput";
import { SKILL_CATEGORY_INFO } from "@/utils/constants";
import { OUTPUT_TYPES } from "@/utils/skillFrontmatterSchema";
import type { BasicInfoData } from "@/utils/skillCreateSchemas";
import { useTranslation } from "react-i18next";

export interface StepBasicInfoProps {
  form: UseFormReturn<BasicInfoData>;
  showTools: boolean;
  showRuntimes: boolean;
}

const categoryOptions = Object.entries(SKILL_CATEGORY_INFO).map(
  ([value, info]) => ({
    value,
    label: info.label,
  }),
);

/** Chevron icon for the advanced section toggle */
function ChevronIcon({
  expanded,
  className,
}: {
  expanded: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`${className} transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 9l-7 7-7-7"
      />
    </svg>
  );
}

export function StepBasicInfo({
  form,
  showTools,
  showRuntimes,
}: StepBasicInfoProps) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <motion.div
      key="basic"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <h2 className="font-display text-lg text-accent mb-6">
        {t("guided.basicTitle")}
      </h2>
      <form className="space-y-6">
        {/* Name */}
        <Input
          label={t("guided.skillName")}
          placeholder={t("guided.skillNamePlaceholder")}
          error={form.formState.errors.name?.message}
          {...form.register("name")}
        />

        {/* Description */}
        <Input
          label={t("guided.descLabel")}
          placeholder={t("guided.descPlaceholder")}
          error={form.formState.errors.description?.message}
          {...form.register("description")}
        />

        {/* Category (nested under metadata) */}
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <Controller
              name="metadata.category"
              control={form.control}
              render={({ field }) => (
                <Select
                  label={t("guided.categoryLabel")}
                  options={categoryOptions}
                  placeholder={t("guided.selectCategory")}
                  error={
                    form.formState.errors.metadata?.category?.message
                  }
                  {...field}
                />
              )}
            />
          </div>
          <div className="mt-6">
            <CategoryTooltip />
          </div>
        </div>

        {/* Conditional: Output Type (runtime-based or mixed) */}
        {showRuntimes && (
          <Controller
            name="metadata.outputType"
            control={form.control}
            render={({ field }) => (
              <Select
                label={t("guided.outputType")}
                options={OUTPUT_TYPES.map((ot) => ({
                  value: ot,
                  label: ot === "text" ? t("guided.textStdout") : t("guided.fileArtifact"),
                }))}
                placeholder={t("guided.selectOutputType")}
                error={
                  form.formState.errors.metadata?.outputType?.message
                }
                {...field}
                value={field.value ?? ""}
              />
            )}
          />
        )}

        {/* Conditional: Tools (tool-based or mixed) */}
        {showTools && (
          <Controller
            name="metadata.toolList"
            control={form.control}
            render={({ field }) => (
              <ToolsInput
                tools={field.value}
                onChange={field.onChange}
                error={
                  form.formState.errors.metadata?.toolList?.message
                }
              />
            )}
          />
        )}

        {/* Conditional: Runtimes (runtime-based or mixed) */}
        {showRuntimes && (
          <Controller
            name="metadata.runtime"
            control={form.control}
            render={({ field }) => (
              <RuntimeSelect
                selected={field.value}
                onChange={field.onChange}
                error={
                  form.formState.errors.metadata?.runtime?.message
                }
              />
            )}
          />
        )}

        {/* Conditional: Runtime Dependencies (runtime-based or mixed, optional) */}
        {showRuntimes && (
          <Controller
            name="metadata.runtimeDependency"
            control={form.control}
            render={({ field }) => (
              <MultiValueInput
                label={t("guided.runtimeDeps")}
                values={field.value}
                onChange={field.onChange}
                placeholder={t("guided.runtimeDepsPlaceholder")}
                helperText={t("guided.runtimeDepsHelper")}
                badgeColor="magenta"
              />
            )}
          />
        )}

        {/* Conditional: Runtime Env Vars (runtime-based or mixed, optional) */}
        {showRuntimes && (
          <Controller
            name="metadata.runtimeEnvVar"
            control={form.control}
            render={({ field }) => (
              <MultiValueInput
                label={t("guided.envVars")}
                values={field.value}
                onChange={field.onChange}
                placeholder={t("guided.envVarsPlaceholder")}
                helperText={t("guided.envVarsHelper")}
                badgeColor="yellow"
                validate={(v) =>
                  /^[A-Z_][A-Z0-9_]*$/.test(v)
                    ? null
                    : t("guided.envVarsValidation")
                }
              />
            )}
          />
        )}

        {/* Tags (nested under metadata) */}
        <Controller
          name="metadata.tag"
          control={form.control}
          render={({ field }) => (
            <TagInput
              tags={field.value}
              onChange={field.onChange}
              error={form.formState.errors.metadata?.tag?.message}
            />
          )}
        />

        {/* License */}
        <Input
          label={t("guided.license")}
          placeholder={t("guided.licensePlaceholder")}
          {...form.register("license")}
        />

        {/* Compatibility */}
        <Input
          label={t("guided.compatibilityLabel")}
          placeholder={t("guided.compatibilityPlaceholder")}
          error={form.formState.errors.compatibility?.message}
          {...form.register("compatibility")}
        />

        {/* Advanced Settings (Claude fields) */}
        <div className="border-t border-accent/10 pt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="flex w-full items-center justify-between py-2 text-left cursor-pointer group"
          >
            <span className="font-display text-xs uppercase tracking-wider text-meta group-hover:text-accent transition-colors">
              {t("guided.advancedSettings")}
            </span>
            <ChevronIcon
              expanded={showAdvanced}
              className="h-4 w-4 text-meta group-hover:text-accent"
            />
          </button>

          <AnimatePresence>
            {showAdvanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="space-y-4 pt-4">
                  {/* Disable Model Invocation */}
                  <Controller
                    name="disableModelInvocation"
                    control={form.control}
                    render={({ field }) => (
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={field.value}
                          onChange={field.onChange}
                          className="h-4 w-4 rounded border-text-muted/30 bg-page text-accent accent-accent cursor-pointer"
                        />
                        <div>
                          <span className="font-text text-sm text-strong group-hover:text-accent transition-colors">
                            {t("guided.disableModelInvocation")}
                          </span>
                          <p className="font-text text-xs text-meta mt-0.5">
                            {t("guided.disableModelInvocationDesc")}
                          </p>
                        </div>
                      </label>
                    )}
                  />

                  {/* User Invocable */}
                  <Controller
                    name="userInvocable"
                    control={form.control}
                    render={({ field }) => (
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={field.value}
                          onChange={field.onChange}
                          className="h-4 w-4 rounded border-text-muted/30 bg-page text-accent accent-accent cursor-pointer"
                        />
                        <div>
                          <span className="font-text text-sm text-strong group-hover:text-accent transition-colors">
                            {t("guided.userInvocable")}
                          </span>
                          <p className="font-text text-xs text-meta mt-0.5">
                            {t("guided.userInvocableDesc")}
                          </p>
                        </div>
                      </label>
                    )}
                  />

                  {/* Allowed Tools */}
                  <Controller
                    name="allowedTools"
                    control={form.control}
                    render={({ field }) => (
                      <MultiValueInput
                        label={t("guided.allowedTools")}
                        values={field.value}
                        onChange={field.onChange}
                        placeholder={t("guided.allowedToolsPlaceholder")}
                        helperText={t("guided.allowedToolsHelper")}
                        badgeColor="cyan"
                      />
                    )}
                  />

                  {/* Model */}
                  <Input
                    label={t("guided.modelLabel")}
                    placeholder={t("guided.modelPlaceholder")}
                    {...form.register("model")}
                  />

                  {/* Context Paths */}
                  <Controller
                    name="context"
                    control={form.control}
                    render={({ field }) => (
                      <MultiValueInput
                        label={t("guided.contextPaths")}
                        values={field.value}
                        onChange={field.onChange}
                        placeholder={t("guided.contextPathsPlaceholder")}
                        helperText={t("guided.contextPathsHelper")}
                        badgeColor="green"
                      />
                    )}
                  />

                  {/* Agent */}
                  <Input
                    label={t("guided.agentLabel")}
                    placeholder={t("guided.agentPlaceholder")}
                    {...form.register("agent")}
                  />

                  {/* Argument Hint */}
                  <Input
                    label={t("guided.argumentHint")}
                    placeholder={t("guided.argumentHintPlaceholder")}
                    {...form.register("argumentHint")}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </form>
    </motion.div>
  );
}
