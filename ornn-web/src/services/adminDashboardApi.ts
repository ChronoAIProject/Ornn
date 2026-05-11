/**
 * Admin dashboard API — totals tiles only.
 *
 * Mirrors `GET /api/v1/admin/dashboard/stats` from the API. The
 * `recent-activities` endpoint and its frontend consumer were
 * removed in issue #271 — activity data lives in PostHog now.
 *
 * Skill counts are disjoint by code invariant:
 *   system  = isSystemSkill: true
 *   public  = !isPrivate ∧ !isSystemSkill
 *   private = isPrivate: true
 * Sum equals total.
 *
 * @module services/adminDashboardApi
 */

import { apiGet } from "./apiClient";

export interface DashboardStats {
  users: { total: number; admin: number; normal: number };
  skills: { total: number; system: number; public: number; private: number };
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const res = await apiGet<DashboardStats>("/api/v1/admin/dashboard/stats");
  if (!res.data) {
    throw new Error("errors.api.adminDashboard.statsMissing");
  }
  return res.data;
}
