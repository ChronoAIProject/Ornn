/**
 * AssistantWidget — launcher + panel behavior (#970, redesigned #976).
 *
 * Covers the user-facing contract:
 *   - The mascot launcher renders for EVERYONE (anonymous + authed) — it
 *     is no longer auth-gated.
 *   - Anonymous send is intercepted with an inline sign-in prompt and
 *     never reaches the chat backend; the prompt's button initiates the
 *     NyxID login.
 *   - Authenticated send still forwards to the chat hook.
 *   - First-visit auto-open: the panel opens once when the localStorage
 *     flag is unset, and stays closed when it is set.
 *   - The launcher opens a dialog with the three example questions; a
 *     suggestion click fills the composer; close dismisses the panel;
 *     Tab focus is trapped; header controls keep a 44px touch target.
 *
 * framer-motion is stubbed pass-through (incl. useReducedMotion +
 * useMotionValue, and all drag/gesture/animation props are dropped so
 * they don't leak onto the DOM). The auth store + chat hook are mocked;
 * the assistant store (open/close) is the real session store, reset per
 * test. react-i18next is stubbed globally in src/test/setup.ts, resolving
 * the real en.json copy. localStorage is cleared per test so the
 * first-visit auto-open is deterministic.
 *
 * @module components/assistant/AssistantWidget.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The test runtime's default localStorage lacks `.clear()`; install a
// minimal in-memory Storage (same pattern as AnnouncementBanner.test) so
// the first-visit / launcher-position flags are deterministic per test.
function installFakeLocalStorage() {
  const store = new Map<string, string>();
  const fake: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  };
  Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true });
}
installFakeLocalStorage();

let isAuthed = true;
const sendMessage = vi.fn();
const abort = vi.fn();
const clearChat = vi.fn();
const loginWithNyxID = vi.fn();

vi.mock("framer-motion", () => {
  // Props that are framer-only — dropped so React doesn't warn about
  // unknown DOM attributes (and so motion values in `style` never reach
  // the DOM).
  const DROP = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "variants",
    "drag",
    "dragConstraints",
    "dragMomentum",
    "dragElastic",
    "dragListener",
    "whileTap",
    "whileDrag",
    "whileHover",
    "whileFocus",
    "whileInView",
    "onDragStart",
    "onDrag",
    "onDragEnd",
    "onHoverStart",
    "onHoverEnd",
    "layout",
    "layoutId",
    "custom",
    "style",
    "viewport",
  ]);
  const make =
    (tag: string) =>
    ({
      children,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) => {
      const domProps: Record<string, unknown> = {};
      for (const key of Object.keys(props)) {
        if (!DROP.has(key)) domProps[key] = props[key];
      }
      const Tag = tag as keyof React.JSX.IntrinsicElements;
      return <Tag {...domProps}>{children}</Tag>;
    };
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
    useMotionValue: (initial: number) => {
      let v = initial;
      return {
        get: () => v,
        set: (n: number) => {
          v = n;
        },
        on: () => () => {},
      };
    },
    motion: new Proxy(
      {},
      {
        get: (_t, tag: string) => make(tag),
      },
    ),
  };
});

vi.mock("@/stores/authStore", () => ({
  useIsAuthenticated: () => isAuthed,
  // Selector form: the panel reads `useAuthStore((s) => s.loginWithNyxID)`.
  useAuthStore: (selector: (s: { loginWithNyxID: () => void }) => unknown) =>
    selector({ loginWithNyxID }),
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
  loginWithNyxID.mockReset();
  localStorage.clear();
  useAssistantStore.setState({
    isOpen: false,
    messages: [],
    isStreaming: false,
    error: null,
    currentAssistantContent: "",
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function openPanel() {
  fireEvent.click(screen.getByLabelText("Ask Ornn"));
}

describe("AssistantWidget", () => {
  it("renders the mascot launcher for signed-out visitors", () => {
    isAuthed = false;
    render(<AssistantWidget />);
    expect(screen.getByLabelText("Ask Ornn")).toBeInTheDocument();
    // Panel is closed initially.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the launcher when signed in", () => {
    render(<AssistantWidget />);
    expect(screen.getByLabelText("Ask Ornn")).toBeInTheDocument();
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

  it("forwards a sent message to the chat hook when authenticated", () => {
    render(<AssistantWidget />);
    openPanel();
    fireEvent.click(screen.getByText("How is Ornn different?"));
    fireEvent.click(screen.getByLabelText("Send message"));
    expect(sendMessage).toHaveBeenCalledWith("How is Ornn different?");
  });

  it("intercepts an anonymous send with a sign-in prompt instead of sending", () => {
    isAuthed = false;
    render(<AssistantWidget />);
    openPanel();
    fireEvent.click(screen.getByText("What is Ornn?"));
    fireEvent.click(screen.getByLabelText("Send message"));

    // Did NOT hit the authed-only chat backend.
    expect(sendMessage).not.toHaveBeenCalled();
    // Surfaced the inline sign-in prompt.
    expect(screen.getByText("Sign in to chat with Ornn")).toBeInTheDocument();
  });

  it("initiates NyxID login from the sign-in prompt", () => {
    isAuthed = false;
    render(<AssistantWidget />);
    openPanel();
    fireEvent.click(screen.getByText("What is Ornn?"));
    fireEvent.click(screen.getByLabelText("Send message"));

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(loginWithNyxID).toHaveBeenCalledTimes(1);
  });

  it("dismisses the sign-in prompt back to the empty state", () => {
    isAuthed = false;
    render(<AssistantWidget />);
    openPanel();
    fireEvent.click(screen.getByText("What is Ornn?"));
    fireEvent.click(screen.getByLabelText("Send message"));
    expect(screen.getByText("Sign in to chat with Ornn")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Maybe later" }));
    expect(screen.queryByText("Sign in to chat with Ornn")).not.toBeInTheDocument();
    // Back to the empty state with its suggestions.
    expect(screen.getByText("What is Ornn?")).toBeInTheDocument();
  });

  it("auto-opens the panel once on a first-ever visit", () => {
    vi.useFakeTimers();
    // localStorage flag unset (cleared in beforeEach).
    render(<AssistantWidget />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.getByRole("dialog", { name: "Ornn Assistant" })).toBeInTheDocument();
  });

  it("does not auto-open when the first-visit flag is already set", () => {
    vi.useFakeTimers();
    localStorage.setItem("ornn:assistant:auto-opened", "1");
    render(<AssistantWidget />);
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the panel via the close button", () => {
    render(<AssistantWidget />);
    openPanel();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close assistant"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("traps Tab focus inside the dialog", () => {
    render(<AssistantWidget />);
    openPanel();
    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;

    // Tab off the last element wraps to the first.
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // Shift+Tab off the first element wraps to the last.
    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("gives the close control a >=44px touch target", () => {
    render(<AssistantWidget />);
    openPanel();
    const close = screen.getByLabelText("Close assistant");
    // h-11 w-11 = 44px (docs/DESIGN.md mobile touch-target guideline).
    expect(close.className).toContain("h-11");
    expect(close.className).toContain("w-11");
  });
});
