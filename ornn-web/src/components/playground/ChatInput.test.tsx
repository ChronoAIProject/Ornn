/**
 * ChatInput tests — pins the #654 length-cap contract.
 *
 * What we lock in:
 *   1. `maxLength` is applied to the textarea (browser-side hard cap).
 *   2. Counter is hidden during normal-length editing (no chrome).
 *   3. Counter appears once the input crosses the warn threshold and
 *      shows `<n> / <max>`.
 *   4. Send button stays enabled within the limit.
 *   5. Over-limit input flips the counter to the over-limit message
 *      AND disables the send button.
 *
 * The over-limit case is forced by injecting `value` past `maxLength`
 * via the imperative `setValue` handle (the textarea's `maxLength`
 * would otherwise block direct typing past the cap — which is exactly
 * the desired behaviour but inconvenient for this test).
 *
 * @module components/playground/ChatInput.test
 */
import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { act, render, fireEvent, screen } from "@testing-library/react";
import { ChatInput, type ChatInputHandle } from "./ChatInput";

// Minimal i18n stub — `useTranslation()` returns `t(key, opts)` that
// echoes the key (with interpolated values for the count messages).
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (!opts) return key;
      const c = opts.count !== undefined ? String(opts.count) : "";
      const m = opts.max !== undefined ? String(opts.max) : "";
      if (key === "chatInput.charCount") return `${c} / ${m}`;
      if (key === "chatInput.overLimit") return `over (max ${m})`;
      return key;
    },
  }),
}));

function setup(overrides: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  const onSend = vi.fn();
  const onAbort = vi.fn();
  const ref = createRef<ChatInputHandle>();
  const utils = render(
    <ChatInput
      ref={ref}
      onSend={onSend}
      onAbort={onAbort}
      disabled={false}
      isStreaming={false}
      {...overrides}
    />,
  );
  const textarea = utils.container.querySelector("textarea")!;
  const sendBtn = utils.container.querySelector('button[aria-label="chatInput.sendMessage"]') as HTMLButtonElement | null;
  return { onSend, onAbort, ref, textarea, sendBtn, ...utils };
}

describe("ChatInput length cap (#654)", () => {
  it("applies maxLength to the textarea (browser-side hard cap)", () => {
    const { textarea } = setup();
    expect(textarea.maxLength).toBe(32000);
  });

  it("hides the counter for short inputs", () => {
    const { textarea } = setup();
    fireEvent.change(textarea, { target: { value: "hello" } });
    expect(screen.queryByText(/\d+ \/ 32000/)).not.toBeInTheDocument();
  });

  it("shows the counter past the warn threshold", () => {
    const { textarea } = setup();
    const long = "a".repeat(25_000);
    fireEvent.change(textarea, { target: { value: long } });
    expect(screen.getByText("25000 / 32000")).toBeInTheDocument();
  });

  it("send button stays enabled within the limit", () => {
    const { textarea, sendBtn } = setup();
    fireEvent.change(textarea, { target: { value: "a".repeat(25_000) } });
    expect(sendBtn!.disabled).toBe(false);
  });

  it("flips the counter + disables send when over the limit", () => {
    // Force value past the cap via the imperative handle (the textarea
    // maxLength would otherwise block direct typing past 32k).
    const { ref, sendBtn } = setup();
    // setValue truncates by design; bypass it by writing the textarea
    // through change with a value above the cap, mimicking a paste that
    // the browser allows but the JS guard catches.
    const { textarea } = setup();
    const huge = "a".repeat(40_000);
    // jsdom doesn't enforce maxLength on `value=` writes — perfect for
    // simulating a non-browser client / IME composition past the cap.
    fireEvent.change(textarea, { target: { value: huge } });
    const sb = textarea.parentElement?.querySelector('button[aria-label="chatInput.sendMessage"]') as HTMLButtonElement;
    expect(sb.disabled).toBe(true);
    // The over-limit copy is the stubbed `over (max 32000)`.
    expect(screen.getAllByText(/over \(max 32000\)/).length).toBeGreaterThan(0);
    void ref; // ref kept in fixture for symmetry; not used here
    void sendBtn;
  });

  it("imperative setValue truncates past the cap", () => {
    const { ref, textarea } = setup();
    act(() => {
      ref.current!.setValue("a".repeat(50_000));
    });
    // After truncation the textarea value length must be ≤ MAX_INPUT_CHARS.
    expect(textarea.value.length).toBe(32_000);
  });

  it("send button is disabled for empty input", () => {
    const { sendBtn } = setup();
    expect(sendBtn!.disabled).toBe(true);
  });
});

describe("ChatInput send + key handling", () => {
  it("sends trimmed content on Enter and clears the textarea", () => {
    const { textarea, onSend } = setup();
    fireEvent.change(textarea, { target: { value: "  hello world  " } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello world");
    expect(textarea.value).toBe("");
  });

  it("sends on a send-button click", () => {
    const { textarea, sendBtn, onSend } = setup();
    fireEvent.change(textarea, { target: { value: "ping" } });
    fireEvent.click(sendBtn!);
    expect(onSend).toHaveBeenCalledWith("ping");
  });

  it("inserts a newline on Shift+Enter without sending", () => {
    const { textarea, onSend } = setup();
    fireEvent.change(textarea, { target: { value: "line one" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    // The value is untouched — the browser would append the newline,
    // and crucially we did not clear it.
    expect(textarea.value).toBe("line one");
  });

  it("is a no-op for whitespace-only input", () => {
    const { textarea, onSend, sendBtn } = setup();
    fireEvent.change(textarea, { target: { value: "   \n  \t " } });
    // Send button disabled and Enter does nothing.
    expect(sendBtn!.disabled).toBe(true);
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send when disabled", () => {
    const { textarea, onSend } = setup({ disabled: true });
    fireEvent.change(textarea, { target: { value: "blocked" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("invokes the latest onSend after a prop swap (#888 stale-closure guard)", () => {
    // Before #888, handleSend's useCallback deps omitted onSend, so a
    // parent that swapped the handler (e.g. a new conversation session)
    // would keep firing the stale closure. The send must hit whatever
    // onSend is current at click time.
    const ref = createRef<ChatInputHandle>();
    const first = vi.fn();
    const second = vi.fn();
    const { container, rerender } = render(
      <ChatInput
        ref={ref}
        onSend={first}
        onAbort={vi.fn()}
        disabled={false}
        isStreaming={false}
      />,
    );
    const textarea = container.querySelector("textarea")!;
    fireEvent.change(textarea, { target: { value: "first" } });
    // Swap onSend while text is present but before sending.
    rerender(
      <ChatInput
        ref={ref}
        onSend={second}
        onAbort={vi.fn()}
        disabled={false}
        isStreaming={false}
      />,
    );
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("first");
  });
});

describe("ChatInput streaming + abort", () => {
  it("renders the stop button while streaming and fires onAbort", () => {
    const { container, onAbort } = setup({ isStreaming: true, disabled: true });
    // No send button in streaming mode.
    expect(
      container.querySelector('button[aria-label="chatInput.sendMessage"]'),
    ).toBeNull();
    const stopBtn = container.querySelector(
      'button[aria-label="chatInput.stopGeneration"]',
    ) as HTMLButtonElement;
    expect(stopBtn).toBeTruthy();
    fireEvent.click(stopBtn);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});

describe("ChatInput placeholder branches", () => {
  it("uses the generating placeholder when disabled + streaming", () => {
    const { textarea } = setup({ disabled: true, isStreaming: true });
    expect(textarea.placeholder).toBe("chatInput.generating");
  });

  it("uses the awaiting-tool placeholder when disabled + not streaming", () => {
    const { textarea } = setup({ disabled: true, isStreaming: false });
    expect(textarea.placeholder).toBe("chatInput.awaitingTool");
  });

  it("uses the default placeholder when active", () => {
    const { textarea } = setup({ disabled: false });
    expect(textarea.placeholder).toBe("chatInput.placeholder");
  });

  it("prefers a custom placeholder over the default branches", () => {
    const { textarea } = setup({
      disabled: true,
      isStreaming: true,
      placeholder: "Pick a tool first",
    });
    expect(textarea.placeholder).toBe("Pick a tool first");
  });
});

describe("ChatInput imperative handle", () => {
  it("focuses the textarea via the focus handle", () => {
    const { ref, textarea } = setup();
    act(() => {
      ref.current!.focus();
    });
    expect(document.activeElement).toBe(textarea);
  });

  it("replaces the value via setValue", () => {
    const { ref, textarea } = setup();
    act(() => {
      ref.current!.setValue("seeded prompt");
    });
    expect(textarea.value).toBe("seeded prompt");
  });
});
