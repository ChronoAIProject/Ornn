/**
 * Skill audit endpoints — GET /api/v1/skills/:idOrName/audit and
 * admin-only POST /api/v1/admin/skills/:idOrName/audit.
 *
 * @module services/auditApi
 */

import { apiGet, apiPost, ApiClientError } from "./apiClient";
import type { AuditRecord } from "@/types/audit";

export interface FetchAuditOptions {
  /** Optional pin to a specific version; default = skill's latest. */
  version?: string;
}

/**
 * Fetch the latest cached audit. Returns `null` when the backend says
 * AUDIT_NOT_FOUND (404) rather than throwing — the banner can then
 * distinguish "no audit run yet" from "request failed".
 */
export async function fetchAudit(
  idOrName: string,
  opts: FetchAuditOptions = {},
): Promise<AuditRecord | null> {
  const params: Record<string, string | undefined> = {};
  if (opts.version) params.version = opts.version;
  try {
    const res = await apiGet<AuditRecord>(
      `/api/v1/skills/${encodeURIComponent(idOrName)}/audit`,
      params,
    );
    return res.data ?? null;
  } catch (err) {
    if (err instanceof ApiClientError && err.code === "AUDIT_NOT_FOUND") {
      return null;
    }
    throw err;
  }
}

export interface RerunAuditInput {
  idOrName: string;
  /** Force cache bypass (default true — if someone clicks rerun they want a fresh run). */
  force?: boolean;
}

/** Admin-only: force a fresh audit run. Returns the new record. */
export async function rerunAudit({
  idOrName,
  force = true,
}: RerunAuditInput): Promise<AuditRecord> {
  const res = await apiPost<AuditRecord>(
    `/api/v1/admin/skills/${encodeURIComponent(idOrName)}/audit`,
    { force },
  );
  if (!res.data) throw new Error("Audit rerun returned no data");
  return res.data;
}
