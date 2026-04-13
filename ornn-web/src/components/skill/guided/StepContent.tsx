/**
 * Guided Wizard Step 2: Skill Content.
 * Markdown editor for the SKILL.md body.
 * @module components/skill/guided/StepContent
 */

import { Controller, type UseFormReturn } from "react-hook-form";
import { motion } from "framer-motion";
import { MarkdownEditor } from "@/components/form/MarkdownEditor";
import type { ContentData } from "@/utils/skillCreateSchemas";
import { useTranslation } from "react-i18next";

export interface StepContentProps {
  form: UseFormReturn<ContentData>;
}

export function StepContent({ form }: StepContentProps) {
  const { t } = useTranslation();
  return (
    <motion.div
      key="content"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <h2 className="font-heading text-lg text-neon-cyan mb-6">
        {t("guided.contentTitle")}
      </h2>
      <p className="font-body text-sm text-text-muted mb-4">
        {t("guided.contentDesc")}
      </p>

      <Controller
        name="readmeMd"
        control={form.control}
        render={({ field }) => (
          <MarkdownEditor
            label={t("guided.contentLabel")}
            value={field.value}
            onChange={field.onChange}
            placeholder={t("guided.contentPlaceholder")}
            error={form.formState.errors.readmeMd?.message}
            minRows={15}
          />
        )}
      />
    </motion.div>
  );
}
