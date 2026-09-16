/**
 * SSE transport + pre-stream gates shared by every skill-generation
 * route: model resolution → quota reserve (`preflight`), keep-alive
 * resolution, and the event pump that writes frames and reconciles the
 * quota charge when the stream ends (`streamGenerationEvents`).
 *
 * Split out of `routes.ts` (#1242) so the route module only owns request
 * parsing; the ordering guarantees documented here (#808/#827) are
 * unchanged.
 *
 * @module domains/skills/generation/streaming
 */

import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import type { QuotaService } from "../../quota/service";
import type { LlmProvidersService } from "../../settings/llmProviders/service";
import { throwQuotaError } from "../../quota/routes";
import { throwModelResolutionError } from "../../settings/llmProviders/routes";
import type { ChargeOutcome } from "../../quota/types";
import { type AuthVariables, getAuth } from "../../../middleware/nyxidAuth";
import { createLogger } from "../../../shared/logger";

const logger = createLogger("skillGenerationStreaming");

/** Keep-alive cadence used when the admin setting cannot be resolved. */
const FALLBACK_KEEP_ALIVE_MS = 15_000;

/** Helper to resolve keep-alive ms with a safe fallback. */
export async function resolveKeepAliveMs(
  resolver: () => Promise<number>,
): Promise<number> {
  try {
    const v = await resolver();
    return Number.isFinite(v) && v > 0 ? v : FALLBACK_KEEP_ALIVE_MS;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "Failed to resolve skillGen sseKeepAliveMs; using 15s default",
    );
    return FALLBACK_KEEP_ALIVE_MS;
  }
}

export interface PreflightResult {
  modelId: string;
  userId: string;
  permissions: readonly string[] | undefined;
  reservedAt: Date;
}

/**
 * Run model resolution + quota reserve for a skill-gen request. Returns
 * the resolved model id; throws the appropriate AppError when either
 * gate fails (models → 503/4xx, quota → 429).
 *
 * Order is load-bearing (#808): model resolution runs FIRST so a
 * resolution failure can't strand a reserved quota slot. `resolveModel`
 * is a pure catalog read (no LLM), so reserving last still keeps the
 * "429 before any LLM cost" guarantee. Once `checkAllowed` reserves,
 * every caller threads the result straight into `streamGenerationEvents`,
 * whose `finally` always reconciles the reservation (commit on success,
 * release on system_error/abort).
 */
export async function preflight(
  c: Context<{ Variables: AuthVariables }>,
  quotaService: QuotaService,
  llmProvidersService: LlmProvidersService,
  requestedModelId: string | undefined,
): Promise<PreflightResult> {
  const authCtx = getAuth(c);

  const resolution = await llmProvidersService.resolveModel({
    surface: "skillGen",
    // exactOptionalPropertyTypes (#657)
    ...(requestedModelId !== undefined ? { requested: requestedModelId } : {}),
  });
  if (resolution.kind !== "ok") throwModelResolutionError(resolution);

  // Capture the reservation instant so the charge lands in the SAME
  // month bucket the slot was reserved against (#827) — see the
  // playground route for the boundary-straddle rationale.
  const reservedAt = new Date();
  const decision = await quotaService.checkAllowed({
    userId: authCtx.userId,
    permissions: authCtx.permissions,
    surface: "skillGen",
    now: reservedAt,
  });
  if (!decision.allowed) throwQuotaError(decision);

  return {
    modelId: resolution.modelId,
    userId: authCtx.userId,
    permissions: authCtx.permissions,
    reservedAt,
  };
}

export interface ChargeAfter {
  quotaService: QuotaService;
  userId: string;
  permissions: readonly string[] | undefined;
  /** Resolved model id used for the LLM call — flows into `usedByModel`. */
  modelId: string;
  /**
   * Reservation instant captured at `preflight` time (#827). Threaded
   * into `chargeOnCompletion` as `now` so the commit/release reconciles
   * against the month bucket the slot was reserved in, not wall-clock.
   */
  reservedAt: Date;
}

/**
 * Stream generation events via SSE with keep-alive. When `chargeAfter`
 * is set, fires a quota charge after the stream finishes — outcome
 * derived from whether the stream emitted a `generation_complete` event
 * (skill-side success), a `validation_error` (skill ran but produced
 * invalid output — still chargeable), or only `error` events
 * (system_error — no charge).
 */
export async function streamGenerationEvents(
  c: Context,
  events: AsyncIterable<{ type: string; [key: string]: unknown }>,
  keepAliveIntervalMs: number,
  chargeAfter?: ChargeAfter,
) {
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    const keepAlive = setInterval(() => {
      stream.writeSSE({ data: "", event: "keepalive" }).catch(() => {});
    }, keepAliveIntervalMs);

    const signal = c.req.raw.signal;
    const onAbort = () => clearInterval(keepAlive);
    signal.addEventListener("abort", onAbort, { once: true });

    let outcome: ChargeOutcome = "system_error";

    try {
      for await (const event of events) {
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (event.type === "generation_complete") outcome = "success";
        else if (event.type === "validation_error") outcome = "skill_error";
      }
    } finally {
      clearInterval(keepAlive);
      signal.removeEventListener("abort", onAbort);
      if (chargeAfter) {
        await chargeAfter.quotaService
          .chargeOnCompletion({
            userId: chargeAfter.userId,
            permissions: chargeAfter.permissions,
            surface: "skillGen",
            outcome,
            modelId: chargeAfter.modelId,
            // Reconcile against the reserved month bucket (#827).
            now: chargeAfter.reservedAt,
          })
          .catch((err) => {
            logger.warn(
              { userId: chargeAfter.userId, err: (err as Error).message },
              "Quota charge after skill-gen stream failed",
            );
          });
      }
    }
  });
}
