/**
 * FileTree tests — additive re-expand guard (#888).
 *
 * When the `files` prop changes (e.g. a ZIP finishes loading after the
 * initial render, or a new file is appended), FileTree re-expands "root"
 * and any single top-level folder using the "adjust state during render"
 * pattern instead of an effect. Crucially that re-expand is PURELY
 * ADDITIVE — it unions new ids into the existing expanded set and never
 * removes one. A folder the user manually collapsed must STAY collapsed
 * across a `files`-prop change.
 *
 * The fixture uses TWO top-level folders so the "single top-level folder"
 * auto-expand branch (`files.length === 1`) never fires — that isolates
 * the additive-guard behaviour from the initial-expand convenience.
 *
 * react-i18next is stubbed globally in src/test/setup.ts; no per-test mock.
 *
 * @module components/editor/FileTree.test
 */

import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Strip Framer Motion so AnimatePresence honours unmounting synchronously.
// FileTree wraps a folder's children in <AnimatePresence><motion.div> — in
// jsdom the real AnimatePresence keeps the exiting children mounted (the
// exit animation never resolves without rAF), which would make a collapsed
// folder still expose its children and mask the additive-guard behaviour.
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

import { FileTree, type FileNode } from "./FileTree";

function tree(extraSrcChild?: FileNode): FileNode[] {
  const srcChildren: FileNode[] = [
    { id: "src/index.ts", name: "index.ts", type: "file", content: "" },
  ];
  if (extraSrcChild) srcChildren.push(extraSrcChild);
  return [
    {
      id: "src",
      name: "src",
      type: "folder",
      children: srcChildren,
    },
    {
      id: "docs",
      name: "docs",
      type: "folder",
      children: [
        { id: "docs/readme.md", name: "readme.md", type: "file", content: "" },
      ],
    },
  ];
}

afterEach(() => {
  cleanup();
});

describe("FileTree — additive re-expand", () => {
  it("keeps a manually-collapsed folder collapsed when files change", () => {
    const files = tree();
    const { rerender } = render(
      <FileTree files={files} onSelect={() => {}} onCreateFile={() => {}} />,
    );

    // Two top-level folders, so neither is force-expanded by the
    // single-folder branch. They start collapsed; expand "src" by click.
    fireEvent.click(screen.getByText("src"));
    // Its child is now visible.
    expect(screen.getByText("index.ts")).toBeInTheDocument();

    // Collapse "src" again by clicking it.
    fireEvent.click(screen.getByText("src"));
    expect(screen.queryByText("index.ts")).not.toBeInTheDocument();

    // A new file lands → fresh `files` array identity (ZIP-load style).
    const nextFiles = tree({
      id: "src/added.ts",
      name: "added.ts",
      type: "file",
      content: "",
    });
    rerender(
      <FileTree files={nextFiles} onSelect={() => {}} onCreateFile={() => {}} />,
    );

    // The additive guard re-added only "root"/single-folder ids — it must
    // NOT have re-expanded the manually-collapsed "src". Both its existing
    // and newly-added children stay hidden.
    expect(screen.queryByText("index.ts")).not.toBeInTheDocument();
    expect(screen.queryByText("added.ts")).not.toBeInTheDocument();

    // Sanity: the collapsed folder row itself is still rendered.
    expect(screen.getByText("src")).toBeInTheDocument();
  });

  it("keeps a manually-expanded folder expanded when files change", () => {
    // The other half of the additive guard: the union is over the PREVIOUS
    // expanded set, so a folder the user opened (which the initial-expand
    // logic would NOT auto-open, since there are two top-level folders)
    // survives the prop change. A from-scratch recompute would drop it.
    const files = tree();
    const { rerender } = render(
      <FileTree files={files} onSelect={() => {}} onCreateFile={() => {}} />,
    );

    // Manually expand "docs" (not force-expanded — two top-level folders).
    fireEvent.click(screen.getByText("docs"));
    expect(screen.getByText("readme.md")).toBeInTheDocument();

    // A new file lands under src → fresh `files` identity.
    const nextFiles = tree({
      id: "src/added.ts",
      name: "added.ts",
      type: "file",
      content: "",
    });
    rerender(
      <FileTree files={nextFiles} onSelect={() => {}} onCreateFile={() => {}} />,
    );

    // "docs" stays open across the prop change — the guard unioned the
    // prior expanded set rather than recomputing from scratch.
    expect(screen.getByText("readme.md")).toBeInTheDocument();
  });
});
