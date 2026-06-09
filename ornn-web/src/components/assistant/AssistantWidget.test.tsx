/**
 * AssistantWidget — launcher + panel behavior (#970).
 *
 * Covers the user-facing contract: signed-out visitors get nothing; the
 * launcher opens a dialog with the three example questions; a suggestion
 * click fills the composer; sending forwards to the chat hook; close
 * dismisses the panel.
 *
 * framer-motion is stubbed pass-through (incl. useReducedMotion); the
 * auth store + chat hook are mocked; the assistant store (open/close) is
 * the real session store, reset per test. react-i18next is stubbed
 * globally in src/test/setup.ts, resolving the real en.json copy.
 *
 * @module components/assistant/AssistantWidget.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

let isAuthed = true;
const sendMessage = vi.fn();
const abort = vi.fn();
const clearChat = vi.fn();

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({
          children,
          initial: _i,
          animate: _a,
          exit: _e,
          transition: _tr,
          ...rest
        }: Record<string, unknown> & { children?: React.ReactNode }) => {
          void _i;
          void _a;
          void _e;
          void _tr;
          const Tag = tag as keyof React.JSX.IntrinsicElements;
          return <Tag {...rest}>{children}</Tag>;
        },
    },
  ),
}));

vi.mock("@/stores/authStore", () => ({
  useIsAuthenticated: () => isAuthed,
}));

vi.mock("@/hooks/useAssistantChat", () => ({
  useAssistantChat: () => ({
    messages: [],
    isStreaming: false,
    error: null,
    currentAssistantContent: "",
    sendMessage,
    abort,
    clearChat,
  }),
}));

import { AssistantWidget } from "./AssistantWidget";
import { useAssistantStore } from "@/stores/assistantStore";

beforeEach(() => {
  isAuthed = true;
  sendMessage.mockReset();
  abort.mockReset();
  clearChat.mockReset();
  useAssistantStore.setState({
    isOpen: false,
    messages: [],
    isStreaming: false,
    error: null,
    currentAssistantContent: "",
  });
});

afterEach(cleanup);

function openPanel() {
  fireEvent.click(screen.getByLabelText("Ask Ornn"));
}

describe("AssistantWidget", () => {
  it("renders nothing when signed out", () => {
    isAuthed = false;
    render(<AssistantWidget />);
    expect(screen.queryByLabelText("Ask Ornn")).not.toBeInTheDocument();
  });

  it("shows the launcher when signed in", () => {
    render(<AssistantWidget />);
    expect(screen.getByLabelText("Ask Ornn")).toBeInTheDocument();
    // Panel is closed initially.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the panel with the three example questions", () => {
    render(<AssistantWidget />);
    openPanel();
    expect(screen.getByRole("dialog", { name: "Ornn Assistant" })).toBeInTheDocument();
    expect(screen.getByText("What is Ornn?")).toBeInTheDocument();
    expect(screen.getByText("How is Ornn different?")).toBeInTheDocument();
    expect(screen.getByText("Find a skill that does X")).toBeInTheDocument();
  });

  it("fills the composer when a suggestion is clicked", () => {
    render(<AssistantWidget />);
    openPanel();
    fireEvent.click(screen.getByText("What is Ornn?"));
    const textarea = screen.getByLabelText("Chat message input") as HTMLTextAreaElement;
    expect(textarea.value).toBe("What is Ornn?");
  });

  it("forwards a sent message to the chat hook", () => {
    render(<AssistantWidget />);
    openPanel();
    fireEvent.click(screen.getByText("How is Ornn different?"));
    fireEvent.click(screen.getByLabelText("Send message"));
    expect(sendMessage).toHaveBeenCalledWith("How is Ornn different?");
  });

  it("closes the panel via the close button", () => {
    render(<AssistantWidget />);
    openPanel();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close assistant"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
