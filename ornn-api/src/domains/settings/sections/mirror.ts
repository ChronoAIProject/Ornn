/**
 * GitHub mirror section schema (Story 7.4).
 *
 * `appPrivateKey` is encrypted at rest by the SettingsService before it
 * lands in Mongo. It is exposed mid-masked on GET and replaced with a
 * redaction sentinel on settings export.
 *
 * @module domains/settings/sections/mirror
 */
import { z } from "zod";
import type { SectionMeta } from "./index";

export const mirrorSchema = z.object({
  enabled: z.boolean(),
  owner: z.string(),
  repo: z.string(),
  branch: z.string(),
  appId: z.string(),
  installationId: z.string(),
  appPrivateKey: z.string(),
});

export type MirrorSection = z.infer<typeof mirrorSchema>;

export const mirrorDefaults: MirrorSection = {
  enabled: false,
  owner: "",
  repo: "",
  branch: "",
  appId: "",
  installationId: "",
  appPrivateKey: "",
};

export const mirrorSection: SectionMeta<MirrorSection> = {
  id: "mirror",
  publicPath: "mirror",
  schema: mirrorSchema,
  secretFields: ["appPrivateKey"],
  defaults: mirrorDefaults,
};
