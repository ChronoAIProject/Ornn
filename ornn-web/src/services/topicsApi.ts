/**
 * Topics API client. Mirrors the /api/topics endpoints.
 *
 * Errors from the backend surface as plain `Error` so existing toast code
 * paths render the real message (e.g. 409 `TOPIC_NAME_EXISTS`).
 *
 * @module services/topicsApi
 */

import { apiGet, apiPost, apiPut, apiDelete, ApiClientError } from "./apiClient";
import type { Topic, TopicDetail, TopicListPage } from "@/types/domain";

export interface ListTopicsParams {
  query?: string;
  scope?: "public" | "mine" | "mixed";
  page?: number;
  pageSize?: number;
}

export interface CreateTopicBody {
  name: string;
  description?: string;
  isPrivate?: boolean;
}

export interface UpdateTopicBody {
  description?: string;
  isPrivate?: boolean;
}

export interface AddSkillsResult {
  added: string[];
  skipped: string[];
}

function unwrapError<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof ApiClientError) {
      throw new Error(err.message);
    }
    throw err;
  });
}

export async function listTopics(params: ListTopicsParams = {}): Promise<TopicListPage> {
  const res = await unwrapError(() =>
    apiGet<TopicListPage>("/api/topics", {
      query: params.query,
      scope: params.scope,
      page: params.page,
      pageSize: params.pageSize,
    }),
  );
  return (
    res.data ?? {
      items: [],
      total: 0,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      totalPages: 0,
    }
  );
}

export async function fetchTopic(idOrName: string): Promise<TopicDetail> {
  const res = await unwrapError(() =>
    apiGet<TopicDetail>(`/api/topics/${encodeURIComponent(idOrName)}`),
  );
  return res.data!;
}

export async function createTopic(body: CreateTopicBody): Promise<Topic> {
  const res = await unwrapError(() => apiPost<TopicDetail>("/api/topics", body));
  return res.data!;
}

export async function updateTopic(id: string, body: UpdateTopicBody): Promise<TopicDetail> {
  const res = await unwrapError(() =>
    apiPut<TopicDetail>(`/api/topics/${encodeURIComponent(id)}`, body),
  );
  return res.data!;
}

export async function deleteTopic(id: string): Promise<void> {
  await unwrapError(() => apiDelete(`/api/topics/${encodeURIComponent(id)}`));
}

export async function addSkillsToTopic(
  id: string,
  body: { skillIds: string[] },
): Promise<AddSkillsResult> {
  const res = await unwrapError(() =>
    apiPost<AddSkillsResult>(`/api/topics/${encodeURIComponent(id)}/skills`, body),
  );
  return res.data!;
}

export async function removeSkillFromTopic(id: string, skillGuid: string): Promise<void> {
  await unwrapError(() =>
    apiDelete(`/api/topics/${encodeURIComponent(id)}/skills/${encodeURIComponent(skillGuid)}`),
  );
}
