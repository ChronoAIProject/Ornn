import { apiGet, apiPost, apiPut, apiDelete } from "./apiClient";
import type { UpdateSkillMetadata } from "@/types/api";
import type { SkillDetail, SkillVersionEntry, VersionDiffResponse } from "@/types/domain";
import { useAuthStore } from "@/stores/authStore";
import { config } from "@/config";

const API_BASE = config.apiBaseUrl;

/**
 * Fetch a single skill by GUID or name.
 * Without `version` → latest. With `version` → that specific version's payload.
 */
export async function fetchSkill(idOrName: string, version?: string): Promise<SkillDetail> {
  const suffix = version ? `?version=${encodeURIComponent(version)}` : "";
  const res = await apiGet<SkillDetail>(`/api/v1/skills/${encodeURIComponent(idOrName)}${suffix}`);
  return res.data!;
}

/** List every published version for a skill, newest first. */
export async function fetchSkillVersions(idOrName: string): Promise<SkillVersionEntry[]> {
  const res = await apiGet<{ items: SkillVersionEntry[] }>(
    `/api/v1/skills/${encodeURIComponent(idOrName)}/versions`,
  );
  return res.data?.items ?? [];
}

/**
 * Fetch a structured diff between two published versions of a skill.
 * Server returns added/removed/modified file lists with text content
 * inlined for diffable files; binary files come back as path + hash + size.
 */
export async function fetchSkillVersionDiff(
  idOrName: string,
  fromVersion: string,
  toVersion: string,
): Promise<VersionDiffResponse> {
  const res = await apiGet<VersionDiffResponse>(
    `/api/v1/skills/${encodeURIComponent(idOrName)}/versions/${encodeURIComponent(
      fromVersion,
    )}/diff/${encodeURIComponent(toVersion)}`,
  );
  return res.data!;
}

/**
 * Toggle the deprecation flag on a specific published version.
 *
 * First arg MUST be the skill GUID — version-write routes are GUID-only
 * (CONVENTIONS §2.2). A name passed here resolves via `findByGuid` on
 * the backend and 404s (#750).
 */
export async function setSkillVersionDeprecation(
  guid: string,
  version: string,
  // exactOptionalPropertyTypes (#657)
  body: { isDeprecated: boolean; deprecationNote?: string | undefined },
): Promise<{
  skillGuid: string;
  skillName: string;
  version: string;
  isDeprecated: boolean;
  deprecationNote: string | null;
}> {
  const token = useAuthStore.getState().accessToken;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(
    `${API_BASE}/api/v1/skills/${encodeURIComponent(guid)}/versions/${encodeURIComponent(version)}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw new Error(
      (json as { error?: { message?: string } })?.error?.message ??
        `HTTP ${response.status}: ${response.statusText}`,
    );
  }
  const json = await response.json();
  return json.data;
}

/**
 * Create a new skill from a ZIP file. Sends the ZIP as a raw
 * application/zip body. New skills are always private — visibility is
 * managed afterward via the permissions panel on the skill detail page.
 *
 * #528 — `X-User-Email` / `X-User-Display-Name` headers used to ride
 * along here. They were stripped by the NyxID proxy and never read by
 * the backend (identity is sourced from the proxy-forwarded identity
 * token), but the backend CORS allowlist is `["Content-Type",
 * "Authorization"]`, so the preflight allowed-headers response didn't
 * include them — the browser then blocked the actual POST with a
 * CORS error. Same dead code as the `apiClient.createHeaders`
 * cleanup; this was the last unmigrated caller of the ZIP-upload
 * flow.
 *
 * #732 / #709 — also drop `credentials: "include"` here (and on the
 * PUT/PATCH siblings below). These calls authenticate with the
 * `Authorization: Bearer` header, never cookies. With
 * `credentials: "include"` the browser rejects the NyxID proxy's
 * wildcard `Access-Control-Allow-Origin: *` (a credentialed request
 * forbids wildcard ACAO), blocking the request at the CORS layer
 * before it leaves the browser — the exact "Failed to fetch" symptom
 * in #732. Same trap #709 already cleared in activityApi.ts.
 */
export async function createSkill(zipFile: File, skipValidation = false): Promise<SkillDetail> {
  const token = useAuthStore.getState().accessToken;
  const headers: HeadersInit = {
    "Content-Type": "application/zip",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const params = skipValidation ? "?skip_validation=true" : "";
  const response = await fetch(`${API_BASE}/api/v1/skills${params}`, {
    method: "POST",
    headers,
    body: zipFile,
  });

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw new Error(
      (json as { error?: { message?: string } })?.error?.message ??
        `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const json = await response.json();
  return json.data as SkillDetail;
}

/**
 * Update skill metadata (e.g. isPrivate) via JSON body.
 */
export async function updateSkill(id: string, data: UpdateSkillMetadata): Promise<SkillDetail> {
  const res = await apiPut<SkillDetail>(`/api/v1/skills/${id}`, data);
  return res.data!;
}

/**
 * Update skill package by uploading a new ZIP file.
 */
export async function updateSkillPackage(id: string, zipFile: File, skipValidation = false): Promise<SkillDetail> {
  const token = useAuthStore.getState().accessToken;
  const headers: HeadersInit = {
    "Content-Type": "application/zip",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const params = skipValidation ? "?skip_validation=true" : "";
  const response = await fetch(`${API_BASE}/api/v1/skills/${id}${params}`, {
    method: "PUT",
    headers,
    body: zipFile,
  });

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw new Error(
      (json as { error?: { message?: string } })?.error?.message ??
        `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const json = await response.json();
  return json.data as SkillDetail;
}

/** Hard-delete a skill */
export async function deleteSkill(id: string): Promise<void> {
  await apiDelete(`/api/v1/skills/${id}`);
}

/**
 * Hard-delete one non-latest version of a skill. Backend forbids deleting
 * the only version (use `deleteSkill`) or the current latest (publish a
 * newer version first).
 *
 * First arg MUST be the skill GUID — version-write routes are GUID-only
 * (CONVENTIONS §2.2). A name passed here resolves via `findByGuid` on
 * the backend and 404s (#750).
 */
export async function deleteSkillVersion(
  guid: string,
  version: string,
): Promise<void> {
  await apiDelete(
    `/api/v1/skills/${encodeURIComponent(guid)}/versions/${encodeURIComponent(version)}`,
  );
}

export interface PullFromGitHubInput {
  /** Preferred: a folder URL like `https://github.com/owner/repo/tree/<ref>/<path>`. */
  githubUrl?: string;
  /** Legacy / explicit form. Pass instead of (or alongside, ignored if) `githubUrl`. */
  repo?: string;
  ref?: string;
  path?: string;
  /** Skip the format-validation pass on the generated ZIP. */
  skipValidation?: boolean;
}

/**
 * Create a skill by cloning a public GitHub repo. Backend parses the URL
 * (or the explicit `repo`/`ref`/`path`), zips the tree, records the
 * source pointer, and publishes as v1. Subsequent updates come via
 * `refreshSkillFromSource`.
 */
export async function pullSkillFromGitHub(input: PullFromGitHubInput): Promise<SkillDetail> {
  const res = await apiPost<SkillDetail>("/api/v1/skills/pull", {
    githubUrl: input.githubUrl,
    repo: input.repo,
    ref: input.ref,
    path: input.path,
    skip_validation: input.skipValidation ?? false,
  });
  return res.data!;
}

/**
 * Re-pull the skill's GitHub source and publish a new version. Requires
 * owner or platform admin. `skipValidation` opts out of the format
 * validator on the pulled package — useful when the upstream repo
 * doesn't strictly conform to Ornn's skill-package layout.
 */
export async function refreshSkillFromSource(
  id: string,
  // exactOptionalPropertyTypes (#657)
  options?: { skipValidation?: boolean | undefined },
): Promise<SkillDetail> {
  const res = await apiPost<SkillDetail>(`/api/v1/skills/${id}/refresh`, {
    skipValidation: options?.skipValidation ?? false,
  });
  return res.data!;
}

/**
 * Dry-run a refresh. Server pulls the latest content from the skill's
 * stored GitHub source, computes a structured diff against the current
 * latest version, and returns it WITHOUT bumping. Powers the
 * preview-then-confirm flow on the detail-page Advanced Options panel.
 */
export interface RefreshPreviewResponse {
  skill: { guid: string; name: string };
  source: import("@/types/domain").SkillSource;
  pendingVersion: string;
  hasChanges: boolean;
  diff: import("@/types/domain").VersionDiffResponse["diff"];
}

export async function previewSkillRefresh(id: string): Promise<RefreshPreviewResponse> {
  const res = await apiPost<RefreshPreviewResponse>(`/api/v1/skills/${id}/refresh`, {
    dryRun: true,
  });
  return res.data!;
}

/**
 * Attach (or clear) a GitHub source pointer on an existing skill. Pass
 * `null` for `githubUrl` to unlink. The pointer is parsed server-side
 * from a folder URL like `https://github.com/<owner>/<repo>/tree/<ref>/<path>`.
 * Does NOT pull — the user triggers `previewSkillRefresh` →
 * `refreshSkillFromSource` separately.
 */
export async function setSkillSource(
  id: string,
  githubUrl: string | null,
): Promise<SkillDetail> {
  const res = await apiPut<SkillDetail>(`/api/v1/skills/${id}/source`, { githubUrl });
  return res.data!;
}

/**
 * Tie or untie a skill to a NyxID catalog service. `nyxidServiceId: null`
 * untie; a string ties to that service. Tying to an admin-tier service
 * forces `isPrivate: false` (system skills are always public). Returns
 * the refreshed skill detail.
 */
export async function tieSkillToNyxidService(
  id: string,
  nyxidServiceId: string | null,
): Promise<SkillDetail> {
  const res = await apiPut<{ skill: SkillDetail }>(`/api/v1/skills/${id}/nyxid-service`, {
    nyxidServiceId,
  });
  return res.data!.skill;
}
