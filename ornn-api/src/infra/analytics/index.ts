/**
 * High-level server-side analytics API. Issue #271.
 *
 * Domain code calls `analyticsEmitter.<typedHelper>(...)` and gets a
 * stable, model-agnostic event-emit contract. Underneath, every event
 * goes through `posthog-node` (or a `NoopTracker` when PostHog is
 * disabled). Replaces the old `activities` Mongo collection — every
 * activity log call site moved to `trackPlatformActivity`. Per-request
 * observability moved to `trackApiRequest`, emitted from
 * `middleware/apiRequestTracking`.
 *
 * Event taxonomy:
 *
 *  - `api.request`              — every authenticated API request.
 *                                 Fields: callerType, method, path,
 *                                 status, durationMs, sourceIp,
 *                                 requestId. The audit trail.
 *  - `api.skill.pull`           — skill package materialization.
 *  - `api.skill.published`      — skill publish (create + version).
 *  - `api.error`                — 5xx surface, sampled at
 *                                 `posthogErrorSampleRate`.
 *  - `user.login` / `.logout`   — session open/close.
 *  - `skill.created` / `.updated` / `.deleted`               — CRUD.
 *  - `skill.version_deleted` / `.visibility_changed`         — version + privacy.
 *  - `skill.permissions_changed` / `.nyxid_service_tied`     — sharing + tie.
 *  - `skill.source_linked` / `.source_unlinked` / `.refresh` — source ops.
 *  - `skill.agentseal_rescanned`                             — admin scan trigger.
 *  - `settings.exported` / `.imported`                       — settings IO.
 *
 * Every backend event carries `source: "api"` so dashboards can
 * disambiguate from frontend-originated events of the same name.
 *
 * @module infra/analytics
 */

import type { Logger } from "pino";
import { createTracker, type AnalyticsTracker } from "./posthog";

export type { AnalyticsTracker } from "./posthog";

/**
 * What kind of caller produced an event. Threaded onto `api.request`
 * + `api.skill.pull` so the agent-vs-human funnel can be split cleanly
 * in PostHog.
 */
export type CallerType = "web" | "api" | "playground" | "system";

/**
 * Closed taxonomy of platform activity events. Every domain action
 * that previously lived in the `activities` collection has a
 * corresponding entry here.
 */
export type PlatformActivityAction =
  | "user.login"
  | "user.logout"
  | "skill.created"
  | "skill.updated"
  | "skill.deleted"
  | "skill.version_deleted"
  | "skill.visibility_changed"
  | "skill.permissions_changed"
  | "skill.ownership_transferred"
  | "skill.refresh"
  | "skill.nyxid_service_tied"
  | "skill.source_linked"
  | "skill.source_unlinked"
  | "skill.agentseal_rescanned"
  | "settings.exported"
  | "settings.imported";

export interface AnalyticsServiceDeps {
  readonly tracker: AnalyticsTracker;
  /** `[0, 1]` — error events sampled at this rate. */
  readonly errorSampleRate: number;
  readonly logger?: Logger;
}

const SOURCE_PROPERTY = { source: "api" as const };

/**
 * Service-level analytics API. The route / domain layer never imports
 * `posthog-node` directly; everything flows through these methods so
 * the sink can be swapped without touching call sites.
 */
export class AnalyticsEmitter {
  private readonly tracker: AnalyticsTracker;
  private readonly errorSampleRate: number;

  constructor(deps: AnalyticsServiceDeps) {
    this.tracker = deps.tracker;
    this.errorSampleRate = clamp01(deps.errorSampleRate);
  }

  /**
   * Generic emit. Prefer the typed helpers below so the event taxonomy
   * stays grep-able; this one is for ad-hoc events behind feature
   * flags. Always merges `source: "api"` so dashboards can split
   * server- vs client-originated events of the same name.
   */
  track(
    userId: string | null,
    event: string,
    properties?: Readonly<Record<string, unknown>>,
  ): void {
    this.tracker.track(userId, event, { ...SOURCE_PROPERTY, ...properties });
  }

  /**
   * `api.request` — emitted by `middleware/apiRequestTracking` once
   * per request. The full audit trail Ornn used to write into the
   * `api_audit` Mongo collection (issue #245, removed in #271).
   *
   * Body capture intentionally not included — PostHog event
   * properties have a 32 KB cap and bodies don't belong in analytics.
   */
  trackApiRequest(input: {
    userId: string | null;
    callerType: CallerType;
    method: string;
    path: string;
    /** Hono route pattern (e.g. `/skills/:id`) when available. */
    routePattern?: string;
    status: number;
    durationMs: number;
    sourceIp?: string | null;
    requestId?: string | null;
    /** Capped at 500 chars by the middleware. Distinguishes browser / SDK / CLI / bot. */
    userAgent?: string;
    /** Comma-joined sorted list of query-string KEYS (never values). */
    queryParamKeys?: string;
    /** Content-Length on the request body when set. */
    requestBytes?: number;
    /** Content-Length on the response when set (SSE/chunked → undefined). */
    responseBytes?: number;
  }): void {
    this.tracker.track(input.userId, "api.request", {
      ...SOURCE_PROPERTY,
      callerType: input.callerType,
      method: input.method,
      path: input.path,
      ...(input.routePattern ? { routePattern: input.routePattern } : {}),
      status: input.status,
      durationMs: input.durationMs,
      ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      ...(input.queryParamKeys ? { queryParamKeys: input.queryParamKeys } : {}),
      ...(input.requestBytes !== undefined ? { requestBytes: input.requestBytes } : {}),
      ...(input.responseBytes !== undefined ? { responseBytes: input.responseBytes } : {}),
    });
  }

  /**
   * `<action>` — platform activity. Every activityRepo.log() call site
   * migrated here. Action names use PostHog `category.action`
   * convention; the event name is the action itself so dashboards can
   * filter on it directly without an extra property indirection.
   *
   * `actorEmail` / `actorDisplayName` are surfaced as properties (in
   * addition to the standard PostHog person row keyed on userId) so
   * activity events stay self-describing for ad-hoc PostHog SQL
   * queries without joining persons.
   */
  trackPlatformActivity(input: {
    userId: string | null;
    userEmail?: string;
    userDisplayName?: string;
    action: PlatformActivityAction;
    properties?: Readonly<Record<string, unknown>>;
  }): void {
    this.tracker.track(input.userId, input.action, {
      ...SOURCE_PROPERTY,
      ...(input.userEmail ? { actorEmail: input.userEmail } : {}),
      ...(input.userDisplayName ? { actorDisplayName: input.userDisplayName } : {}),
      ...(input.properties ?? {}),
    });
  }

  /** `api.skill.pull` — every materialization. */
  trackSkillPull(input: {
    userId: string | null;
    skillId: string;
    skillName?: string;
    skillVersion?: string;
    callerType: CallerType;
  }): void {
    this.tracker.track(input.userId, "api.skill.pull", {
      ...SOURCE_PROPERTY,
      callerType: input.callerType,
      skillId: input.skillId,
      ...(input.skillName ? { skillName: input.skillName } : {}),
      ...(input.skillVersion ? { skillVersion: input.skillVersion } : {}),
    });
  }

  /** `api.skill.published` — emitted from createSkill + updateSkill (zip). */
  trackSkillPublished(input: {
    userId: string | null;
    skillId: string;
    skillName?: string;
    skillVersion: string;
    isNewSkill: boolean;
  }): void {
    this.tracker.track(input.userId, "api.skill.published", {
      ...SOURCE_PROPERTY,
      skillId: input.skillId,
      ...(input.skillName ? { skillName: input.skillName } : {}),
      skillVersion: input.skillVersion,
      isNewSkill: input.isNewSkill,
    });
  }

  /**
   * `api.error` — sampled. `errorCode` is the AppError code or a
   * generic tag for unhandled errors. Path/method are populated by
   * the caller; we never log raw bodies (would leak PII).
   */
  trackApiError(input: {
    userId: string | null;
    statusCode: number;
    errorCode: string;
    method: string;
    path: string;
    requestId?: string;
  }): void {
    if (Math.random() >= this.errorSampleRate) return;
    this.tracker.track(input.userId, "api.error", {
      ...SOURCE_PROPERTY,
      statusCode: input.statusCode,
      errorCode: input.errorCode,
      method: input.method,
      path: input.path,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  }

  /** Drain on graceful shutdown. */
  async shutdown(): Promise<void> {
    await this.tracker.shutdown();
  }
}

/**
 * Wire the emitter from config. Used once from `bootstrap.ts`.
 *
 * `posthogEnabled = false` forces the NoopTracker even if a key is
 * present — admin uses this to flip the tracker off without rotating
 * keys.
 */
export function createAnalyticsEmitter(
  config: {
    posthogEnabled: boolean;
    posthogApiKey: string | null;
    posthogHost: string;
    posthogProjectId: string | null;
    posthogErrorSampleRate: number;
  },
  logger?: Logger,
): AnalyticsEmitter {
  const tracker = createTracker(
    {
      posthogEnabled: config.posthogEnabled,
      posthogApiKey: config.posthogApiKey,
      posthogHost: config.posthogHost,
      posthogProjectId: config.posthogProjectId,
    },
    logger,
  );
  return new AnalyticsEmitter({
    tracker,
    errorSampleRate: config.posthogErrorSampleRate,
    // exactOptionalPropertyTypes (#657)
    ...(logger !== undefined ? { logger } : {}),
  });
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
