/**
 * React Query hooks for the audit-gated sharing workflow.
 *
 * @module hooks/useShares
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelShareRequest,
  fetchMyShareRequests,
  fetchShareRequest,
  fetchShareReviewQueue,
  initiateShare,
  reviewShareRequest,
  submitShareJustification,
} from "@/services/sharesApi";
import type {
  InitiateShareInput,
  ReviewDecisionInput,
  ShareRequest,
  SubmitJustificationInput,
} from "@/types/shares";
import { useIsAuthenticated } from "@/stores/authStore";

const MY_SHARES_KEY = ["shares", "mine"] as const;
const REVIEW_QUEUE_KEY = ["shares", "review-queue"] as const;
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

export function useShareRequest(requestId: string | undefined) {
  return useQuery<ShareRequest | null>({
    queryKey: shareKey(requestId ?? ""),
    queryFn: () => fetchShareRequest(requestId!),
    enabled: Boolean(requestId),
    staleTime: 15_000,
  });
}

export function useInitiateShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { skillIdOrName: string; input: InitiateShareInput }) =>
      initiateShare(vars.skillIdOrName, vars.input),
    onSuccess: (created) => {
      queryClient.setQueryData(shareKey(created._id), created);
      queryClient.invalidateQueries({ queryKey: MY_SHARES_KEY });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
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
