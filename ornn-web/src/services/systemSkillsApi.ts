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
 * Fetch all platform services from NyxID admin endpoint.
 * Requires admin user token.
 */
async function fetchAdminServices(): Promise<NyxidService[]> {
  const token = useAuthStore.getState().accessToken;
  if (!token) return [];

  const resp = await fetch(`${NYXID_API_BASE}/api/v1/services`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    console.warn("[systemSkillsApi] Failed to fetch admin services:", resp.status);
    return [];
  }
  const data = await resp.json();
  const services = data.services ?? [];

  return services
    .filter((s: any) => s.is_active)
    .map((s: any) => ({
      id: s.id,
      name: s.name ?? s.slug ?? "Unknown",
      slug: s.slug ?? "",
      description: s.description ?? null,
      service_category: s.service_category ?? "unknown",
      hasOpenApiSpec: !!(s.openapi_spec_url || s.api_spec_url),
    }));
}

/**
 * Fetch generated system skills from ornn-api.
 */
async function fetchGeneratedSystemSkills(): Promise<SystemSkillInfo[]> {
  const res = await apiGet<{
    items: SystemSkillInfo[];
    total: number;
  }>("/api/system-skills?pageSize=100");
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

export interface SystemSkillListItem {
  guid: string;
  name: string;
  description: string;
  createdOn: string;
  updatedOn: string;
  isSystem: boolean;
  nyxidServiceId: string;
  tags: string[];
}

export interface SystemSkillsPage {
  items: SystemSkillListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * List generated system skills (any authenticated user).
 * Supports keyword search and pagination.
 */
export async function getPublicSystemSkills(params?: {
  query?: string;
  page?: number;
  pageSize?: number;
}): Promise<SystemSkillsPage | null> {
  const qs = new URLSearchParams();
  if (params?.query) qs.set("query", params.query);
  if (params?.page) qs.set("page", String(params.page));
  if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await apiGet<SystemSkillsPage>(`/api/system-skills${suffix}`);
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
