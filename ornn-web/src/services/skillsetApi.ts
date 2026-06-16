/**
 * Client for the skillsets domain (#1059 web UI for #969 backend).
 *
 * Seven functions over the local `apiClient` (JSON bodies — NO SDK). URL
 * layout follows CONVENTIONS.md (plural noun). Read endpoints accept GUID or
 * name; write endpoints (publish / delete) are GUID-only per CONVENTIONS §2.2
 * — callers must pass the GUID on the wire.
 *
 *   searchSkillsets            → GET    /skillset-search
 *   fetchSkillset              → GET    /skillsets/:idOrName[?version]
 *   fetchSkillsetVersions      → GET    /skillsets/:idOrName/versions
 *   fetchSkillsetClosure       → GET    /skillsets/:idOrName/closure[?version]
 *   createSkillset             → POST   /skillsets
 *   publishSkillset            → PUT    /skillsets/:id
 *   deleteSkillset             → DELETE /skillsets/:id
 *
 * NOTE (#1136): no permissions endpoint — a skillset's visibility is derived
 * from its members, not owner-set.
 *
 * @module services/skillsetApi
 */

import { apiGet, apiPost, apiPut, apiDelete } from "./apiClient";
import type {
  CreateSkillsetInput,
  PublishSkillsetInput,
  SkillsetClosureResult,
  SkillsetDetail,
  SkillsetSearchParams,
  SkillsetSearchResponse,
  SkillsetVersionEntry,
} from "@/types/skillset";

/**
 * Discover skillsets by kind / tags / scope. Mirrors the backend
 * `searchQuerySchema` knobs — tags are comma-joined (skillsets must have ALL
 * listed tags). Empty filters are dropped so URLs stay clean.
 */
export async function searchSkillsets(
  params: SkillsetSearchParams,
): Promise<SkillsetSearchResponse> {
  const queryParams: Record<string, string | number | undefined> = {
    kind: params.kind,
    scope: params.scope,
    page: params.page,
    pageSize: params.pageSize,
    tags: params.tags?.length ? params.tags.join(",") : undefined,
    q: params.q?.trim() ? params.q.trim() : undefined,
  };
  const res = await apiGet<SkillsetSearchResponse>(
    "/api/v1/skillset-search",
    queryParams,
  );
  return res.data!;
}

/**
 * Fetch a single skillset by GUID or name.
 * Without `version` → latest. With `version` → that specific version's payload.
 */
export async function fetchSkillset(
  idOrName: string,
  version?: string,
): Promise<SkillsetDetail> {
  const suffix = version ? `?version=${encodeURIComponent(version)}` : "";
  const res = await apiGet<SkillsetDetail>(
    `/api/v1/skillsets/${encodeURIComponent(idOrName)}${suffix}`,
  );
  return res.data!;
}

/** List every published version for a skillset, newest first. */
export async function fetchSkillsetVersions(
  idOrName: string,
): Promise<SkillsetVersionEntry[]> {
  const res = await apiGet<{ items: SkillsetVersionEntry[] }>(
    `/api/v1/skillsets/${encodeURIComponent(idOrName)}/versions`,
  );
  return res.data?.items ?? [];
}

/**
 * Resolve the skillset's closure — the master prompt (`instructions`) plus the
 * server-flattened, deps-first topo-sorted union of all members + their
 * dependency closures. `instructions` is a ROOT sibling of `items`.
 */
export async function fetchSkillsetClosure(
  idOrName: string,
  version?: string,
): Promise<SkillsetClosureResult> {
  const suffix = version ? `?version=${encodeURIComponent(version)}` : "";
  const res = await apiGet<SkillsetClosureResult>(
    `/api/v1/skillsets/${encodeURIComponent(idOrName)}/closure${suffix}`,
  );
  return res.data!;
}

/**
 * Create a skillset (private by default — visibility is managed afterward via
 * the permissions modal on the detail page). Seeds version 1.0.
 */
export async function createSkillset(
  input: CreateSkillsetInput,
): Promise<SkillsetDetail> {
  const res = await apiPost<SkillsetDetail>("/api/v1/skillsets", input);
  return res.data!;
}

/**
 * Publish a new immutable version. First arg MUST be the skillset GUID —
 * publish is GUID-only (CONVENTIONS §2.2). `name` is fixed after create.
 */
export async function publishSkillset(
  guid: string,
  input: PublishSkillsetInput,
): Promise<SkillsetDetail> {
  const res = await apiPut<SkillsetDetail>(
    `/api/v1/skillsets/${encodeURIComponent(guid)}`,
    input,
  );
  return res.data!;
}

/**
 * Delete a skillset + all its versions. First arg MUST be the GUID — delete is
 * GUID-only (CONVENTIONS §2.2).
 */
export async function deleteSkillset(guid: string): Promise<void> {
  await apiDelete(`/api/v1/skillsets/${encodeURIComponent(guid)}`);
}
