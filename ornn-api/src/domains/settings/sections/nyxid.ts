/**
 * NyxID integration section schema (#302 cleanup).
 *
 * Owns the server-side coords ornn-api consults plus the chrono-storage
 * + chrono-sandbox URLs that previously lived in a separate `services`
 * section. Folded here because all three are NyxID-orbit integration
 * endpoints; one section per integration tier keeps the admin surface
 * leaner.
 *
 *   - tokenUrl    — SA OAuth token endpoint
 *   - clientId    — SA client id
 *   - clientSecret — SA secret (encrypted at rest)
 *   - baseApiUrl  — NyxID API base URL the backend proxies through
 *   - chronoStorageUrl    — chrono-storage service base URL
 *   - chronoStorageBucket — chrono-storage S3 bucket name
 *   - chronoSandboxUrl    — chrono-sandbox service base URL
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

// S3 bucket rules (relaxed enough for MinIO too): lower-case alnum / dot
// / hyphen, 1..63 chars, no slash. Empty is permitted ("not configured").
const bucketName = z
  .string()
  .refine((v) => v === "" || /^[a-z0-9.-]{1,63}$/.test(v), {
    message: "bucket must match ^[a-z0-9.-]{1,63}$ (no slashes)",
  });

export const nyxidSchema = z.object({
  tokenUrl: optionalHttpUrl,
  clientId: z.string(),
  clientSecret: z.string(),
  baseApiUrl: optionalHttpUrl,
  chronoStorageUrl: optionalHttpUrl,
  chronoStorageBucket: bucketName,
  chronoSandboxUrl: optionalHttpUrl,
});

export type NyxidSection = z.infer<typeof nyxidSchema>;

export const nyxidDefaults: NyxidSection = {
  tokenUrl: "",
  clientId: "",
  clientSecret: "",
  baseApiUrl: "",
  chronoStorageUrl: "",
  chronoStorageBucket: "",
  chronoSandboxUrl: "",
};

export const nyxidSection: SectionMeta<NyxidSection> = {
  id: "nyxid",
  publicPath: "integrations/nyxid",
  schema: nyxidSchema,
  secretFields: ["clientSecret"],
  defaults: nyxidDefaults,
};
