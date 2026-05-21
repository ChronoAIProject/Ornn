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
