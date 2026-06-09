/**
 * @chronoai/ornn-sdk — TypeScript client for Ornn, the end-to-end skill life-cycle manager for AI agents.
 *
 * Quickstart:
 *
 * ```ts
 * import { OrnnClient } from "@chronoai/ornn-sdk";
 *
 * const ornn = new OrnnClient({
 *   baseUrl: "https://ornn.chrono-ai.fun",
 *   token: process.env.NYXID_ACCESS_TOKEN!,
 * });
 *
 * const { items } = await ornn.search({ q: "pdf", scope: "public" });
 * const detail = await ornn.get(items[0].id);
 * const pkg = await ornn.downloadPackage(detail.id, detail.latestVersion!);
 * ```
 *
 * All requests go through `/api/v1/*`. Errors throw `OrnnError`.
 */

export { OrnnClient, type OrnnClientOptions } from "./client";
export { OrnnError, type OrnnErrorPayload } from "./errors";
export type {
  ClosureNode,
  ClosureResult,
  CreateSkillsetInput,
  PublishOptions,
  PublishSkillsetInput,
  SearchScope,
  SkillDetail,
  SkillSearchParams,
  SkillSearchResult,
  SkillsetClosureResult,
  SkillsetDetail,
  SkillsetKind,
  SkillsetPermissionsInput,
  SkillsetSearchParams,
  SkillsetSearchResult,
  SkillsetSummary,
  SkillSummary,
  SkillVersionEntry,
  UpdateSkillMetadata,
  Visibility,
} from "./types";
