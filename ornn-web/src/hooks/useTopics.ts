/**
 * React Query hooks for the topics domain.
 *
 * @module hooks/useTopics
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addSkillsToTopic,
  createTopic,
  deleteTopic,
  fetchTopic,
  listTopics,
  removeSkillFromTopic,
  updateTopic,
  type AddSkillsResult,
  type CreateTopicBody,
  type ListTopicsParams,
  type UpdateTopicBody,
} from "@/services/topicsApi";

const TOPICS_LIST_KEY = "topics-list";
const TOPIC_DETAIL_KEY = "topic-detail";

export function useTopicsList(params: ListTopicsParams) {
  return useQuery({
    queryKey: [TOPICS_LIST_KEY, params],
    queryFn: () => listTopics(params),
  });
}

export function useTopic(idOrName: string | undefined) {
  return useQuery({
    queryKey: [TOPIC_DETAIL_KEY, idOrName ?? ""],
    queryFn: () => fetchTopic(idOrName!),
    enabled: !!idOrName,
  });
}

export function useCreateTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTopicBody) => createTopic(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TOPICS_LIST_KEY] });
    },
  });
}

export function useUpdateTopic(idOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTopicBody) => updateTopic(idOrName, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TOPICS_LIST_KEY] });
      qc.invalidateQueries({ queryKey: [TOPIC_DETAIL_KEY, idOrName] });
    },
  });
}

export function useDeleteTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTopic(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TOPICS_LIST_KEY] });
    },
  });
}

export function useAddSkillsToTopic(idOrName: string) {
  const qc = useQueryClient();
  return useMutation<AddSkillsResult, Error, { skillIds: string[] }>({
    mutationFn: (body) => addSkillsToTopic(idOrName, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TOPIC_DETAIL_KEY, idOrName] });
      qc.invalidateQueries({ queryKey: [TOPICS_LIST_KEY] });
    },
  });
}

export function useRemoveSkillFromTopic(idOrName: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (skillGuid) => removeSkillFromTopic(idOrName, skillGuid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TOPIC_DETAIL_KEY, idOrName] });
      qc.invalidateQueries({ queryKey: [TOPICS_LIST_KEY] });
    },
  });
}
