/**
 * TopicService — business logic for skill topics.
 *
 * Ownership / visibility rules (mirror the skill rules):
 *   - Public topic: visible to anyone. The embedded skill list on the
 *     detail endpoint is still filtered per-viewer — a private skill stays
 *     hidden from users who can't already see it, even if it's been added
 *     to a public topic.
 *   - Private topic: visible to its author, to admins/members of the owning
 *     org (when `ownerId` is an org), and to platform admins.
 *
 * Write (create / update / delete / membership changes):
 *   - The author (`createdBy === actor`) can always manage.
 *   - When `ownerId` is an org, admins of that org can manage.
 *   - Platform admins can manage.
 *   - Else 403.
 *
 * The service enforces the read gate on `getTopic` / `listMemberSkillGuids`
 * and the write gate on `updateTopic` / `deleteTopic` / membership mutations.
 * Route-level permission checks (`ornn:skill:*`) live in `routes.ts`.
 *
 * @module domains/topics/service
 */

import { randomUUID } from "node:crypto";
import type { SkillRepository } from "../skillCrud/repository";
import type { TopicRepository, TopicSkillRepository } from "./repository";
import type {
  SkillDocument,
  SkillSearchItem,
  TopicDetailResponse,
  TopicDocument,
  TopicListResponse,
  TopicSummaryItem,
} from "../../shared/types/index";
import { AppError } from "../../shared/types/index";
import type { OrgMembershipFact } from "../../middleware/nyxidAuth";
import { canReadSkill, canManageSkill } from "../skillCrud/authorize";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "topicService" });

export interface TopicServiceDeps {
  topicRepo: TopicRepository;
  topicSkillRepo: TopicSkillRepository;
  skillRepo: SkillRepository;
}

/**
 * Caller context for topic ops. `memberships` is the actor's filtered org
 * membership list (viewer role already removed). `userOrgIds` is the list
 * of org user_ids derived from `memberships` — duplicated here so callers
 * that only care about "which orgs do I belong to" (scope filtering) don't
 * have to recompute it.
 */
export interface ActorContext {
  currentUserId: string;
  /** True when caller holds the `ornn:admin:skill` platform permission. */
  isAdmin: boolean;
  /** Filtered NyxID org memberships (admin/member only). */
  memberships: OrgMembershipFact[];
}

export class TopicService {
  private readonly topicRepo: TopicRepository;
  private readonly topicSkillRepo: TopicSkillRepository;
  private readonly skillRepo: SkillRepository;

  constructor(deps: TopicServiceDeps) {
    this.topicRepo = deps.topicRepo;
    this.topicSkillRepo = deps.topicSkillRepo;
    this.skillRepo = deps.skillRepo;
  }

  // ---------------------------------------------------------------------------
  // Write paths
  // ---------------------------------------------------------------------------

  async createTopic(
    input: {
      name: string;
      description: string;
      isPrivate: boolean;
      /**
       * When set, the new topic is owned by this org user_id. Caller MUST
       * pre-validate org membership — the service trusts this field.
       */
      targetOrgId?: string;
    },
    actor: { userId: string; userEmail?: string; userDisplayName?: string },
  ): Promise<TopicDetailResponse> {
    const guid = randomUUID();
    const topic = await this.topicRepo.create({
      guid,
      name: input.name,
      description: input.description,
      ownerId: input.targetOrgId ?? actor.userId,
      createdBy: actor.userId,
      createdByEmail: actor.userEmail,
      createdByDisplayName: actor.userDisplayName,
      isPrivate: input.isPrivate,
    });
    return this.buildDetailResponse(topic, [], 0);
  }

  async updateTopic(
    guid: string,
    input: { description?: string; isPrivate?: boolean },
    actor: ActorContext,
  ): Promise<TopicDetailResponse> {
    const existing = await this.requireTopic(guid);
    if (!this.canManageTopic(existing, actor)) {
      throw AppError.forbidden("FORBIDDEN", "You do not have permission to update this topic");
    }
    const updated = await this.topicRepo.update(guid, {
      description: input.description,
      isPrivate: input.isPrivate,
      updatedBy: actor.currentUserId,
    });
    const skillGuids = await this.topicSkillRepo.listSkillGuidsByTopic(guid);
    const count = skillGuids.length;
    // For the update response we intentionally do not re-apply the skill
    // visibility filter against the actor — whoever can update a topic can
    // see all of its edges. Callers fetching the detail endpoint afterwards
    // go through the visibility-aware getTopic path.
    const skills = skillGuids.length > 0 ? await this.skillRepo.findByGuids(skillGuids) : [];
    const ordered = orderSkillsByGuidList(skills, skillGuids);
    return this.buildDetailResponse(updated, ordered, count);
  }

  async deleteTopic(guid: string, actor: ActorContext): Promise<void> {
    const existing = await this.requireTopic(guid);
    if (!this.canManageTopic(existing, actor)) {
      throw AppError.forbidden("FORBIDDEN", "You do not have permission to delete this topic");
    }
    await this.topicSkillRepo.deleteAllByTopic(guid);
    await this.topicRepo.hardDelete(guid);
    logger.info({ guid }, "Topic deleted");
  }

  // ---------------------------------------------------------------------------
  // Read paths
  // ---------------------------------------------------------------------------

  async listTopics(params: {
    query: string;
    scope: "public" | "mine" | "mixed";
    page: number;
    pageSize: number;
    currentUserId: string;
    userOrgIds: string[];
  }): Promise<TopicListResponse> {
    const { topics, total } = await this.topicRepo.list({
      query: params.query,
      scope: params.scope,
      currentUserId: params.currentUserId,
      userOrgIds: params.userOrgIds,
      page: params.page,
      pageSize: params.pageSize,
    });

    const counts = await this.topicSkillRepo.countsByTopics(topics.map((t) => t.guid));
    const items: TopicSummaryItem[] = topics.map((t) => this.toSummary(t, counts.get(t.guid) ?? 0));

    return {
      total,
      totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
      page: params.page,
      pageSize: params.pageSize,
      items,
    };
  }

  /**
   * Fetch a topic + its visible skills. 404 if the topic does not exist or
   * if it's private and the viewer is neither owner nor admin.
   */
  async getTopic(idOrName: string, actor: ActorContext): Promise<TopicDetailResponse> {
    const topic = await this.findByIdOrName(idOrName);
    if (!topic) {
      throw AppError.notFound("TOPIC_NOT_FOUND", `Topic '${idOrName}' not found`);
    }
    if (!this.canReadTopic(topic, actor)) {
      // Use 404 rather than 403 to avoid leaking the existence of private topics.
      throw AppError.notFound("TOPIC_NOT_FOUND", `Topic '${idOrName}' not found`);
    }

    const skillGuids = await this.topicSkillRepo.listSkillGuidsByTopic(topic.guid);
    const count = skillGuids.length;
    const rawSkills = skillGuids.length > 0 ? await this.skillRepo.findByGuids(skillGuids) : [];
    const visible = rawSkills.filter((s) => this.canSeeSkill(s, actor));
    const ordered = orderSkillsByGuidList(visible, skillGuids);

    return this.buildDetailResponse(topic, ordered, count);
  }

  /**
   * Same as `findByIdOrName` but exposed for tests / callers that want the
   * raw `TopicDocument` without triggering a 404.
   */
  async findByIdOrNameRaw(idOrName: string): Promise<TopicDocument | null> {
    return this.findByIdOrName(idOrName);
  }

  /**
   * Resolve a topic by id or name and enforce visibility. Returns the topic
   * doc so other paths (add / remove skill) can reuse ownership-checking
   * logic without re-fetching.
   */
  async resolveTopicForManagement(idOrName: string, actor: ActorContext): Promise<TopicDocument> {
    const topic = await this.findByIdOrName(idOrName);
    if (!topic) {
      throw AppError.notFound("TOPIC_NOT_FOUND", `Topic '${idOrName}' not found`);
    }
    if (!this.canManageTopic(topic, actor)) {
      throw AppError.forbidden("FORBIDDEN", "You do not have permission to manage this topic");
    }
    return topic;
  }

  // ---------------------------------------------------------------------------
  // Membership
  // ---------------------------------------------------------------------------

  async addSkills(
    topicIdOrName: string,
    skillIdsOrNames: string[],
    actor: ActorContext,
  ): Promise<{ added: string[]; skipped: string[] }> {
    const topic = await this.requireTopic(topicIdOrName);
    if (!this.canManageTopic(topic, actor)) {
      throw AppError.forbidden("FORBIDDEN", "You do not have permission to modify this topic");
    }

    const added: string[] = [];
    const skipped: string[] = [];

    for (const ref of skillIdsOrNames) {
      const skill = await this.resolveSkill(ref);
      if (!skill) {
        throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${ref}' not found`);
      }
      if (!this.canSeeSkill(skill, actor)) {
        throw AppError.forbidden(
          "SKILL_NOT_ACCESSIBLE",
          `Skill '${skill.name}' is private and you do not have access to it`,
        );
      }
      const result = await this.topicSkillRepo.add({
        topicGuid: topic.guid,
        skillGuid: skill.guid,
        addedBy: actor.currentUserId,
      });
      if (result.inserted) {
        added.push(skill.guid);
      } else {
        skipped.push(skill.guid);
      }
    }

    logger.info({ topicGuid: topic.guid, added: added.length, skipped: skipped.length }, "Topic skills added");
    return { added, skipped };
  }

  async removeSkill(
    topicIdOrName: string,
    skillGuid: string,
    actor: ActorContext,
  ): Promise<{ success: true }> {
    const topic = await this.requireTopic(topicIdOrName);
    if (!this.canManageTopic(topic, actor)) {
      throw AppError.forbidden("FORBIDDEN", "You do not have permission to modify this topic");
    }
    const removed = await this.topicSkillRepo.remove(topic.guid, skillGuid);
    if (!removed) {
      throw AppError.notFound("NOT_IN_TOPIC", `Skill '${skillGuid}' is not in topic '${topic.name}'`);
    }
    return { success: true };
  }

  /**
   * Called from `SkillService.deleteSkill` (wired via constructor injection
   * in bootstrap). Cascades any membership edges referencing the deleted
   * skill.
   */
  async cascadeOnSkillDelete(skillGuid: string): Promise<void> {
    await this.topicSkillRepo.deleteAllBySkill(skillGuid);
  }

  /**
   * Returns the GUIDs of all skills in a topic. Used by the search
   * integration to restrict the match-stage to the topic members.
   */
  async listMemberSkillGuids(topicIdOrName: string, actor: ActorContext): Promise<string[]> {
    const topic = await this.findByIdOrName(topicIdOrName);
    if (!topic) {
      throw AppError.notFound("TOPIC_NOT_FOUND", `Topic '${topicIdOrName}' not found`);
    }
    if (!this.canReadTopic(topic, actor)) {
      throw AppError.notFound("TOPIC_NOT_FOUND", `Topic '${topicIdOrName}' not found`);
    }
    return this.topicSkillRepo.listSkillGuidsByTopic(topic.guid);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async findByIdOrName(idOrName: string): Promise<TopicDocument | null> {
    const byGuid = await this.topicRepo.findByGuid(idOrName);
    if (byGuid) return byGuid;
    return this.topicRepo.findByName(idOrName);
  }

  private async requireTopic(idOrName: string): Promise<TopicDocument> {
    const topic = await this.findByIdOrName(idOrName);
    if (!topic) {
      throw AppError.notFound("TOPIC_NOT_FOUND", `Topic '${idOrName}' not found`);
    }
    return topic;
  }

  private async resolveSkill(ref: string): Promise<SkillDocument | null> {
    const byGuid = await this.skillRepo.findByGuid(ref);
    if (byGuid) return byGuid;
    return this.skillRepo.findByName(ref);
  }

  /**
   * Read gate — can the actor see this topic? Mirrors canReadSkill exactly
   * so that callers can reason about topic + skill visibility with the same
   * mental model.
   */
  private canReadTopic(topic: TopicDocument, actor: ActorContext): boolean {
    return canReadSkill(
      { ownerId: topic.ownerId, createdBy: topic.createdBy, isPrivate: topic.isPrivate },
      {
        userId: actor.currentUserId,
        memberships: actor.memberships,
        isPlatformAdmin: actor.isAdmin,
      },
    );
  }

  /**
   * Write gate — can the actor mutate this topic? Author + org admin of the
   * owning org + platform admin, else denied.
   */
  private canManageTopic(topic: TopicDocument, actor: ActorContext): boolean {
    return canManageSkill(
      { ownerId: topic.ownerId, createdBy: topic.createdBy, isPrivate: topic.isPrivate },
      {
        userId: actor.currentUserId,
        memberships: actor.memberships,
        isPlatformAdmin: actor.isAdmin,
      },
    );
  }

  /** Read gate for the embedded skill list. Uses the same skill visibility rules. */
  private canSeeSkill(skill: SkillDocument, actor: ActorContext): boolean {
    return canReadSkill(skill, {
      userId: actor.currentUserId,
      memberships: actor.memberships,
      isPlatformAdmin: actor.isAdmin,
    });
  }

  private toSummary(topic: TopicDocument, skillCount: number): TopicSummaryItem {
    return {
      guid: topic.guid,
      name: topic.name,
      description: topic.description,
      ownerId: topic.ownerId,
      createdBy: topic.createdBy,
      createdByEmail: topic.createdByEmail,
      createdByDisplayName: topic.createdByDisplayName,
      createdOn: topic.createdOn instanceof Date ? topic.createdOn.toISOString() : String(topic.createdOn),
      updatedOn: topic.updatedOn instanceof Date ? topic.updatedOn.toISOString() : String(topic.updatedOn),
      isPrivate: topic.isPrivate,
      skillCount,
    };
  }

  private buildDetailResponse(
    topic: TopicDocument,
    skills: SkillDocument[],
    totalSkillCount: number,
  ): TopicDetailResponse {
    const summary = this.toSummary(topic, totalSkillCount);
    const items: SkillSearchItem[] = skills.map((s) => ({
      guid: s.guid,
      name: s.name,
      description: s.description,
      ownerId: s.ownerId,
      createdBy: s.createdBy,
      createdByEmail: s.createdByEmail,
      createdByDisplayName: s.createdByDisplayName,
      createdOn: s.createdOn instanceof Date ? s.createdOn.toISOString() : String(s.createdOn),
      updatedOn: s.updatedOn instanceof Date ? s.updatedOn.toISOString() : String(s.updatedOn),
      isPrivate: s.isPrivate,
      isSystem: s.isSystem,
      nyxidServiceId: s.nyxidServiceId,
      tags: s.metadata?.tags ?? [],
    }));
    return { ...summary, skills: items };
  }
}

/**
 * Preserve the order of `skillGuids` (which is newest-added first from the
 * edge table) in the returned skill docs. Skills that are missing from the
 * fetched `skills` array (e.g. filtered out for visibility) are dropped.
 */
function orderSkillsByGuidList(skills: SkillDocument[], order: string[]): SkillDocument[] {
  const byGuid = new Map(skills.map((s) => [s.guid, s]));
  const out: SkillDocument[] = [];
  for (const g of order) {
    const s = byGuid.get(g);
    if (s) out.push(s);
  }
  return out;
}
