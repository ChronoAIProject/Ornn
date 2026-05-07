/**
 * Telemetry placeholder section schema (Story 7.8). Stored in v1, no
 * runtime consumer yet.
 *
 * @module domains/settings/sections/telemetry
 */
import { z } from "zod";
import { PUBLIC_URL_REFUSAL, requirePublicUrl } from "../../../infra/url";
import type { SectionMeta } from "./index";

const optionalHttpUrl = z.string().refine(requirePublicUrl, {
  message: PUBLIC_URL_REFUSAL,
});

export const telemetrySchema = z.object({
  openTelemetryEnabled: z.boolean(),
  openTelemetryEndpoint: optionalHttpUrl,
  postHogEnabled: z.boolean(),
  postHogApiKey: z.string(),
  postHogHost: optionalHttpUrl,
});

export type TelemetrySection = z.infer<typeof telemetrySchema>;

export const telemetryDefaults: TelemetrySection = {
  openTelemetryEnabled: false,
  openTelemetryEndpoint: "",
  postHogEnabled: false,
  postHogApiKey: "",
  postHogHost: "",
};

export const telemetrySection: SectionMeta<TelemetrySection> = {
  id: "telemetry",
  publicPath: "telemetry",
  schema: telemetrySchema,
  secretFields: ["postHogApiKey"],
  defaults: telemetryDefaults,
};
