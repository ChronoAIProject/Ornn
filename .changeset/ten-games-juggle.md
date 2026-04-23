---
"ornn-api": minor
---

In-product notification center. New `notifications` domain: per-user `notifications` collection + `NotificationService` with typed emitters (`notifyAuditCompleted`, `notifyNeedsJustification`, `notifyReviewRequested`, `notifyShareDecision`, `notifyShareCancelled`). Endpoints: `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`, `POST /api/v1/notifications/:id/read`, `POST /api/v1/notifications/mark-all-read`. `ShareService` now emits at every status transition it drives (audit completion, justification needed, user-recipient review request, decision, cancellation). Org / public review-request fan-out is deferred — reviewers for those targets pick up work via `GET /shares/review-queue` until we add a fan-out service. Closes #98.
