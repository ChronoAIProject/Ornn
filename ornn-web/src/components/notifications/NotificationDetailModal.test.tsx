/**
 * NotificationDetailModal tests — render bilingual markdown + mark-read
 * effect.
 *
 * @module components/notifications/NotificationDetailModal.test
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Notification } from "@/types/notifications";
import { NotificationDetailModal } from "./NotificationDetailModal";

const SAMPLE: Notification = {
  _id: "n-1",
  source: "broadcast",
  titleI18n: { en: "Maintenance window", zh: "维护窗口" },
  bodyMarkdownI18n: {
    en: "We will **restart** ornn-api at 02:00 UTC.",
    zh: "我们将于 UTC 02:00 **重启** ornn-api。",
  },
  createdAt: "2026-05-14T00:00:00.000Z",
  readAt: null,
};

afterEach(() => {
  cleanup();
});

describe("NotificationDetailModal", () => {
  it("renders title + markdown body for a broadcast", () => {
    render(
      <NotificationDetailModal
        notification={SAMPLE}
        onClose={() => {}}
        onMarkRead={() => {}}
      />,
    );

    expect(screen.getByText("Maintenance window")).toBeInTheDocument();
    // Bold from markdown should render as a <strong>.
    const strong = screen.getByText("restart");
    expect(strong.tagName).toBe("STRONG");
  });

  it("calls onMarkRead exactly once when opened on an unread broadcast", async () => {
    const onMarkRead = vi.fn();
    render(
      <NotificationDetailModal
        notification={SAMPLE}
        onClose={() => {}}
        onMarkRead={onMarkRead}
      />,
    );

    await waitFor(() => expect(onMarkRead).toHaveBeenCalledTimes(1));
    expect(onMarkRead).toHaveBeenCalledWith("n-1");
  });

  it("does not call onMarkRead when the notification is already read", async () => {
    const onMarkRead = vi.fn();
    render(
      <NotificationDetailModal
        notification={{
          ...SAMPLE,
          readAt: "2026-05-14T00:00:01.000Z",
        }}
        onClose={() => {}}
        onMarkRead={onMarkRead}
      />,
    );

    // Allow the open effect chain to drain.
    await new Promise((r) => setTimeout(r, 10));
    expect(onMarkRead).not.toHaveBeenCalled();
  });

  it("renders nothing when notification is null", () => {
    const { container } = render(
      <NotificationDetailModal notification={null} onClose={() => {}} />,
    );
    // Portal is appended to document.body but only when isOpen — confirm
    // the document body has no modal text.
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Maintenance window/)).toBeNull();
  });
});
