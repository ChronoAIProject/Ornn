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

/**
 * List every stored audit record for a skill (one row per audited version,
 * newest first). Returns empty array for skills that have never been audited.
 */
export async function fetchAuditHistory(
  idOrName: string,
): Promise<AuditRecord[]> {
  const res = await apiGet<{ items: AuditRecord[] }>(
    `/api/v1/skills/${encodeURIComponent(idOrName)}/audit/history`,
  );
  return res.data?.items ?? [];
}

export interface StartAuditInput {
  idOrName: string;
  /** Bypass the 30-day audit cache. Default false — most callers want the cache. */
  force?: boolean;
}

/**
 * Owner- or admin-triggerable audit run. Backend honours the cache unless
 * `force=true`. Returns the resulting audit record.
 */
export async function startAudit({
  idOrName,
  force = false,
}: StartAuditInput): Promise<AuditRecord> {
  const res = await apiPost<AuditRecord>(
    `/api/v1/skills/${encodeURIComponent(idOrName)}/audit`,
    { force },
  );
  if (!res.data) throw new Error("Audit returned no data");
  return res.data;
}
