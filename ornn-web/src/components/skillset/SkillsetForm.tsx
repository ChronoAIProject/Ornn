/**
 * SkillsetForm — the ONE create/publish form, used by both
 * `/skillsets/new` (create → POST) and `/skillsets/:id/edit` (publish → PUT).
 *
 * Composes the kind selector, tag editor, `SkillsetMemberPicker`, and
 * `MasterPromptEditor`. The two modes differ in three ways:
 *
 *   create  → name is editable + required (kebab-case); version defaults 1.0;
 *             submits via `onSubmit` with the create payload.
 *   edit    → name is LOCKED (display-only); version is auto-bumped on mount
 *             (next patch) with quick +patch/+minor/+major buttons so you rarely
 *             have to type the tag by hand. Still validated to be different from
 *             the loaded version (server also enforces proper bump).
 *
 * Validation is surfaced inline; the submit button is disabled until the form
 * is structurally valid (name present in create, ≥2 members, required prompt,
 * version present in edit).
 *
 * @module components/skillset/SkillsetForm
 */

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SkillsetMemberPicker } from "@/components/skillset/SkillsetMemberPicker";
import { MasterPromptEditor } from "@/components/skillset/MasterPromptEditor";
import { SkillsetDependencyGraph } from "@/components/skillset/SkillsetDependencyGraph";
import { parseDeps, serializeDeps, pruneEdges, type Edge } from "@/lib/skillsetDeps";
import {
  SKILLSET_KINDS,
  SKILLSET_MIN_MEMBERS,
  validateMasterPrompt,
  type CreateSkillsetInput,
  type PublishSkillsetInput,
  type SkillsetKind,
} from "@/types/skillset";

/** Kebab-case skill/skillset name. Mirrors the backend `SKILL_NAME_REGEX`. */
const NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** `<major>.<minor>` version. */
const VERSION_REGEX = /^\d+\.\d+$/;

export interface SkillsetFormInitial {
  name?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
  kind?: SkillsetKind | undefined;
  tags?: string[] | undefined;
  members?: string[] | undefined;
  version?: string | undefined;
}

export interface SkillsetFormProps {
  mode: "create" | "edit";
  initial?: SkillsetFormInitial | undefined;
  /** Submit handler — receives the mode-appropriate payload. */
  onCreate?: ((input: CreateSkillsetInput) => Promise<void>) | undefined;
  onPublish?: ((input: PublishSkillsetInput) => Promise<void>) | undefined;
  submitting?: boolean | undefined;
  onCancel?: (() => void) | undefined;
}

export function SkillsetForm({
  mode,
  initial,
  onCreate,
  onPublish,
  submitting = false,
  onCancel,
}: SkillsetFormProps) {
  const { t } = useTranslation();

  const lockedName = initial?.name ?? "";
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [kind, setKind] = useState<SkillsetKind>(initial?.kind ?? "generic");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [members, setMembersRaw] = useState<string[]>(initial?.members ?? []);
  /** Compute an auto-bumped version for edit mode so user doesn't have to manually type the next tag. */
  function bumpVersion(current: string, level: "patch" | "minor" | "major" = "patch"): string {
    const [majStr = "", minStr = ""] = current.trim().split(".");
    const major = parseInt(majStr, 10);
    const minor = parseInt(minStr, 10);
    if (isNaN(major) || isNaN(minor)) return "1.0";
    if (level === "patch") {
      return `${major}.${minor + 1}`;
    }
    return `${major + 1}.0`;
  }

  const [version, setVersion] = useState(() => {
    if (mode === "create") return "1.0";
    const cur = initial?.version?.trim() ?? "";
    return cur ? bumpVersion(cur) : "1.0";
  });
  const [submitted, setSubmitted] = useState(false);

  // Dependency edges are a PROJECTION of the single `instructions` state — the
  // master prompt carries them inside one managed block (#1064). Never a
  // parallel state copy: we re-derive on every render and re-serialize on edit.
  const { edges, promptBody } = parseDeps(instructions);

  /** Re-serialize the prompt with a new edge set, keeping the prose body. */
  function setEdges(nextEdges: Edge[]) {
    setInstructions(serializeDeps(promptBody, pruneEdges(nextEdges, members)));
  }

  /** The MasterPromptEditor edits the PROSE BODY; the managed block is
   * preserved by re-serializing the current edges around the new body. */
  function setPromptBody(nextBody: string) {
    setInstructions(serializeDeps(nextBody, edges));
  }

  /** Wrap setMembers so removing a member re-prunes its edges from the prompt.
   * `edges` / `promptBody` are the projection of the current `instructions`. */
  function setMembers(nextMembers: string[]) {
    setMembersRaw(nextMembers);
    setInstructions(serializeDeps(promptBody, pruneEdges(edges, nextMembers)));
  }

  // Validate the PROSE body, not the serialized block — the required master
  // prompt is the author's prose, the managed block is machinery.
  const promptError = validateMasterPrompt(promptBody);

  const nameValid = mode === "edit" || NAME_REGEX.test(name.trim());
  const descriptionValid = description.trim().length > 0 && description.trim().length <= 1024;
  const membersValid = members.length >= SKILLSET_MIN_MEMBERS;
  const promptValid = promptError === null;
  const versionValid =
    mode === "create"
      ? VERSION_REGEX.test(version.trim())
      : VERSION_REGEX.test(version.trim()) && version.trim() !== lockedVersion(initial);

  const canSubmit =
    nameValid && descriptionValid && membersValid && promptValid && versionValid && !submitting;

  const tagInputId = useId();

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase();
    if (!tag || tags.includes(tag) || !/^[a-z0-9-]+$/.test(tag)) return;
    setTags([...tags, tag]);
  }

  function removeTag(tag: string) {
    setTags(tags.filter((x) => x !== tag));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!canSubmit) return;
    if (mode === "create") {
      await onCreate?.({
        name: name.trim(),
        description: description.trim(),
        instructions,
        kind,
        tags,
        members,
        version: version.trim(),
      });
    } else {
      await onPublish?.({
        description: description.trim(),
        instructions,
        kind,
        tags,
        members,
        version: version.trim(),
      });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Identity + metadata — a compact 2-col grid so the editor surfaces below
          (members, dependency graph, master prompt) get the vertical room.
          Name + version share the top row; description spans full width; kind +
          tags share the bottom row. */}
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-2">
        {/* Name — editable on create, locked on edit. */}
        {mode === "create" ? (
          <Input
            label={t("skillsetForm.name", "Name") as string}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="research-bundle"
            error={
              submitted && !nameValid
                ? (t("skillsetForm.nameError", "Name must be kebab-case (a-z, 0-9, hyphens).") as string)
                : undefined
            }
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta">
              {t("skillsetForm.name", "Name")}
            </span>
            <div className="rounded-sm border border-subtle bg-elevated/40 px-3 py-2 font-mono text-sm text-meta">
              {lockedName}
              <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-meta">
                ({t("skillsetForm.nameLocked", "locked")})
              </span>
            </div>
          </div>
        )}

        {/* Version — defaulted 1.0 on create; in edit we auto-bump to the next patch on mount
            and provide quick +patch / +minor / +major buttons so you don't have to type tags manually. */}
        {mode === "edit" ? (
          <div className="flex flex-col gap-1.5">
            <Input
              label={t("skillsetForm.version", "Version") as string}
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.1"
              error={
                submitted && !versionValid
                  ? (t("skillsetForm.versionBumpError", "Publish requires a new, bumped version (e.g. 1.1).") as string)
                  : undefined
              }
            />
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-meta">
                from {initial?.version ?? "?"}
              </span>
              {(["patch", "minor", "major"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setVersion(bumpVersion(version, level))}
                  className="rounded-sm border border-subtle px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-meta hover:border-accent hover:text-strong focus:outline-none"
                  title={`Bump ${level} from current field value`}
                >
                  +{level}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <Input
            label={t("skillsetForm.version", "Version") as string}
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.0"
            error={
              submitted && !versionValid
                ? (t("skillsetForm.versionError", "Version must be <major>.<minor> (e.g. 1.0).") as string)
                : undefined
            }
          />
        )}

        {/* Description — full width. */}
        <div className="sm:col-span-2">
          <Input
            label={t("skillsetForm.description", "Description") as string}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("skillsetForm.descriptionPlaceholder", "A short, human-readable summary") as string}
            error={
              submitted && !descriptionValid
                ? (t("skillsetForm.descriptionError", "Description is required (1–1024 chars).") as string)
                : undefined
            }
          />
        </div>

        {/* Kind. */}
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta">
            {t("skillsetForm.kind", "Kind")}
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as SkillsetKind)}
            className="rounded-sm border border-subtle bg-elevated/40 px-3 py-2 font-text text-sm text-strong focus:border-accent focus:outline-none cursor-pointer"
          >
            {SKILLSET_KINDS.map((k) => (
              <option key={k} value={k}>
                {k === "consensus-supported"
                  ? t("skillsetKind.consensusSupportedLong", "Consensus-supported")
                  : t("skillsetKind.genericLong", "Generic bundle")}
              </option>
            ))}
          </select>
        </div>

        {/* Tags. */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={tagInputId}
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta"
          >
            {t("skillsetForm.tags", "Tags")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => removeTag(tag)}
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/60 bg-accent/15 px-2.5 py-1 font-text text-xs text-accent cursor-pointer"
              >
                <span className="max-w-[140px] truncate">{tag}</span>
                <span aria-hidden>×</span>
              </button>
            ))}
            <input
              id={tagInputId}
              type="text"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).value = "";
                }
              }}
              placeholder={t("skillsetForm.addTag", "add tag…") as string}
              className="w-28 rounded-sm border border-subtle bg-elevated/40 px-2 py-1.5 font-text text-xs text-strong placeholder:text-meta/70 focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Members. */}
      <SkillsetMemberPicker
        members={members}
        onChange={setMembers}
        selfName={mode === "edit" ? lockedName : undefined}
        error={
          submitted && !membersValid
            ? (t("skillsetForm.membersError", "Add at least {{min}} members.", {
                min: SKILLSET_MIN_MEMBERS,
              }) as string)
            : undefined
        }
      />

      {/* Dependency graph (#1064) — edges live inside the master prompt; this
          editor never mutates a member skill. */}
      <SkillsetDependencyGraph
        members={members}
        edges={edges}
        onEdgesChange={setEdges}
      />

      {/* Master prompt — edits the PROSE BODY; the managed deps block round-trips
          through the codec untouched. */}
      <MasterPromptEditor
        value={promptBody}
        onChange={setPromptBody}
        error={
          submitted && !promptValid
            ? (t("skillsetForm.promptError", "A master prompt is required.") as string)
            : undefined
        }
      />

      {mode === "edit" && (
        <p className="font-text text-xs text-meta">
          {t("skillsetForm.editHint", "Publishing creates a new immutable version. The name cannot change.")}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-subtle pt-4">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
        <Button type="submit" disabled={!canSubmit} loading={submitting}>
          {mode === "create"
            ? t("skillsetForm.createSubmit", "Create skillset")
            : t("skillsetForm.publishSubmit", "Publish version")}
        </Button>
      </div>
    </form>
  );
}

/** The version the form loaded with — edit must publish a DIFFERENT one. */
function lockedVersion(initial: SkillsetFormInitial | undefined): string {
  return initial?.version ?? "";
}
