/**
 * NyxID integration section schema (Story 7.5; #275 cleanup).
 *
 * Owns only the server-side coords ornn-api actually consults:
 *   - tokenUrl    — SA OAuth token endpoint
 *   - clientId    — SA client id
 *   - clientSecret — SA secret (encrypted at rest)
 *   - baseApiUrl  — NyxID API base URL the backend proxies through
 *
 * Browser-only link coords (NyxID frontend URL + my-services /
 * my-profile / my-organization paths) used to live here as scaffolding
 * but never had a server-side consumer. They moved to ornn-web's
 * configmap (delivered via window.__ORNN_CONFIG__ — see #275 + the
 * `NYXID_BASE_FRONTEND_URL` / `NYXID_MY_*_PATH` env vars).
 *
 * `clientSecret` is encrypted at rest. URLs must be `http(s)://...`
 * when set; an empty string is the unset state.
 *
 * @module domains/settings/sections/nyxid
 */
import { z } from "zod";
import { PUBLIC_URL_REFUSAL, requirePublicUrl } from "../../../infra/url";
import type { SectionMeta } from "./index";

const optionalHttpUrl = z.string().refine(requirePublicUrl, {
  message: PUBLIC_URL_REFUSAL,
});

export const nyxidSchema = z.object({
  tokenUrl: optionalHttpUrl,
  clientId: z.string(),
  clientSecret: z.string(),
  baseApiUrl: optionalHttpUrl,
});

export type NyxidSection = z.infer<typeof nyxidSchema>;

export const nyxidDefaults: NyxidSection = {
  tokenUrl: "",
  clientId: "",
  clientSecret: "",
  baseApiUrl: "",
};

export const nyxidSection: SectionMeta<NyxidSection> = {
  id: "nyxid",
  publicPath: "integrations/nyxid",
  schema: nyxidSchema,
  secretFields: ["clientSecret"],
  defaults: nyxidDefaults,
};
