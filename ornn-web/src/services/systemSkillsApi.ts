/**
 * System Skills API client.
 * Handles admin system skill operations (NyxID service catalog → skill generation).
 *
 * NyxID service list is fetched directly from NyxID by the frontend (the user's
 * access token has the right permissions). Skill generation/deletion goes through ornn-api.
 * @module services/systemSkillsApi
 */

import { apiGet, apiPost, apiDelete } from "./apiClient";
import { useAuthStore } from "@/stores/authStore";

export interface NyxidService {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  service_category: string;
  hasOpenApiSpec: boolean;
}

export interface SystemSkillInfo {
  guid: string;
  name: string;
  description: string;
  tags: string[];
  isSystem: boolean;
  nyxidServiceId: string;
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

const NYXID_API_BASE = import.meta.env.VITE_NYXID_AUTHORIZE_URL?.replace("/oauth/authorize", "") ?? "";

/**
 * Fetch admin (auto-connected) services from NyxID /keys endpoint.
 */
async function fetchAdminServices(): Promise<NyxidService[]> {
  const token = useAuthStore.getState().accessToken;
  if (!token) return [];

  const resp = await fetch(`${NYXID_API_BASE}/api/v1/keys`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) return [];
  const data = await resp.json();
  const keys = Array.isArray(data.keys) ? data.keys : Array.isArray(data) ? data : [];

  return keys
    .filter((k: any) => k.auto_connected)
    .map((k: any) => ({
      id: k.id,
      name: k.catalog_service_name ?? k.label ?? k.slug ?? "Unknown",
      slug: k.slug ?? "",
      description: k.description ?? null,
      service_category: k.service_category ?? "unknown",
      hasOpenApiSpec: false, // will be enriched by skill status
    }));
}

/**
 * Fetch generated system skills from ornn-api.
 */
async function fetchGeneratedSystemSkills(): Promise<SystemSkillInfo[]> {
  const res = await apiGet<{
    items: SystemSkillInfo[];
    total: number;
  }>("/api/system-skills");
  return res.data?.items ?? [];
}

/**
 * List NyxID services merged with their skill generation status.
 */
export async function getSystemSkills(): Promise<SystemSkillItem[]> {
  const [services, skills] = await Promise.all([
    fetchAdminServices(),
    fetchGeneratedSystemSkills(),
  ]);

  const skillMap = new Map(skills.filter((s) => s.nyxidServiceId).map((s) => [s.nyxidServiceId, s]));

  return services.map((svc) => {
    const skill = skillMap.get(svc.id) ?? null;
    return {
      serviceId: svc.id,
      serviceName: svc.name,
      serviceSlug: svc.slug,
      serviceDescription: svc.description,
      baseUrl: "",
      serviceCategory: svc.service_category,
      hasOpenApiSpec: svc.hasOpenApiSpec,
      openApiSpecUrl: null,
      skillGenerated: !!skill,
      skill,
    };
  });
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
 * Sends user token so backend can call NyxID proxy/services endpoint.
 */
export async function generateSystemSkill(serviceId: string): Promise<{ guid: string; name: string }> {
  const token = useAuthStore.getState().accessToken;
  const res = await apiPost<{ guid: string; name: string; serviceId: string }>(
    `/api/admin/system-skills/${serviceId}/generate`,
    { userToken: token },
  );
  if (!res.data) throw new Error("Failed to generate system skill");
  return res.data;
}

/**
 * Regenerate (delete + recreate) a system skill (admin only).
 */
export async function regenerateSystemSkill(serviceId: string): Promise<{ guid: string; name: string }> {
  const token = useAuthStore.getState().accessToken;
  const res = await apiPost<{ guid: string; name: string; serviceId: string }>(
    `/api/admin/system-skills/${serviceId}/regenerate`,
    { userToken: token },
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
