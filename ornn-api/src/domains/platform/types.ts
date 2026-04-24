/**
 * Platform-wide settings. One singleton document, admin-editable, cached
 * in-memory with a short TTL so the permission path can read the current
 * threshold cheaply.
 *
 * @module domains/platform/types
 */

export interface PlatformSettings {
  /**
   * Audit overall score (0–10) at or above which a new grant is auto-
   * applied without a waiver. Scores below this trigger the audit-gated
   * share request flow (owner justification → reviewer decision).
   */
  readonly auditWaiverThreshold: number;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  auditWaiverThreshold: 6.0,
};
