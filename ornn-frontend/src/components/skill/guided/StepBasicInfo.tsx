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
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <motion.div
      key="basic"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <h2 className="font-heading text-lg text-neon-cyan mb-6">
        Basic Information
      </h2>
      <form className="space-y-6">
        {/* Name */}
        <Input
          label="Skill Name"
          placeholder="my-awesome-skill"
          error={form.formState.errors.name?.message}
          {...form.register("name")}
        />

        {/* Description */}
        <Input
          label="Description"
          placeholder="A brief description of what this skill does (min 10 chars)"
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
                  label="Category"
                  options={categoryOptions}
                  placeholder="Select category"
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
                label="Output Type"
                options={OUTPUT_TYPES.map((t) => ({
                  value: t,
                  label: t === "text" ? "Text (stdout)" : "File (artifact)",
                }))}
                placeholder="Select output type"
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
                label="Runtime Dependencies (optional)"
                values={field.value}
                onChange={field.onChange}
                placeholder="npm package name + Enter"
                helperText="npm packages required by runtime scripts (e.g., axios, lodash)"
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
                label="Environment Variables (optional)"
                values={field.value}
                onChange={field.onChange}
                placeholder="ENV_VAR_NAME + Enter"
                helperText="Must be UPPER_SNAKE_CASE (e.g., API_KEY, SECRET_TOKEN)"
                badgeColor="yellow"
                validate={(v) =>
                  /^[A-Z_][A-Z0-9_]*$/.test(v)
                    ? null
                    : "Must be UPPER_SNAKE_CASE"
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
          label="License (optional)"
          placeholder="MIT, Apache-2.0, etc."
          {...form.register("license")}
        />

        {/* Compatibility */}
        <Input
          label="Compatibility (optional)"
          placeholder="claude-code >= 1.0"
          error={form.formState.errors.compatibility?.message}
          {...form.register("compatibility")}
        />

        {/* Advanced Settings (Claude fields) */}
        <div className="border-t border-neon-cyan/10 pt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="flex w-full items-center justify-between py-2 text-left cursor-pointer group"
          >
            <span className="font-heading text-xs uppercase tracking-wider text-text-muted group-hover:text-neon-cyan transition-colors">
              Advanced Settings (Claude)
            </span>
            <ChevronIcon
              expanded={showAdvanced}
              className="h-4 w-4 text-text-muted group-hover:text-neon-cyan"
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
                          className="h-4 w-4 rounded border-text-muted/30 bg-bg-deep text-neon-cyan accent-neon-cyan cursor-pointer"
                        />
                        <div>
                          <span className="font-body text-sm text-text-primary group-hover:text-neon-cyan transition-colors">
                            Disable Model Invocation
                          </span>
                          <p className="font-body text-xs text-text-muted mt-0.5">
                            Prevent the AI from invoking this skill as a
                            sub-model call
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
                          className="h-4 w-4 rounded border-text-muted/30 bg-bg-deep text-neon-cyan accent-neon-cyan cursor-pointer"
                        />
                        <div>
                          <span className="font-body text-sm text-text-primary group-hover:text-neon-cyan transition-colors">
                            User Invocable
                          </span>
                          <p className="font-body text-xs text-text-muted mt-0.5">
                            Allow users to directly invoke this skill
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
                        label="Allowed Tools"
                        values={field.value}
                        onChange={field.onChange}
                        placeholder="Tool name + Enter"
                        helperText="Tools this skill is allowed to use (Claude spec)"
                        badgeColor="cyan"
                      />
                    )}
                  />

                  {/* Model */}
                  <Input
                    label="Model"
                    placeholder="claude-sonnet-4-20250514"
                    {...form.register("model")}
                  />

                  {/* Context Paths */}
                  <Controller
                    name="context"
                    control={form.control}
                    render={({ field }) => (
                      <MultiValueInput
                        label="Context Paths"
                        values={field.value}
                        onChange={field.onChange}
                        placeholder="./path/to/file + Enter"
                        helperText="File paths to include as context for the skill"
                        badgeColor="green"
                      />
                    )}
                  />

                  {/* Agent */}
                  <Input
                    label="Agent"
                    placeholder="agent-identifier"
                    {...form.register("agent")}
                  />

                  {/* Argument Hint */}
                  <Input
                    label="Argument Hint"
                    placeholder="Provide a file path or URL"
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
