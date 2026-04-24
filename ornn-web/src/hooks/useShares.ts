/**
 * React Query hooks for the audit-gated sharing workflow.
 *
 * @module hooks/useShares
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelShareRequest,
  fetchMyReviewedShareHistory,
  fetchMyShareRequests,
  fetchShareRequest,
  fetchShareReviewQueue,
  reviewShareRequest,
  submitShareJustification,
} from "@/services/sharesApi";
import type {
  ReviewDecisionInput,
  ShareRequest,
  SubmitJustificationInput,
} from "@/types/shares";
import { useIsAuthenticated } from "@/stores/authStore";

const MY_SHARES_KEY = ["shares", "mine"] as const;
const REVIEW_QUEUE_KEY = ["shares", "review-queue"] as const;
const REVIEWED_HISTORY_KEY = ["shares", "reviewed-history"] as const;
const shareKey = (requestId: string) => ["shares", "one", requestId] as const;

export function useMyShareRequests() {
  const isAuthed = useIsAuthenticated();
  return useQuery<ShareRequest[]>({
    queryKey: MY_SHARES_KEY,
    queryFn: fetchMyShareRequests,
    enabled: isAuthed,
    staleTime: 15_000,
  });
}

export function useShareReviewQueue() {
  const isAuthed = useIsAuthenticated();
  return useQuery<ShareRequest[]>({
    queryKey: REVIEW_QUEUE_KEY,
    queryFn: fetchShareReviewQueue,
    enabled: isAuthed,
    staleTime: 15_000,
  });
}

/** Past decisions by the caller — feeds the admin "Review history" page. */
export function useMyReviewedShareHistory() {
  const isAuthed = useIsAuthenticated();
  return useQuery<ShareRequest[]>({
    queryKey: REVIEWED_HISTORY_KEY,
    queryFn: fetchMyReviewedShareHistory,
    enabled: isAuthed,
    staleTime: 60_000,
  });
}

export function useShareRequest(requestId: string | undefined) {
  return useQuery<ShareRequest | null>({
    queryKey: shareKey(requestId ?? ""),
    queryFn: () => fetchShareRequest(requestId!),
    enabled: Boolean(requestId),
    staleTime: 15_000,
  });
}

export function useCancelShareRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => cancelShareRequest(requestId),
    onSuccess: (updated) => {
      queryClient.setQueryData(shareKey(updated._id), updated);
      queryClient.invalidateQueries({ queryKey: MY_SHARES_KEY });
      queryClient.invalidateQueries({ queryKey: REVIEW_QUEUE_KEY });
      queryClient.invalidateQueries({ queryKey: REVIEWED_HISTORY_KEY });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useSubmitShareJustification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { requestId: string; input: SubmitJustificationInput }) =>
      submitShareJustification(vars.requestId, vars.input),
    onSuccess: (updated) => {
      queryClient.setQueryData(shareKey(updated._id), updated);
      queryClient.invalidateQueries({ queryKey: MY_SHARES_KEY });
      queryClient.invalidateQueries({ queryKey: REVIEW_QUEUE_KEY });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useReviewShareRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { requestId: string; input: ReviewDecisionInput }) =>
      reviewShareRequest(vars.requestId, vars.input),
    onSuccess: (updated) => {
      queryClient.setQueryData(shareKey(updated._id), updated);
      queryClient.invalidateQueries({ queryKey: MY_SHARES_KEY });
      queryClient.invalidateQueries({ queryKey: REVIEW_QUEUE_KEY });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
