/**
 * Other-services integration section schema (Story 7.6) — chrono-storage
 * + chrono-sandbox endpoints.
 *
 * @module domains/settings/sections/services
 */
import { z } from "zod";
import { PUBLIC_URL_REFUSAL, requirePublicUrl } from "../../../infra/url";
import type { SectionMeta } from "./index";

const optionalHttpUrl = z.string().refine(requirePublicUrl, {
  message: PUBLIC_URL_REFUSAL,
});

// S3 bucket rules (relaxed enough for MinIO too): lower-case alnum / dot
// / hyphen, 1..63 chars, no slash. We do NOT require a leading
// alpha-numeric here because empty is permitted ("not configured").
const bucketName = z
  .string()
  .refine((v) => v === "" || /^[a-z0-9.-]{1,63}$/.test(v), {
    message: "bucket must match ^[a-z0-9.-]{1,63}$ (no slashes)",
  });

export const servicesSchema = z.object({
  chronoStorageUrl: optionalHttpUrl,
  chronoStorageBucket: bucketName,
  chronoSandboxUrl: optionalHttpUrl,
});

export type ServicesSection = z.infer<typeof servicesSchema>;

export const servicesDefaults: ServicesSection = {
  chronoStorageUrl: "",
  chronoStorageBucket: "",
  chronoSandboxUrl: "",
};

export const servicesSection: SectionMeta<ServicesSection> = {
  id: "services",
  publicPath: "integrations/services",
  schema: servicesSchema,
  secretFields: [],
  defaults: servicesDefaults,
};
