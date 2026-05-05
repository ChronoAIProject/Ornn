/**
 * Universal API audit subsystem — public surface.
 *
 * Bootstrap wires up the repository / body storage / resolver and
 * registers the middleware on `/api/v1/*`. Routes that want to preserve
 * specific body fields call `setAuditConfig(c, { req, res })` from
 * inside the handler.
 *
 * @module middleware/audit
 */

export { auditMiddleware } from "./middleware";
export type { AuditMiddlewareConfig, AuthHintResolver } from "./middleware";
export { ApiAuditRepository } from "./repository";
export { AuditBodyStorage } from "./bodyStorage";
export type { IAuditBodyStorage } from "./bodyStorage";
export type {
  AuditDocument,
  AuditBodyRef,
  AuditVariables,
  CallerType,
  RouteAuditConfig,
} from "./types";

import type { Context } from "hono";
import type { AuditVariables, RouteAuditConfig } from "./types";

/**
 * Per-route opt-in to body field preservation. Call from inside the
 * route handler — early — so the middleware finds the config when it
 * runs the post-handler redaction step.
 *
 * Example:
 *   app.post("/skills", (c) => {
 *     setAuditConfig(c, {
 *       req: ["skillName", "description"],
 *       res: ["skillId"],
 *     });
 *     ...
 *   });
 *
 * The middleware reads this via `c.get("auditConfig")`. Anything not
 * listed here is replaced with `[REDACTED]` in the persisted record;
 * the global blacklist (`password|token|...`) always wins.
 */
export function setAuditConfig(
  c: Context<{ Variables: AuditVariables }>,
  cfg: RouteAuditConfig,
): void {
  c.set("auditConfig", cfg);
}
