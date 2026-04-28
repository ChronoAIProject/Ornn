import { apiGet, apiPost, apiPut, apiDelete } from "./apiClient";
import type { UpdateSkillMetadata } from "@/types/api";
import type { SkillDetail, SkillVersionEntry } from "@/types/domain";
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

/** Toggle the deprecation flag on a specific published version. */
export async function setSkillVersionDeprecation(
  idOrName: string,
  version: string,
  body: { isDeprecated: boolean; deprecationNote?: string },
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
    `${API_BASE}/api/v1/skills/${encodeURIComponent(idOrName)}/versions/${encodeURIComponent(version)}`,
    {
      method: "PATCH",
      headers,
      credentials: "include",
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
 */
export async function createSkill(zipFile: File, skipValidation = false): Promise<SkillDetail> {
  const { accessToken: token, user } = useAuthStore.getState();
  const headers: HeadersInit = {
    "Content-Type": "application/zip",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (user?.email) {
    headers["X-User-Email"] = user.email;
  }
  if (user?.displayName) {
    headers["X-User-Display-Name"] = user.displayName;
  }

  const params = skipValidation ? "?skip_validation=true" : "";
  const response = await fetch(`${API_BASE}/api/v1/skills${params}`, {
    method: "POST",
    headers,
    body: zipFile,
    credentials: "include",
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
    credentials: "include",
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
 */
export async function deleteSkillVersion(
  idOrName: string,
  version: string,
): Promise<void> {
  await apiDelete(
    `/api/v1/skills/${encodeURIComponent(idOrName)}/versions/${encodeURIComponent(version)}`,
  );
}

export interface PullFromGitHubInput {
  /** `owner/name`. */
  repo: string;
  /** Branch / tag / commit SHA. Omit for the repo default. */
  ref?: string;
  /** Subdirectory that contains `SKILL.md`. Omit for repo root. */
  path?: string;
  /** Skip the format-validation pass on the generated ZIP. */
  skipValidation?: boolean;
}

/**
 * Create a skill by cloning a public GitHub repo. Backend zips the tree,
 * records the source pointer, and publishes as v1. Subsequent updates
 * come via `refreshSkillFromSource`.
 */
export async function pullSkillFromGitHub(input: PullFromGitHubInput): Promise<SkillDetail> {
  const res = await apiPost<SkillDetail>("/api/v1/skills/pull", {
    repo: input.repo,
    ref: input.ref,
    path: input.path,
    skip_validation: input.skipValidation ?? false,
  });
  return res.data!;
}

/**
 * Re-pull the skill's GitHub source at the current ref HEAD and publish as
 * a new version. Requires owner or platform admin.
 */
export async function refreshSkillFromSource(id: string): Promise<SkillDetail> {
  const res = await apiPost<SkillDetail>(`/api/v1/skills/${id}/refresh`, {});
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
