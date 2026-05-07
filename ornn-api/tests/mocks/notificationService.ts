/**
 * NotificationService mock — minimal recorder that satisfies the
 * audit/quota-grant fan-out call sites. Tests assert via
 * `wasNotified(userId, kind)` instead of inspecting Mongo or stubbing
 * the repository.
 *
 * @module tests/mocks/notificationService
 */

export type NotificationKind =
  | "audit_completed"
  | "quota_credits_granted"
  | "quota_model_change";

interface RecordedNotification {
  userId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
}

export interface NotificationServiceMock {
  // Method surface that mirrors the real service; everything is a
  // no-op-then-record so callers don't see fan-out behaviour.
  notifyQuotaCreditsGranted: (params: {
    userId: string;
    surface: string;
    amount: number;
    monthMarker: string;
    note?: string;
  }) => Promise<void>;
  notifyQuotaModelChange: (params: {
    userId: string;
    monthMarker: string;
    message: string;
  }) => Promise<void>;
  notifyAuditCompleted: (params: {
    userId: string;
    skillGuid: string;
    verdict: string;
    overallScore: number;
  }) => Promise<void>;
  // Test-side helpers
  wasNotified: (userId: string, kind: NotificationKind) => boolean;
  recorded: () => ReadonlyArray<RecordedNotification>;
  reset: () => void;
}

export function createNotificationServiceMock(): NotificationServiceMock {
  let recordedRows: RecordedNotification[] = [];
  return {
    notifyQuotaCreditsGranted: async (p) => {
      recordedRows.push({ userId: p.userId, kind: "quota_credits_granted", payload: { ...p } });
    },
    notifyQuotaModelChange: async (p) => {
      recordedRows.push({ userId: p.userId, kind: "quota_model_change", payload: { ...p } });
    },
    notifyAuditCompleted: async (p) => {
      recordedRows.push({ userId: p.userId, kind: "audit_completed", payload: { ...p } });
    },
    wasNotified: (userId, kind) =>
      recordedRows.some((r) => r.userId === userId && r.kind === kind),
    recorded: () => recordedRows,
    reset: () => {
      recordedRows = [];
    },
  };
}
