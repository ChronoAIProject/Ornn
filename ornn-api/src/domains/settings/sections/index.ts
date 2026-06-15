/**
 * Section registry for the settings umbrella.
 *
 * Each section owns a per-section Zod schema, a stable `id` (used as the
 * Mongo `_id` of its row in `platform_settings`), and a list of secret
 * field names. The export pipeline replaces those fields with redaction
 * sentinels; the import pipeline reverses the swap when it sees one.
 *
 * @module domains/settings/sections
 */

import { assistantSection, type AssistantSection } from "./assistant";
import { mirrorSection, type MirrorSection } from "./mirror";
import { nyxidSection, type NyxidSection } from "./nyxid";
import { playgroundSection, type PlaygroundSection } from "./playground";
import { skillAuditSection, type SkillAuditSection } from "./skillAudit";
import { skillGenSection, type SkillGenSection } from "./skillGen";
import { telemetrySection, type TelemetrySection } from "./telemetry";
import { extrasSection, type ExtrasSection } from "./extras";
import { launchPromoSection, type LaunchPromoSection } from "./launchPromo";

export {
  assistantSection,
  mirrorSection,
  nyxidSection,
  playgroundSection,
  skillAuditSection,
  skillGenSection,
  telemetrySection,
  extrasSection,
  launchPromoSection,
};

export type {
  AssistantSection,
  MirrorSection,
  NyxidSection,
  PlaygroundSection,
  SkillAuditSection,
  SkillGenSection,
  TelemetrySection,
  ExtrasSection,
  LaunchPromoSection,
};

export type SectionId =
  | "playground"
  | "skillGen"
  | "assistant"
  | "mirror"
  | "nyxid"
  | "skillAudit"
  | "telemetry"
  | "extras"
  | "launchPromo";

export interface SectionMeta<T> {
  /** Stable section id, also the Mongo `_id` of the section row. */
  readonly id: SectionId;
  /** Public name used in API URLs (e.g. `playground`, `integrations/nyxid`). */
  readonly publicPath: string;
  /** Zod schema validating the section's payload (without `updatedAt`/`updatedBy`). */
  readonly schema: import("zod").ZodType<T>;
  /** Names of secret fields that need encryption + redaction on export. */
  readonly secretFields: ReadonlyArray<string>;
  /** Default value used when no row exists yet. */
  readonly defaults: T;
}

export const sections = {
  playground: playgroundSection,
  skillGen: skillGenSection,
  assistant: assistantSection,
  mirror: mirrorSection,
  nyxid: nyxidSection,
  skillAudit: skillAuditSection,
  telemetry: telemetrySection,
  extras: extrasSection,
  launchPromo: launchPromoSection,
} as const;
