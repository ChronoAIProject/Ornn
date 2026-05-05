/**
 * High-level server-side analytics API (issue #252).
 *
 * Domain code calls `analytics.track(userId, event, properties)` and gets
 * a stable, model-agnostic event-emit contract. Today the underlying sink
 * is PostHog (see `./posthog.ts`); future sinks (warehouse exporter, OTel
 * span pipeline) plug in by adding alternative `AnalyticsTracker`
 * implementations behind the same interface.
 *
 * Event taxonomy (server-side only — frontend events are captured directly
 * via posthog-js in `ornn-web`):
 *
 *  - `api.skill.pull`        — every skill package materialization that
 *                              the frontend can't reliably attest. Caller
 *                              type + skillId are mandatory; the route
 *                              layer fills in caller context.
 *  - `api.skill.published`   — skill version create + update publish path.
 *  - `api.error`             — 5xx surface, sampled at
 *                              `posthogErrorSampleRate`.
 *
 * @module infra/analytics
 */

import type { Logger } from "pino";
import { createTracker, type AnalyticsTracker } from "./posthog";

export type { AnalyticsTracker } from "./posthog";

/**
 * What kind of caller produced an event. Threaded into `api.skill.pull`
 * so the agent-vs-human funnel can be split cleanly in PostHog.
 */
export type CallerType = "web" | "api" | "playground" | "system";

export interface AnalyticsServiceDeps {
  readonly tracker: AnalyticsTracker;
  /** `[0, 1]` — error events sampled at this rate. */
  readonly errorSampleRate: number;
  readonly logger?: Logger;
}

/**
 * Service-level analytics API. The route / domain layer never imports
 * `posthog-node` directly; everything flows through these methods so the
 * sink can be swapped.
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
   * stays grep-able; this one is here for ad-hoc events behind feature
   * flags.
   */
  track(
    userId: string | null,
    event: string,
    properties?: Readonly<Record<string, unknown>>,
  ): void {
    this.tracker.track(userId, event, properties);
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
      skillId: input.skillId,
      ...(input.skillName ? { skillName: input.skillName } : {}),
      skillVersion: input.skillVersion,
      isNewSkill: input.isNewSkill,
    });
  }

  /**
   * `api.error` — sampled. `errorCode` is the AppError code or a generic
   * tag for unhandled errors. Path/method are populated by the caller —
   * we never log raw bodies (would leak PII).
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
 */
export function createAnalyticsEmitter(
  config: {
    posthogApiKey: string | null;
    posthogHost: string;
    posthogProjectId: string | null;
    posthogErrorSampleRate: number;
  },
  logger?: Logger,
): AnalyticsEmitter {
  const tracker = createTracker(
    {
      posthogApiKey: config.posthogApiKey,
      posthogHost: config.posthogHost,
      posthogProjectId: config.posthogProjectId,
    },
    logger,
  );
  return new AnalyticsEmitter({
    tracker,
    errorSampleRate: config.posthogErrorSampleRate,
    logger,
  });
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
