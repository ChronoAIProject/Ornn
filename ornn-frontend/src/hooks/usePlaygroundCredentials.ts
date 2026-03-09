/**
 * TanStack Query hooks for playground credential CRUD.
 * Wraps playgroundApi functions with cache invalidation.
 * @module hooks/usePlaygroundCredentials
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "@/services/playgroundApi";

const CREDENTIALS_KEY = "playground-credentials";

/** Fetch all credential metadata for the current user. */
export function useCredentials() {
  return useQuery({
    queryKey: [CREDENTIALS_KEY],
    queryFn: api.fetchCredentials,
  });
}

/** Create a new encrypted credential. */
export function useCreateCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) =>
      api.createCredential(name, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CREDENTIALS_KEY] });
    },
  });
}

/** Update an existing credential's value. */
export function useUpdateCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      api.updateCredential(id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CREDENTIALS_KEY] });
    },
  });
}

/** Delete a credential by ID. */
export function useDeleteCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCredential(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CREDENTIALS_KEY] });
    },
  });
}
