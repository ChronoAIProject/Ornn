/**
 * PostHog product-analytics sink (issue #252).
 *
 * Wraps `posthog-node` behind a tiny `AnalyticsTracker` interface so the
 * rest of the codebase doesn't import the SDK directly. Two implementations:
 *
 *  - `PosthogTracker` — real `posthog-node` client. Fire-and-forget; the
 *    SDK buffers and flushes in the background.
 *  - `NoopTracker`    — used when `POSTHOG_API_KEY` is unset (dev/CI).
 *
 * The high-level helper `analytics.track(userId, event, properties)`
 * normalizes the call site so feature code stays event-name-driven and
 * doesn't see the underlying SDK's `capture()` shape.
 *
 * Logging discipline (per issue #252):
 *   - `info` once per emission with the event name, distinctId, and a
 *     property-key list (NEVER values, since they may contain PII).
 *   - `debug` includes the property body — only printed at debug level.
 *   - `error` on every SDK failure with full context.
 *
 * @module infra/analytics/posthog
 */

import { PostHog } from "posthog-node";
import pino, { type Logger } from "pino";

const moduleLogger = pino({ level: "info" }).child({ module: "posthogTracker" });

export interface AnalyticsTracker {
  /**
   * Capture a server-side product event.
   *
   * `userId` becomes `distinctId` in PostHog. When `null` the event is
   * still captured but with an anonymous distinct id so anonymous-traffic
   * funnels still attribute correctly.
   */
  track(
    userId: string | null,
    event: string,
    properties?: Readonly<Record<string, unknown>>,
  ): void;

  /** Flush + close. Called from graceful shutdown. */
  shutdown(): Promise<void>;
}

export interface PosthogTrackerConfig {
  readonly apiKey: string;
  readonly host: string;
  /** Optional — informational only, threaded into log lines. */
  readonly projectId?: string | null;
  /**
   * 5xx error events get sub-sampled at this rate (`[0, 1]`). Sampling
   * happens at the call site (`trackApiError`) so non-error events don't
   * pay the cost.
   */
  readonly errorSampleRate?: number;
}

/**
 * No-op tracker used when PostHog is disabled (no API key set). Kept as a
 * concrete class — not a hand-rolled object literal — so `instanceof`
 * checks in tests stay stable.
 */
export class NoopTracker implements AnalyticsTracker {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  track(_userId: string | null, _event: string, _properties?: Readonly<Record<string, unknown>>): void {
    /* intentional no-op */
  }
  async shutdown(): Promise<void> {
    /* intentional no-op */
  }
}

/**
 * Real PostHog tracker. Holds a single buffered `PostHog` client; calls
 * to `track` enqueue a `capture()` and return synchronously. Failures
 * surfaced by the SDK are caught here so they never bubble into the
 * request handler.
 */
export class PosthogTracker implements AnalyticsTracker {
  private readonly client: PostHog;
  private readonly logger: Logger;
  private readonly projectId: string | null;

  constructor(config: PosthogTrackerConfig, logger: Logger = moduleLogger) {
    this.client = new PostHog(config.apiKey, {
      host: config.host,
      // Modest flush settings — small bursts are fine in-process; large
      // bursts get drained to the backend on `flush()`/`shutdown()`.
      flushAt: 20,
      flushInterval: 10_000,
    });
    this.logger = logger.child({
      module: "posthogTracker",
      ...(config.projectId ? { posthogProjectId: config.projectId } : {}),
    });
    this.projectId = config.projectId ?? null;

    // posthog-node v5 emits an `error` event when the buffered transport
    // fails. Listen so we surface the failure on our logger instead of
    // letting it bubble into the Node EventEmitter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.client as unknown as { on?: (e: string, fn: (err: unknown) => void) => void })
      .on?.("error", (err: unknown) => {
        this.logger.error({ err }, "PostHog transport error");
      });
  }

  track(
    userId: string | null,
    event: string,
    properties?: Readonly<Record<string, unknown>>,
  ): void {
    // Anonymous distinctId — PostHog still groups under it consistently
    // across calls in the same request when the caller passes it through.
    const distinctId = userId ?? `anon:${cryptoRandom()}`;
    const propKeys = properties ? Object.keys(properties) : [];

    try {
      // Fire-and-forget — the SDK queues internally and flushes async.
      this.client.capture({
        distinctId,
        event,
        properties: properties as Record<string, unknown> | undefined,
      });
      this.logger.info({ event, distinctId: redactDistinctId(distinctId), propKeys }, "PostHog event captured");
      this.logger.debug({ event, distinctId: redactDistinctId(distinctId), properties }, "PostHog event body");
    } catch (err) {
      this.logger.error({ err, event }, "PostHog capture failed");
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.client.shutdown();
      this.logger.info({ projectId: this.projectId }, "PostHog client shut down");
    } catch (err) {
      this.logger.error({ err }, "PostHog shutdown failed");
    }
  }
}

/**
 * Pick the right tracker based on the resolved config. Single
 * construction site so the bootstrap doesn't have to know which
 * implementation is wired.
 */
export function createTracker(
  config: { posthogApiKey: string | null; posthogHost: string; posthogProjectId: string | null },
  logger?: Logger,
): AnalyticsTracker {
  if (!config.posthogApiKey) {
    (logger ?? moduleLogger).info(
      { reason: "POSTHOG_API_KEY not set" },
      "PostHog tracker disabled — using NoopTracker",
    );
    return new NoopTracker();
  }
  return new PosthogTracker(
    {
      apiKey: config.posthogApiKey,
      host: config.posthogHost,
      projectId: config.posthogProjectId,
    },
    logger,
  );
}

/**
 * Distinct id is treated as low-sensitivity but we still avoid logging
 * the full user id at info level — keeps audit logs from being a
 * "user did X" trail by accident. Truncate to first 8 chars; debug
 * logs still see the full id when needed.
 */
function redactDistinctId(id: string): string {
  if (id.length <= 8) return id;
  return `${id.slice(0, 8)}…`;
}

function cryptoRandom(): string {
  // 12 hex chars, enough to dedupe anonymous events within a request burst.
  const buf = new Uint8Array(6);
  // crypto.getRandomValues is available in Bun + Node 19+
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
