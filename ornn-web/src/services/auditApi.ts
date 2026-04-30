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
 * Per-version audit badges. Returns the most recent *completed* audit
 * for each version of the skill. Versions absent from the returned
 * object have never had a completed audit; the UI renders them as
 * "not audited yet". Drives the pills next to the version picker.
 */
export async function fetchAuditSummaryByVersion(
  idOrName: string,
): Promise<Record<string, AuditRecord>> {
  const res = await apiGet<{ byVersion: Record<string, AuditRecord> }>(
    `/api/v1/skills/${encodeURIComponent(idOrName)}/audit/summary-by-version`,
  );
  return res.data?.byVersion ?? {};
}

/**
 * List audit records for a skill (one row per audited version, newest
 * first). When `version` is provided the result is narrowed to that
 * version. Returns empty array for skills with no matching records.
 */
export async function fetchAuditHistory(
  idOrName: string,
  options: { version?: string } = {},
): Promise<AuditRecord[]> {
  const params: Record<string, string | undefined> = {};
  if (options.version) params.version = options.version;
  const res = await apiGet<{ items: AuditRecord[] }>(
    `/api/v1/skills/${encodeURIComponent(idOrName)}/audit/history`,
    params,
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
