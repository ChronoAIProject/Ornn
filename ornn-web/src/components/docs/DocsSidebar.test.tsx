/**
 * DocsSidebar tests — auto-expand-active + additive-collapse guard (#888).
 *
 * The sidebar lazy-initialises its expanded set to the section that
 * contains the active doc, then re-runs an "adjust state during render"
 * guard whenever the active doc moves to a different section. That guard
 * is PURELY ADDITIVE: it expands the new active section but never
 * collapses anything, so a sibling group the user manually collapsed
 * stays collapsed across active-doc changes.
 *
 * STALE-STATE-FIRST oracle: force the wrong expansion state (manually
 * collapse a non-active group, or start with the active doc in a
 * collapsed group) and assert the component self-corrects (active group
 * expands) WITHOUT un-collapsing the other group.
 *
 * react-i18next is stubbed globally in src/test/setup.ts; the component
 * doesn't use it but the global mock is harmless.
 *
 * @module components/docs/DocsSidebar.test
 */

import { describe, expect, it, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DocSection } from "@/lib/docsContent";
import { DocsSidebar } from "./DocsSidebar";

const SECTIONS: DocSection[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    children: [
      { id: "intro", label: "Introduction" },
      { id: "install", label: "Install" },
    ],
  },
  {
    id: "guides",
    label: "Guides",
    children: [
      { id: "search", label: "Search" },
      { id: "publish", label: "Publish" },
    ],
  },
];

afterEach(() => {
  cleanup();
});

describe("DocsSidebar — auto-expand active section", () => {
  it("expands the section that owns the active doc on mount", () => {
    render(<DocsSidebar sections={SECTIONS} activeId="intro" onSelect={() => {}} />);
    // The active doc lives in "Getting Started" → its children are visible.
    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.getByText("Install")).toBeInTheDocument();
    // The other group starts collapsed — its children are not rendered.
    expect(screen.queryByText("Search")).not.toBeInTheDocument();
  });

  it("auto-expands a collapsed group when the active doc moves into it", () => {
    // Active doc starts in "Getting Started"; "Guides" is collapsed.
    const { rerender } = render(
      <DocsSidebar sections={SECTIONS} activeId="intro" onSelect={() => {}} />,
    );
    expect(screen.queryByText("Search")).not.toBeInTheDocument();

    // Active doc jumps to a child of the collapsed "Guides" group — the
    // render-time guard must expand it so the active item is visible.
    rerender(
      <DocsSidebar sections={SECTIONS} activeId="publish" onSelect={() => {}} />,
    );
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Publish")).toBeInTheDocument();
  });

  it("keeps a manually-collapsed OTHER group collapsed when the active doc changes", () => {
    // Start with active doc in "Getting Started" (auto-expanded). Manually
    // expand "Guides", then collapse it again. Now the active doc moves to
    // a sibling WITHIN "Getting Started" — the additive guard must NOT
    // re-expand the manually-collapsed "Guides".
    const { rerender } = render(
      <DocsSidebar sections={SECTIONS} activeId="intro" onSelect={() => {}} />,
    );

    // Manually expand "Guides".
    fireEvent.click(screen.getByText("Guides"));
    expect(screen.getByText("Search")).toBeInTheDocument();
    // Manually collapse "Guides" again.
    fireEvent.click(screen.getByText("Guides"));
    expect(screen.queryByText("Search")).not.toBeInTheDocument();

    // Active doc changes but stays inside "Getting Started" (intro → install).
    // The activeSectionId is unchanged, so the guard does nothing — and even
    // if it fired, it would only union the active section, never "Guides".
    rerender(
      <DocsSidebar sections={SECTIONS} activeId="install" onSelect={() => {}} />,
    );

    // "Getting Started" stays open; "Guides" stays collapsed.
    expect(screen.getByText("Install")).toBeInTheDocument();
    expect(screen.queryByText("Search")).not.toBeInTheDocument();
  });
});
