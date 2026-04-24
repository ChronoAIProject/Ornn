/**
 * Share-request endpoints — `/api/v1/skills/:idOrName/share`,
 * `/api/v1/shares/*`. Covers the full audit-gated sharing workflow.
 *
 * @module services/sharesApi
 */

import { apiGet, apiPost } from "./apiClient";
import type {
  InitiateShareInput,
  ReviewDecisionInput,
  ShareRequest,
  SubmitJustificationInput,
} from "@/types/shares";

export async function initiateShare(
  skillIdOrName: string,
  input: InitiateShareInput,
): Promise<ShareRequest> {
  const body: { targetType: string; targetId?: string } = {
    targetType: input.targetType,
  };
  if (input.targetId) body.targetId = input.targetId;
  const res = await apiPost<ShareRequest>(
    `/api/v1/skills/${encodeURIComponent(skillIdOrName)}/share`,
    body,
  );
  if (!res.data) throw new Error("initiateShare returned no data");
  return res.data;
}

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
