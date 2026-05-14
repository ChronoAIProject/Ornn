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

  it("does not refire onMarkRead when the parent rerenders with a new function reference (#509)", async () => {
    const calls: string[] = [];
    // Each "render pass" gets a fresh closure, simulating the inline
    // arrow `(id) => markRead.mutate(id)` that NotificationBell and
    // NotificationsPage pass today.
    const { rerender } = render(
      <NotificationDetailModal
        notification={SAMPLE}
        onClose={() => {}}
        onMarkRead={(id) => calls.push(id)}
      />,
    );
    await waitFor(() => expect(calls.length).toBe(1));

    for (let i = 0; i < 5; i++) {
      rerender(
        <NotificationDetailModal
          notification={SAMPLE}
          onClose={() => {}}
          onMarkRead={(id) => calls.push(id)}
        />,
      );
    }

    // Despite 5 extra rerenders with a fresh onMarkRead each time, the
    // mutation must still have fired exactly once for this opened item.
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual(["n-1"]);
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

  // #532 — quota credit notifications used to be a dead click because
  // they carry no `link` and broadcasts were the only thing the modal
  // would open for. The fix routes them through this same modal in
  // plain-text mode.
  it("renders title + plain-text body + category tag for a user-source notification (#532)", () => {
    const userNotification: Notification = {
      _id: "n-2",
      source: "user",
      category: "quota.credits_granted",
      title: "Admin granted you +100 playground credits",
      body: "Granted by Shining Wang 2. Note: Redeemed code Y69HABCDE.\nEnjoy.",
      createdAt: "2026-05-14T00:00:00.000Z",
      readAt: null,
    };

    render(
      <NotificationDetailModal
        notification={userNotification}
        onClose={() => {}}
        onMarkRead={() => {}}
      />,
    );

    expect(
      screen.getByText("Admin granted you +100 playground credits"),
    ).toBeInTheDocument();
    // Plain text — no markdown bolding, no extra DOM transforms; whole
    // note (including newline) survives as one block.
    expect(
      screen.getByText(/Redeemed code Y69HABCDE/),
    ).toBeInTheDocument();
    // Category tag resolves to "Quota" (not the broadcast tag).
    expect(screen.getByText("Quota")).toBeInTheDocument();
  });
});
