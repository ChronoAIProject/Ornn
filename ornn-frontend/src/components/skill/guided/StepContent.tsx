/**
 * Guided Wizard Step 2: Skill Content.
 * Markdown editor for the SKILL.md body.
 * @module components/skill/guided/StepContent
 */

import { Controller, type UseFormReturn } from "react-hook-form";
import { motion } from "framer-motion";
import { MarkdownEditor } from "@/components/form/MarkdownEditor";
import type { ContentData } from "@/utils/skillCreateSchemas";

export interface StepContentProps {
  form: UseFormReturn<ContentData>;
}

export function StepContent({ form }: StepContentProps) {
  return (
    <motion.div
      key="content"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <h2 className="font-heading text-lg text-neon-cyan mb-6">
        Skill Content
      </h2>
      <p className="font-body text-sm text-text-muted mb-4">
        Write the body content for your SKILL.md. This will appear
        below the auto-generated YAML frontmatter.
      </p>

      <Controller
        name="readmeMd"
        control={form.control}
        render={({ field }) => (
          <MarkdownEditor
            label="SKILL.md Body"
            value={field.value}
            onChange={field.onChange}
            placeholder="# My Skill&#10;&#10;Describe what this skill does, how to use it, and provide examples..."
            error={form.formState.errors.readmeMd?.message}
            minRows={15}
          />
        )}
      />
    </motion.div>
  );
}
