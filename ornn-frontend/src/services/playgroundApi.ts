/**
 * API client for playground CRUD endpoints.
 * LLM config removed - users manage LLM credentials in NyxID.
 * Only credential management remains.
 * @module services/playgroundApi
 */

import { apiGet, apiPost, apiPut, apiDelete } from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { PlaygroundCredential } from "@/types/playground";

/**
 * Safely unwrap API response data with a descriptive error on null.
 */
function unwrapData<T>(res: ApiResponse<T>, context: string): T {
  if (res.data === null || res.data === undefined) {
    throw new Error(`Unexpected null response from ${context}`);
  }
  return res.data;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/** Fetch all credential metadata for the current user. */
export async function fetchCredentials(): Promise<PlaygroundCredential[]> {
  const res = await apiGet<PlaygroundCredential[]>("/api/playground/credentials");
  return res.data ?? [];
}

/** Create a new encrypted credential. */
export async function createCredential(
  name: string,
  value: string,
): Promise<PlaygroundCredential> {
  const res = await apiPost<PlaygroundCredential>(
    "/api/playground/credentials",
    { name, value },
  );
  return unwrapData(res, "createCredential");
}

/** Update an existing credential's value. */
export async function updateCredential(
  id: string,
  value: string,
): Promise<PlaygroundCredential> {
  const res = await apiPut<PlaygroundCredential>(
    `/api/playground/credentials/${id}`,
    { value },
  );
  return unwrapData(res, "updateCredential");
}

/** Delete a credential by ID. */
export async function deleteCredential(id: string): Promise<void> {
  await apiDelete(`/api/playground/credentials/${id}`);
}
