/**
 * Admin dashboard API — totals tiles + recent-activities widget.
 *
 * Mirrors `GET /api/v1/admin/dashboard/stats` and
 * `GET /api/v1/admin/dashboard/recent-activities` from the API.
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
  recentActivities24h: number;
}

export interface RecentActivity {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  action: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const res = await apiGet<DashboardStats>("/api/v1/admin/dashboard/stats");
  if (!res.data) {
    throw new Error("Dashboard stats missing");
  }
  return res.data;
}

export async function fetchRecentActivities(limit = 10): Promise<RecentActivity[]> {
  const res = await apiGet<{ items: RecentActivity[] }>(
    "/api/v1/admin/dashboard/recent-activities",
    { limit },
  );
  return res.data?.items ?? [];
}
