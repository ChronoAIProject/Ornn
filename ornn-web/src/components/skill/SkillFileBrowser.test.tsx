/**
 * SkillFileBrowser tests — per-file dirty-buffer reset on switch (#888).
 *
 * The editor holds a single `editedContent` buffer plus a derived
 * `selectedFileId`. When the selected file changes, the "adjust state
 * during render" guard resets `editedContent` to null so the new file
 * shows ITS original content — the dirty buffer is per-session, not
 * per-file, and must not bleed across a file switch.
 *
 * STALE-STATE-FIRST oracle: select file A, enter edit mode and DIRTY its
 * buffer, then switch to file B → B shows its OWN original content (the
 * dirty A buffer was discarded), and switching back to A shows A's
 * original too (no per-file dirt was retained).
 *
 * The file-tree query is internal (`useFileTree`/`useUpdateFile` via
 * TanStack Query), so we mock `@/services/apiClient` to feed a fixed tree +
 * contents and wrap in a QueryClientProvider. toastStore + framer-motion
 * (FileTree's AnimatePresence) are stubbed. react-i18next is global.
 *
 * @module components/skill/SkillFileBrowser.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const apiGet = vi.fn();
const apiPut = vi.fn();
const addToast = vi.fn();

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

vi.mock("@/services/apiClient", () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPut: (...args: unknown[]) => apiPut(...args),
}));

vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) =>
    selector({ addToast }),
}));

import { SkillFileBrowser } from "./SkillFileBrowser";

const A_ORIGINAL = "# Skill A original content";
const B_ORIGINAL = "#!/bin/sh\necho original-b";

function fileTreeResponse() {
  return {
    data: {
      tree: [
        { path: "SKILL.md", type: "file", viewable: true, size: 100 },
        { path: "scripts", type: "folder", viewable: false, size: 0 },
        { path: "scripts/run.sh", type: "file", viewable: true, size: 50 },
      ],
      contents: {
        "SKILL.md": A_ORIGINAL,
        "scripts/run.sh": B_ORIGINAL,
      },
    },
  };
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** The viewer's content area — a <pre> in view mode, a <textarea> in edit. */
function viewerText(): string {
  const pre = document.querySelector("pre");
  if (pre) return pre.textContent ?? "";
  const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
  return ta?.value ?? "";
}

/** Enter edit mode on the currently-open file (toggles the Edit button). */
function enterEditMode() {
  // The viewer header's edit toggle has title "Edit".
  const editBtn = screen.getByTitle("Edit");
  fireEvent.click(editBtn);
}

beforeEach(() => {
  apiGet.mockReset();
  apiPut.mockReset();
  addToast.mockReset();
  apiGet.mockResolvedValue(fileTreeResponse());
});

afterEach(() => {
  cleanup();
});

describe("SkillFileBrowser — per-file dirty-buffer reset", () => {
  it("discards file A's dirty buffer when switching to file B, and back to A shows the original", async () => {
    wrap(<SkillFileBrowser skillId="skill-1" version="1.0.0" isOwner={true} />);

    // Wait for the tree to load, then expand the scripts folder so run.sh
    // (file B) is reachable for selection.
    await waitFor(() => expect(screen.getByText("SKILL.md")).toBeInTheDocument());
    fireEvent.click(screen.getByText("scripts"));

    // Explicitly select file A (SKILL.md) so the test doesn't depend on the
    // default-file resolution, then assert its original content shows.
    fireEvent.click(screen.getByText("SKILL.md"));
    await waitFor(() => expect(viewerText()).toContain("Skill A original"));

    // Dirty A: enter edit mode and type into the textarea.
    enterEditMode();
    const textareaA = document.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textareaA, { target: { value: "DIRTY A EDIT" } });
    expect(viewerText()).toBe("DIRTY A EDIT");
    // Dirty state surfaces the Save button.
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();

    // Switch to run.sh (file B).
    fireEvent.click(screen.getByText("run.sh"));

    // The file switch reset `editedContent` → B shows ITS original content,
    // not A's dirty buffer. (Viewer drops back to view mode for the new file.)
    await waitFor(() => expect(viewerText()).toContain("original-b"));
    expect(viewerText()).not.toContain("DIRTY A EDIT");
    // No dirty buffer carried over → no Save button.
    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();

    // Switch back to A → its ORIGINAL content (the dirty edit was never
    // retained per-file).
    fireEvent.click(screen.getByText("SKILL.md"));
    await waitFor(() => expect(viewerText()).toContain("Skill A original"));
    expect(viewerText()).not.toContain("DIRTY A EDIT");
    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();
  });

  it("renders a selected file's content from the loaded tree", async () => {
    wrap(<SkillFileBrowser skillId="skill-1" version="1.0.0" isOwner={false} />);
    await waitFor(() => expect(screen.getByText("SKILL.md")).toBeInTheDocument());
    // Explicitly select SKILL.md; its content shows in the viewer pane.
    fireEvent.click(screen.getByText("SKILL.md"));
    await waitFor(() => {
      const pre = document.querySelector("pre") as HTMLElement;
      expect(within(pre).getByText(/Skill A original/)).toBeInTheDocument();
    });
  });
});
