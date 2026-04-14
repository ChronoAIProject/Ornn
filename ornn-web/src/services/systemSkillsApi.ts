/**
 * System Skills API client.
 * Handles admin system skill operations (NyxID service catalog → skill generation).
 * @module services/systemSkillsApi
 */

import { apiGet, apiPost, apiDelete } from "./apiClient";

export interface SystemSkillInfo {
  guid: string;
  name: string;
  description: string;
  tags: string[];
  createdOn: string;
  updatedOn: string;
}

export interface SystemSkillItem {
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  serviceDescription: string | null;
  baseUrl: string;
  serviceCategory: string;
  hasOpenApiSpec: boolean;
  openApiSpecUrl: string | null;
  skillGenerated: boolean;
  skill: SystemSkillInfo | null;
}

export interface SystemSkillListResponse {
  items: SystemSkillItem[];
}

/**
 * List NyxID services + their skill generation status (admin only).
 */
export async function getSystemSkills(): Promise<SystemSkillItem[]> {
  const res = await apiGet<SystemSkillListResponse>("/api/admin/system-skills");
  return res.data?.items ?? [];
}

/**
 * List generated system skills (any authenticated user).
 */
export async function getPublicSystemSkills() {
  const res = await apiGet<{
    items: Array<{
      guid: string;
      name: string;
      description: string;
      createdOn: string;
      updatedOn: string;
      isSystem: boolean;
      nyxidServiceId: string;
      tags: string[];
    }>;
    total: number;
  }>("/api/system-skills");
  return res.data;
}

/**
 * Generate skill from a NyxID service's OpenAPI spec (admin only).
 */
export async function generateSystemSkill(serviceId: string): Promise<{ guid: string; name: string }> {
  const res = await apiPost<{ guid: string; name: string; serviceId: string }>(
    `/api/admin/system-skills/${serviceId}/generate`,
    {},
  );
  if (!res.data) throw new Error("Failed to generate system skill");
  return res.data;
}

/**
 * Regenerate (delete + recreate) a system skill (admin only).
 */
export async function regenerateSystemSkill(serviceId: string): Promise<{ guid: string; name: string }> {
  const res = await apiPost<{ guid: string; name: string; serviceId: string }>(
    `/api/admin/system-skills/${serviceId}/regenerate`,
    {},
  );
  if (!res.data) throw new Error("Failed to regenerate system skill");
  return res.data;
}

/**
 * Delete a system skill (admin only).
 */
export async function deleteSystemSkill(serviceId: string): Promise<void> {
  await apiDelete(`/api/admin/system-skills/${serviceId}`);
}
