/**
 * Skill Form Component.
 * Used primarily by EditSkillPage for updating skill metadata.
 * Uses a local schema to maintain backward compatibility with the edit flow.
 * @module components/form/SkillForm
 */

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { TagInput } from "./TagInput";
import { SKILL_CATEGORIES, SKILL_CATEGORY_INFO } from "@/utils/constants";
import { OUTPUT_TYPES } from "@/utils/skillFrontmatterSchema";

/**
 * Local schema for the SkillForm that supports both create and edit modes.
 * Keeps authorName, repoUrl, version for backward compat with EditSkillPage.
 */
const skillFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().min(1, "Description is required").max(1000),
  authorName: z.string().optional(),
  category: z.string().min(1, "Category is required").max(50),
  outputType: z.enum(OUTPUT_TYPES).optional(),
  tags: z.array(z.string().max(30)).max(10).default([]),
  license: z.string().max(50).optional(),
  repoUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  version: z.string().optional(),
  readmeMd: z.string().max(50000).optional(),
});

type SkillFormData = z.infer<typeof skillFormSchema>;

export interface SkillFormProps {
  /** "create" shows all fields; "edit" hides name, version, file */
  mode: "create" | "edit";
  defaultValues?: Partial<SkillFormData>;
  onSubmit: (data: SkillFormData, file?: File) => void;
  isSubmitting?: boolean;
  className?: string;
}

const categoryOptions = SKILL_CATEGORIES.map((c) => ({
  value: c,
  label: SKILL_CATEGORY_INFO[c].label,
}));

export function SkillForm({
  mode,
  defaultValues,
  onSubmit,
  isSubmitting = false,
  className = "",
}: SkillFormProps) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<SkillFormData>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: {
      name: "",
      description: "",
      authorName: "",
      category: "",
      outputType: undefined,
      tags: [],
      license: "",
      repoUrl: "",
      version: "1",
      readmeMd: "",
      ...defaultValues,
    },
  });

  const watchedCategory = watch("category");
  const showOutputType = watchedCategory === "runtime-based" || watchedCategory === "mixed";

  const handleFormSubmit = (data: SkillFormData) => {
    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className={`space-y-6 ${className}`}>
      {mode === "create" && (
        <Input
          label="Name"
          placeholder="my-skill-name"
          error={errors.name?.message}
          {...register("name")}
        />
      )}

      <Input
        label="Description"
        placeholder="What does this skill do?"
        error={errors.description?.message}
        {...register("description")}
      />

      <Controller
        name="category"
        control={control}
        render={({ field }) => (
          <Select
            label="Category"
            options={categoryOptions}
            placeholder="Select category"
            error={errors.category?.message}
            {...field}
          />
        )}
      />

      {showOutputType && (
        <Controller
          name="outputType"
          control={control}
          render={({ field }) => (
            <Select
              label="Output Type"
              options={OUTPUT_TYPES.map((t) => ({
                value: t,
                label: t === "text" ? "Text (stdout)" : "File (artifact)",
              }))}
              placeholder="Select output type"
              error={errors.outputType?.message}
              {...field}
              value={field.value ?? ""}
            />
          )}
        />
      )}

      <Controller
        name="tags"
        control={control}
        render={({ field }) => (
          <TagInput
            tags={field.value}
            onChange={field.onChange}
            error={errors.tags?.message}
          />
        )}
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <Input
          label="License"
          placeholder="MIT, Apache-2.0, etc."
          error={errors.license?.message}
          {...register("license")}
        />
        <Input
          label="Repository URL"
          placeholder="https://github.com/..."
          error={errors.repoUrl?.message}
          {...register("repoUrl")}
        />
      </div>

      <Button type="submit" loading={isSubmitting} className="w-full">
        {mode === "create" ? "Upload Skill" : "Save Changes"}
      </Button>
    </form>
  );
}
