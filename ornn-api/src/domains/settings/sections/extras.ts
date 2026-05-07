/**
 * Extras section schema (Story 7.10) — extra synthetic NyxID services.
 *
 * @module domains/settings/sections/extras
 */
import { z } from "zod";
import { PUBLIC_URL_REFUSAL, requirePublicUrl } from "../../../infra/url";
import type { SectionMeta } from "./index";

const SERVICE_NAME_RE = /^[a-z0-9-]{1,64}$/;
const optionalHttpUrl = z.string().refine(requirePublicUrl, {
  message: PUBLIC_URL_REFUSAL,
});

const extraServiceSchema = z.object({
  name: z.string().regex(SERVICE_NAME_RE, "name must match ^[a-z0-9-]{1,64}$"),
  baseUrl: optionalHttpUrl,
  scopes: z.array(z.string()).optional(),
});

export const extrasSchema = z
  .object({
    extraNyxidServices: z.array(extraServiceSchema),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.extraNyxidServices.forEach((svc, idx) => {
      if (seen.has(svc.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["extraNyxidServices", idx, "name"],
          message: `duplicate service name "${svc.name}"`,
        });
      }
      seen.add(svc.name);
    });
  });

export type ExtrasSection = z.infer<typeof extrasSchema>;

export const extrasDefaults: ExtrasSection = {
  extraNyxidServices: [],
};

export const extrasSection: SectionMeta<ExtrasSection> = {
  id: "extras",
  publicPath: "extras",
  schema: extrasSchema,
  secretFields: [],
  defaults: extrasDefaults,
};
