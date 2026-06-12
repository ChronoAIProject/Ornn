/**
 * MarkdownEditor tests — pins the controlled wrapper + toolbar
 * dispatch-table contract and the preview render path (#886).
 *
 * The editor is a controlled component: it never holds its own text
 * state, so every toolbar button and every keystroke must surface the
 * exact next-value string through `onChange`. Each toolbar button has a
 * distinct insertion contract, several with selection-dependent
 * branches (Code: inline backtick vs fenced; Link: empty vs selection).
 * We assert the precise `onChange` payload for each so a refactor of the
 * dispatch table can't silently change the emitted markdown.
 *
 * Preview renders REAL react-markdown (no md mock — same precedent as
 * NotificationDetailModal.test): we assert the resulting DOM (<strong>,
 * heading element) rather than a passthrough of the source string.
 *
 * The cursor-restore `setTimeout(..., 0)` is driven with fake timers so
 * the post-onChange selection bookkeeping runs deterministically; real
 * timers are restored in afterEach.
 *
 * @module components/form/MarkdownEditor.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarkdownEditor } from "./MarkdownEditor";

afterEach(() => {
  // Some tests opt into fake timers for the caret-restore setTimeout(0);
  // always tear them back down so real timers (needed by the framer
  // AnimatePresence preview transition) are restored for the next test.
  vi.useRealTimers();
});

interface SetupOpts {
  value?: string;
  showPreview?: boolean;
  label?: string;
  error?: string;
}

function setup(opts: SetupOpts = {}) {
  const onChange = vi.fn();
  const utils = render(
    <MarkdownEditor
      value={opts.value ?? ""}
      onChange={onChange}
      {...(opts.showPreview !== undefined ? { showPreview: opts.showPreview } : {})}
      {...(opts.label !== undefined ? { label: opts.label } : {})}
      {...(opts.error !== undefined ? { error: opts.error } : {})}
    />,
  );
  const textarea = utils.container.querySelector("textarea") as HTMLTextAreaElement | null;
  return { onChange, textarea, ...utils };
}

/** Click a toolbar button by its `title` (== aria label text). */
function clickToolbar(label: string) {
  fireEvent.click(screen.getByTitle(label));
}

/** Set the textarea caret/selection so the wrap-vs-insert branches fire. */
function selectRange(ta: HTMLTextAreaElement, start: number, end: number) {
  ta.setSelectionRange(start, end);
}

describe("MarkdownEditor — controlled wrapper", () => {
  it("renders the current value in the textarea and never holds its own state", () => {
    const { textarea } = setup({ value: "hello world" });
    expect(textarea).not.toBeNull();
    expect(textarea!.value).toBe("hello world");
  });

  it("fires onChange with the typed value", () => {
    const { textarea, onChange } = setup({ value: "" });
    fireEvent.change(textarea!, { target: { value: "typed text" } });
    expect(onChange).toHaveBeenCalledWith("typed text");
  });
});

describe("MarkdownEditor — toolbar dispatch table", () => {
  // Both dispatch helpers schedule a setTimeout(0) to restore the caret
  // after onChange. Fake timers make that bookkeeping deterministic; we
  // flush pending timers after each case so the caret-restore callback
  // runs (covering that branch) without bleeding into the next test.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
  });

  it("Heading inserts a `## ` prefix at the caret", () => {
    const { textarea, onChange } = setup({ value: "title" });
    selectRange(textarea!, 0, 0);
    clickToolbar("Heading");
    expect(onChange).toHaveBeenCalledWith("## title");
  });

  it("Bold wraps the current selection in `**`", () => {
    const { textarea, onChange } = setup({ value: "make me bold" });
    selectRange(textarea!, 8, 12); // "bold"
    clickToolbar("Bold");
    expect(onChange).toHaveBeenCalledWith("make me **bold**");
  });

  it("Italic wraps the current selection in `_`", () => {
    const { textarea, onChange } = setup({ value: "make me italic" });
    selectRange(textarea!, 8, 14); // "italic"
    clickToolbar("Italic");
    expect(onChange).toHaveBeenCalledWith("make me _italic_");
  });

  it("List inserts a `- ` prefix at the caret", () => {
    const { textarea, onChange } = setup({ value: "item" });
    selectRange(textarea!, 0, 0);
    clickToolbar("List");
    expect(onChange).toHaveBeenCalledWith("- item");
  });

  it("Code uses inline backticks when the selection has no newline", () => {
    const { textarea, onChange } = setup({ value: "run npm install now" });
    selectRange(textarea!, 4, 15); // "npm install"
    clickToolbar("Code");
    expect(onChange).toHaveBeenCalledWith("run `npm install` now");
  });

  it("Code uses a fenced block when the selection spans a newline", () => {
    const value = "before\nafter";
    const { textarea, onChange } = setup({ value });
    selectRange(textarea!, 0, value.length); // selection includes the \n
    clickToolbar("Code");
    expect(onChange).toHaveBeenCalledWith("```\nbefore\nafter\n```");
  });

  it("Link wraps a non-empty selection as `[selection](url)`", () => {
    const { textarea, onChange } = setup({ value: "see docs here" });
    selectRange(textarea!, 4, 8); // "docs"
    clickToolbar("Link");
    expect(onChange).toHaveBeenCalledWith("see [docs](url) here");
  });

  it("Link inserts the `[link text](url)` template when nothing is selected", () => {
    const { textarea, onChange } = setup({ value: "" });
    selectRange(textarea!, 0, 0);
    clickToolbar("Link");
    expect(onChange).toHaveBeenCalledWith("[link text](url)");
  });
});

describe("MarkdownEditor — preview render path", () => {
  it("toggling preview renders real react-markdown DOM (<strong>, heading)", async () => {
    setup({ value: "# Heading\n\nthis is **bold**" });
    // Switch into preview mode via the preview toggle. AnimatePresence
    // mode="wait" defers mounting the preview child until the editor's
    // exit transition completes, so await the rendered markdown.
    fireEvent.click(screen.getByText("Preview"));

    // Bold from markdown should render as a <strong>.
    const strong = await screen.findByText("bold");
    expect(strong.tagName).toBe("STRONG");

    // The `#` line should become a real heading element, not literal text.
    const heading = screen.getByRole("heading", { name: "Heading" });
    expect(heading.tagName).toBe("H1");
  });

  it("shows the empty-preview hint when there is no content", async () => {
    setup({ value: "" });
    fireEvent.click(screen.getByText("Preview"));
    expect(await screen.findByText("Nothing to preview yet...")).toBeInTheDocument();
    // No textarea while previewing.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("disables the formatting buttons while previewing", async () => {
    setup({ value: "x" });
    fireEvent.click(screen.getByText("Preview"));
    // The toolbar buttons live outside AnimatePresence, so they flip to
    // disabled synchronously; await one render tick to be safe.
    expect(await screen.findByTitle("Bold")).toBeDisabled();
    expect(screen.getByTitle("Code")).toBeDisabled();
  });

  it("hides the preview toggle when showPreview is false", () => {
    setup({ value: "x", showPreview: false });
    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
    // The editor textarea is still present.
    expect(document.querySelector("textarea")).not.toBeNull();
  });
});

describe("MarkdownEditor — label + error conditional render", () => {
  it("renders the label when provided", () => {
    setup({ value: "", label: "Body" });
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("omits the label element when not provided", () => {
    const { container } = setup({ value: "" });
    expect(container.querySelector("label")).toBeNull();
  });

  it("renders the error message when provided", () => {
    setup({ value: "", error: "Required field" });
    expect(screen.getByText("Required field")).toBeInTheDocument();
  });

  it("omits the error message when not provided", () => {
    setup({ value: "" });
    expect(screen.queryByText("Required field")).not.toBeInTheDocument();
  });
});
