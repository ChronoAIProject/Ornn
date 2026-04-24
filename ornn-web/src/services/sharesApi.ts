/**
 * Share-request endpoints — `/api/v1/skills/:idOrName/share`,
 * `/api/v1/shares/*`. Covers the full audit-gated sharing workflow.
 *
 * @module services/sharesApi
 */

import { apiGet, apiPost } from "./apiClient";
import type {
  ReviewDecisionInput,
  ShareRequest,
  SubmitJustificationInput,
} from "@/types/shares";

// NOTE: there is no longer a client-side "initiate share" helper.
// The audit-gated share lifecycle is created as a side-effect of
// `PUT /api/v1/skills/:id/permissions` — see services/permissionsApi.ts.
// Everything below is the lifecycle (justify / review / cancel / list)
// that the backend `GET/POST /api/v1/shares/*` routes still serve.

export async function fetchShareRequest(requestId: string): Promise<ShareRequest | null> {
  const res = await apiGet<ShareRequest>(
    `/api/v1/shares/${encodeURIComponent(requestId)}`,
  );
  return res.data ?? null;
}

export async function submitShareJustification(
  requestId: string,
  input: SubmitJustificationInput,
): Promise<ShareRequest> {
  const res = await apiPost<ShareRequest>(
    `/api/v1/shares/${encodeURIComponent(requestId)}/justification`,
    input,
  );
  if (!res.data) throw new Error("submitShareJustification returned no data");
  return res.data;
}

export async function reviewShareRequest(
  requestId: string,
  input: ReviewDecisionInput,
): Promise<ShareRequest> {
  const res = await apiPost<ShareRequest>(
    `/api/v1/shares/${encodeURIComponent(requestId)}/review`,
    input,
  );
  if (!res.data) throw new Error("reviewShareRequest returned no data");
  return res.data;
}

export async function cancelShareRequest(requestId: string): Promise<ShareRequest> {
  const res = await apiPost<ShareRequest>(
    `/api/v1/shares/${encodeURIComponent(requestId)}/cancel`,
    {},
  );
  if (!res.data) throw new Error("cancelShareRequest returned no data");
  return res.data;
}

export async function fetchMyShareRequests(): Promise<ShareRequest[]> {
  const res = await apiGet<{ items: ShareRequest[] }>("/api/v1/shares");
  return res.data?.items ?? [];
}

export async function fetchShareReviewQueue(): Promise<ShareRequest[]> {
  const res = await apiGet<{ items: ShareRequest[] }>("/api/v1/shares/review-queue");
  return res.data?.items ?? [];
}

export async function fetchMyReviewedShareHistory(): Promise<ShareRequest[]> {
  const res = await apiGet<{ items: ShareRequest[] }>("/api/v1/shares/reviewed-history");
  return res.data?.items ?? [];
}
