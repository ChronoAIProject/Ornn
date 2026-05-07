/**
 * NyxID integration section schema (Story 7.5).
 *
 * `clientSecret` is encrypted at rest. Paths must start with `/`; URLs
 * must be `http(s)://...`. The split-prod rule (memory:
 * NYXID_BASE_URL must be explicit when frontend host != API host) is
 * enforced at the API edge by validating both `baseFrontendUrl` and
 * `baseApiUrl` are non-empty when either is set.
 *
 * @module domains/settings/sections/nyxid
 */
import { z } from "zod";
import { PUBLIC_URL_REFUSAL, requirePublicUrl } from "../../../infra/url";
import type { SectionMeta } from "./index";

const optionalHttpUrl = z.string().refine(requirePublicUrl, {
  message: PUBLIC_URL_REFUSAL,
});

const pathOrEmpty = z
  .string()
  .refine((v) => v === "" || v.startsWith("/"), {
    message: "path must start with /",
  });

export const nyxidSchema = z
  .object({
    tokenUrl: optionalHttpUrl,
    clientId: z.string(),
    clientSecret: z.string(),
    baseFrontendUrl: optionalHttpUrl,
    baseApiUrl: optionalHttpUrl,
    myServicesPath: pathOrEmpty,
    myProfilePath: pathOrEmpty,
    myOrganizationPath: pathOrEmpty,
    servicesListApiPath: pathOrEmpty,
  })
  .superRefine((value, ctx) => {
    // Split-prod rule: if either of the URL hosts is set, both must be.
    const frontSet = value.baseFrontendUrl.length > 0;
    const apiSet = value.baseApiUrl.length > 0;
    if (frontSet !== apiSet) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [frontSet ? "baseApiUrl" : "baseFrontendUrl"],
        message: "split-prod rule: set both baseFrontendUrl and baseApiUrl together",
      });
    }
  });

export type NyxidSection = z.infer<typeof nyxidSchema>;

export const nyxidDefaults: NyxidSection = {
  tokenUrl: "",
  clientId: "",
  clientSecret: "",
  baseFrontendUrl: "",
  baseApiUrl: "",
  myServicesPath: "",
  myProfilePath: "",
  myOrganizationPath: "",
  servicesListApiPath: "",
};

export const nyxidSection: SectionMeta<NyxidSection> = {
  id: "nyxid",
  publicPath: "integrations/nyxid",
  schema: nyxidSchema,
  secretFields: ["clientSecret"],
  defaults: nyxidDefaults,
};
